import {
  type BackCheckParams,
  type ClickTargetParams,
  type DismissPopupParams,
  type LandingStayParams,
  type LaunchAppParams,
  type LlmRefineParams,
  type LoopBlockParams,
  type McpCallParams,
  type OcrFindParams,
  type SchemeJumpParams,
  type SwipeWaitParams,
  type WorkflowIR,
  type WorkflowNode,
  validateWorkflowIR,
} from './ir';
import { assertNoPlaintextSecrets, redactTrafficPayload } from './redaction';

export interface CompileStats {
  totalNodes: number;
  enabledNodes: number;
  disabledNodes: number;
  estimatedWatchdogSec: number;
  lineCount: number;
  secretScanPassed: boolean;
  secretFindings: string[];
}

export interface ApiContractEndpoint {
  domain: string;
  path: string;
  method: string;
  statusCode: number;
  extractedHints: string[];
}

export interface CompileResult {
  script: string;
  irJson: string;
  apiContractJson: string;
  stats: CompileStats;
  validation: ReturnType<typeof validateWorkflowIR>;
}

function escapeJsString(value: string): string {
  return JSON.stringify(value);
}

function sanitizeComment(value: string): string {
  return String(value).replace(/\*\//g, '* /').replace(/[\r\n]+/g, ' ');
}

function indent(lines: string[], spaces = 2): string {
  const pad = ' '.repeat(spaces);
  return lines
    .map((line) => (line.length > 0 ? `${pad}${line}` : line))
    .join('\n');
}

function countNodes(
  nodes: WorkflowNode[],
  seen = new WeakSet<object>(),
): { total: number; enabled: number; disabled: number } {
  let total = 0;
  let enabled = 0;
  let disabled = 0;
  for (const n of nodes) {
    if (seen.has(n)) continue;
    seen.add(n);
    total += 1;
    if (n.enabled) enabled += 1;
    else disabled += 1;
    if (n.type === 'loop_block') {
      const sub = countNodes((n.params as LoopBlockParams).children, seen);
      total += sub.total;
      enabled += sub.enabled;
      disabled += sub.disabled;
    }
  }
  return { total, enabled, disabled };
}

interface LoopRuntimeContext {
  missCounterVar: string;
  breakThreshold: number;
}

function compileNodeList(
  nodes: WorkflowNode[],
  depth: number,
  inLoop: boolean,
  seen = new WeakSet<object>(),
  appPackage = '',
  loopCtx?: LoopRuntimeContext,
): string[] {
  const lines: string[] = [];

  for (const node of nodes) {
    if (seen.has(node)) {
      lines.push(`// [循环引用已阻断] ${sanitizeComment(node.label)} (${sanitizeComment(node.id)})`);
      continue;
    }
    seen.add(node);

    if (!node.enabled) {
      lines.push(`// [已禁用积木] ${sanitizeComment(node.label)} (${sanitizeComment(node.id)}) — 调试跳过`);
      continue;
    }

    lines.push(`// >>> 积木 [${sanitizeComment(node.type)}]: ${sanitizeComment(node.label)}`);
    if (inLoop) {
      lines.push(`__checkRoundTimeout(__roundDeadline, ${escapeJsString(node.label)});`);
    } else {
      lines.push(`__checkGlobalTimeout();`);
    }

    switch (node.type) {
      case 'launch_app': {
        const p = node.params as LaunchAppParams;
        lines.push(`__launchApp(${escapeJsString(p.packageName)}, ${p.waitMs}, ${p.verifyForeground});`);
        break;
      }

      case 'scheme_jump': {
        const p = node.params as SchemeJumpParams;
        lines.push(
          `__jumpScheme(${escapeJsString(p.schemeTemplate)}, ${p.encodeParams}, ${p.waitMs}, ${escapeJsString(p.fallbackPackage)});`,
        );
        break;
      }

      case 'back_check': {
        const p = node.params as BackCheckParams;
        lines.push(
          `__backAndVerify(${p.times}, ${p.intervalMs}, ${escapeJsString(p.expectKeyword)}, ${escapeJsString(p.ocrEngine)}, ${Boolean(p.dismissRetentionPopups)}, ${p.maxExtraBacks ?? 0});`,
        );
        break;
      }

      case 'dismiss_popup': {
        const p = node.params as DismissPopupParams;
        lines.push(
          `__dismissPopups(${JSON.stringify({
            maxLayers: p.maxLayers,
            dismissKeywords: p.dismissKeywords,
            useAccessibilityClose: p.useAccessibilityClose,
            fallbackClosePoint: p.fallbackClosePoint ?? null,
            fallbackBackOnMiss: p.fallbackBackOnMiss,
            waitAfterClickMs: p.waitAfterClickMs,
          })});`,
        );
        break;
      }

      case 'landing_stay': {
        const p = node.params as LandingStayParams;
        lines.push(
          `__doLandingStay(${JSON.stringify({
            targetStaySec: p.targetStaySec,
            extraBufferSec: p.extraBufferSec,
            detectCountdown: p.detectCountdown,
            returnButtonKeyword: p.returnButtonKeyword,
            handleCrossAppGestureBack: p.handleCrossAppGestureBack,
            dismissRetentionPopups: p.dismissRetentionPopups,
            retentionKeywords: p.retentionKeywords,
            verifyBaseKeyword: p.verifyBaseKeyword,
            maxBackAttempts: p.maxBackAttempts,
          })});`,
        );
        break;
      }

      case 'ocr_find': {
        const p = node.params as OcrFindParams;
        const varRefExpr = p.variableRef.trim()
          ? `__getVarArray(${escapeJsString(p.variableRef)}, ${JSON.stringify(p.candidates)})`
          : JSON.stringify(p.candidates);
        const safeVar = p.saveMatchVar.replace(/[^a-zA-Z0-9_$]/g, '_') || 'ocrMatch';
        const findOpts = {
          preferAccessibility: Boolean(p.preferAccessibility),
          forbiddenYBand: p.forbiddenYBand ?? null,
        };
        lines.push(
          `var ${safeVar} = __ocrFindCandidates(${varRefExpr}, ${JSON.stringify(p.region)}, ${escapeJsString(p.engine)}, ${escapeJsString(p.matchMode)}, ${JSON.stringify(findOpts)});`,
        );
        lines.push(`ctx.vars[${escapeJsString(safeVar)}] = ${safeVar};`);
        if (!p.optional) {
          lines.push(`if (!${safeVar}) {`);
          lines.push(`  console.warn("[OCR] 未找到必需目标:", ${escapeJsString(node.label)});`);
          if (inLoop && loopCtx) {
            lines.push(`  ${loopCtx.missCounterVar} += 1;`);
            lines.push(`  __missStreak = ${loopCtx.missCounterVar};`);
            lines.push(`  if (${loopCtx.missCounterVar} >= ${loopCtx.breakThreshold}) {`);
            lines.push(
              `    console.info("[Loop] 连续无命中达到阈值 (" + ${loopCtx.breakThreshold} + ")，提前安全退出循环。");`,
            );
            lines.push(`    break;`);
            lines.push(`  }`);
            lines.push(`  continue;`);
          } else if (inLoop) {
            lines.push(`  __missStreak += 1;`);
            lines.push(`  continue;`);
          }
          lines.push(`}`);
        }
        break;
      }

      case 'click_target': {
        const p = node.params as ClickTargetParams;
        if (p.mode === 'ocr_result') {
          const targetKey = p.targetVar.replace(/[^a-zA-Z0-9_$]/g, '_') || 'ocrMatch';
          lines.push(`if (ctx.vars[${escapeJsString(targetKey)}]) {`);
          lines.push(
            `  __clickOcrMatch(ctx.vars[${escapeJsString(targetKey)}], ${p.offsetXRatio}, ${p.offsetYRatio}, ${p.maxRetries}, ${p.retryDelayMs}, ${Boolean(p.preferNodeClick)});`,
          );
          lines.push(`  __safeSleep(${p.waitAfterMs});`);
          lines.push(`} else {`);
          lines.push(`  console.info("[Click] 目标变量为空，跳过点击:", ${escapeJsString(targetKey)});`);
          lines.push(`}`);
        } else {
          lines.push(
            `__clickNormPoint(${p.xRatio}, ${p.yRatio}, ${p.offsetXRatio}, ${p.offsetYRatio}, ${p.maxRetries}, ${p.retryDelayMs});`,
          );
          lines.push(`__safeSleep(${p.waitAfterMs});`);
        }
        break;
      }

      case 'swipe_wait': {
        const p = node.params as SwipeWaitParams;
        lines.push(
          `__swipeNorm(${p.x0Ratio}, ${p.y0Ratio}, ${p.x1Ratio}, ${p.y1Ratio}, ${p.durationMs});`,
        );
        lines.push(`__safeSleep(${p.waitAfterMs}, ${p.interruptible});`);
        break;
      }

      case 'mcp_call': {
        const p = node.params as McpCallParams;
        const safeVar = p.saveAsVar.replace(/[^a-zA-Z0-9_$]/g, '_') || 'mcpResult';
        const redactedArgs = redactTrafficPayload(p.args).redactedPayload;
        lines.push(
          `ctx.vars[${escapeJsString(safeVar)}] = __resolveCompiledMcpSnapshot(${escapeJsString(p.serverId)}, ${escapeJsString(p.toolName)}, ${JSON.stringify(redactedArgs)}, ${p.optional});`,
        );
        break;
      }

      case 'llm_refine': {
        const p = node.params as LlmRefineParams;
        const safeKey = p.targetVar.replace(/[^a-zA-Z0-9_$]/g, '_') || 'refinedKeywords';
        lines.push(
          `ctx.vars[${escapeJsString(safeKey)}] = __getVarArray(${escapeJsString(safeKey)}, ${JSON.stringify(p.fallbackKeywords)});`,
        );
        lines.push(
          `console.info("[LLM-Compiled] 已加载增强变量 (离线兜底就绪):", ${escapeJsString(safeKey)}, JSON.stringify(ctx.vars[${escapeJsString(safeKey)}]));`,
        );
        break;
      }

      case 'loop_block': {
        const p = node.params as LoopBlockParams;
        const loopId = node.id.replace(/[^a-zA-Z0-9_]/g, '_');
        const missKey = p.missVar.replace(/[^a-zA-Z0-9_$]/g, '_') || 'matchedTaskBtn';
        const missCounterVar = `__missStreak_${loopId}`;
        lines.push(`var ${missCounterVar} = 0;`);
        lines.push(`var __missStreak = 0;`);
        lines.push(
          `for (var __round_${loopId} = 1; __round_${loopId} <= ${p.maxIterations}; __round_${loopId}++) {`,
        );
        lines.push(`  __checkGlobalTimeout();`);
        lines.push(`  var __roundDeadline = Date.now() + ${p.perRoundTimeoutMs};`);
        lines.push(`  ctx.vars[${escapeJsString(missKey)}] = null;`);
        lines.push(
          `  console.info("[Loop] 开始第 " + __round_${loopId} + "/" + ${p.maxIterations} + " 轮", ${escapeJsString(node.label)});`,
        );
        lines.push(`  try {`);

        const childLines = compileNodeList(p.children, depth + 2, true, seen, appPackage, {
          missCounterVar,
          breakThreshold: p.breakWhenMissStreak,
        });
        lines.push(indent(childLines, 4));

        lines.push(`    if (!ctx.vars[${escapeJsString(missKey)}]) {`);
        lines.push(`      ${missCounterVar} += 1;`);
        lines.push(`      __missStreak = ${missCounterVar};`);
        lines.push(
          `      console.warn("[Loop] 本轮未命中", ${escapeJsString(missKey)}, "连续未命中:", ${missCounterVar});`,
        );
        lines.push(`      if (${missCounterVar} >= ${p.breakWhenMissStreak}) {`);
        lines.push(
          `        console.info("[Loop] 连续无命中达到阈值 (" + ${p.breakWhenMissStreak} + ")，提前安全退出循环。");`,
        );
        lines.push(`        break;`);
        lines.push(`      }`);
        lines.push(`    } else {`);
        lines.push(`      ${missCounterVar} = 0;`);
        lines.push(`      __missStreak = 0;`);
        lines.push(`    }`);
        lines.push(`  } catch (roundErr) {`);
        lines.push(`    if (roundErr && roundErr.__isGlobalTimeout) throw roundErr;`);
        lines.push(`    console.error("[RoundRecovery] 单轮异常/超时熔断:", roundErr && roundErr.message ? roundErr.message : roundErr);`);
        lines.push(`    __recoverRound(${escapeJsString(p.roundRecoveryAction)}, ${escapeJsString(appPackage)});`);
        lines.push(`    ${missCounterVar} += 1;`);
        lines.push(`    if (${missCounterVar} >= ${p.breakWhenMissStreak}) {`);
        lines.push(`      console.warn("[Loop] 恢复后连续失败达阈值，退出循环。");`);
        lines.push(`      break;`);
        lines.push(`    }`);
        lines.push(`  }`);
        lines.push(`}`);
        break;
      }
    }

    lines.push('');
  }

  return lines;
}

export function compileWorkflowToAutoJs6(
  ir: WorkflowIR,
  apiContractEndpoints: ApiContractEndpoint[] = [],
): CompileResult {
  const validation = validateWorkflowIR(ir);
  const counts = countNodes(ir.nodes);

  // Build compile-time sanitized RUNTIME_VARS with offline fallback values.
  const sanitizedVars: Record<string, { value: unknown; fallback: unknown; source: string }> = {};
  for (const [key, entry] of Object.entries(ir.variables)) {
    const cleanVal = redactTrafficPayload(entry.value).redactedPayload;
    const cleanFallback = redactTrafficPayload(entry.fallbackValue).redactedPayload;
    sanitizedVars[key] = {
      value: cleanVal,
      fallback: cleanFallback,
      source: entry.source,
    };
  }

  const compiledBodyLines = !validation.valid
    ? [
        `// [Compilation Halted] 工作流 IR 校验未通过（错误 ${validation.summary.errors} 项），已安全中止代码生成。`,
        ...validation.issues
          .filter((i) => i.level === 'error')
          .slice(0, 8)
          .map((i) => `// - ${sanitizeComment(i.message)}`),
        `throw new Error(${escapeJsString(
          validation.summary.circularDependencies > 0
            ? 'WorkflowIR validation failed: circular dependency detected.'
            : `WorkflowIR validation failed with ${validation.summary.errors} error(s).`,
        )});`,
      ]
    : compileNodeList(ir.nodes, 1, false, new WeakSet<object>(), ir.meta.appPackage);

  const riskKeywords =
    ir.policy.riskKeywords && ir.policy.riskKeywords.length > 0
      ? ir.policy.riskKeywords
      : ['检测到安全风险', '京东验证', '请完成验证', '安全验证'];
  const riskWaitTimeoutMs = ir.policy.riskWaitTimeoutMs ?? 90000;
  const preventConcurrentScripts = ir.policy.preventConcurrentScripts !== false;

  const script = `/**
 * ============================================================================
 * OmniForge Studio — AutoJs6 独立可运行自动化脚本
 * 工作流: ${sanitizeComment(ir.meta.name)} (${sanitizeComment(ir.meta.id)})
 * Schema: ${sanitizeComment(ir.schemaVersion)} | 目标包名: ${sanitizeComment(ir.meta.appPackage)}
 * 特性: 单实例防抢控 / 风控人工验证暂停 / 无障碍+OCR缓存混合识字 / 多层弹窗清理 / 落地页倒计时停留
 * 安全声明: 本导出脚本不包含任何 API Key、MCP Token 或抓包凭据
 * ============================================================================
 */
"auto";

var CONFIG = {
  APP_PACKAGE: ${escapeJsString(ir.meta.appPackage)},
  GLOBAL_TIMEOUT_MS: ${ir.policy.globalTimeoutMs},
  DEFAULT_ROUND_TIMEOUT_MS: ${ir.policy.defaultRoundTimeoutMs},
  GLOBAL_RECOVERY_ACTION: ${escapeJsString(ir.policy.globalRecoveryAction)},
  OCR_DEFAULT_ENGINE: ${escapeJsString(ir.policy.ocrDefaultEngine)},
  SAFE_SLEEP_SLICE_MS: ${ir.policy.safeSleepSliceMs},
  PREVENT_CONCURRENT_SCRIPTS: ${preventConcurrentScripts},
  RISK_KEYWORDS: ${JSON.stringify(riskKeywords)},
  RISK_WAIT_TIMEOUT_MS: ${riskWaitTimeoutMs}
};

// 编排期注入变量（已通过脱敏管道校验，保留离线运行兜底值）
var RUNTIME_VARS = ${JSON.stringify(sanitizedVars, null, 2)};

var ctx = {
  startedAt: Date.now(),
  globalDeadline: Date.now() + CONFIG.GLOBAL_TIMEOUT_MS,
  screenW: device.width || 1080,
  screenH: device.height || 2400,
  vars: {},
  ocrCacheKey: "",
  ocrCacheAt: 0,
  ocrCacheItems: null
};

function __getVarValue(key, defaultVal) {
  var entry = RUNTIME_VARS[key];
  if (entry && entry.value !== undefined && entry.value !== null && entry.value !== "") {
    return entry.value;
  }
  if (entry && entry.fallback !== undefined) {
    return entry.fallback;
  }
  return defaultVal;
}

function __getVarArray(key, defaultArr) {
  var val = __getVarValue(key, defaultArr);
  if (Array.isArray(val) && val.length > 0) return val;
  return Array.isArray(defaultArr) ? defaultArr : [];
}

function __resolveTemplate(tpl) {
  return String(tpl || "").replace(/\\$\\{([a-zA-Z0-9_]+)\\}/g, function (_, k) {
    return String(__getVarValue(k, ""));
  });
}

function __ensureSingleInstance() {
  if (!CONFIG.PREVENT_CONCURRENT_SCRIPTS || typeof engines === "undefined" || !engines.all) return;
  try {
    var myEngine = engines.myEngine();
    var mySrc = String(myEngine.getSource() || "");
    var all = engines.all();
    for (var i = 0; i < all.length; i++) {
      var eng = all[i];
      if (eng === myEngine) continue;
      var src = String(eng.getSource() || "");
      if (mySrc && src === mySrc) {
        console.warn("[Guard] 检测到同名脚本实例已在运行，自动停止旧实例防抢屏:", src);
        try { eng.forceStop(); } catch (stopErr) {}
      }
    }
  } catch (e) {
    console.warn("[Guard] 单实例检查跳过:", e);
  }
}

function __atRisk() {
  var kws = CONFIG.RISK_KEYWORDS || [];
  for (var i = 0; i < kws.length; i++) {
    try {
      if (textContains(kws[i]).exists()) return true;
    } catch (e) {}
  }
  return false;
}

function __waitRisk() {
  if (!__atRisk()) return true;
  console.warn("[Risk] 检测到风控安全验证，暂停等待人工完成（最多 " + Math.round(CONFIG.RISK_WAIT_TIMEOUT_MS / 1000) + "s）");
  try { toast("检测到安全验证，请手动完成后脚本自动继续"); } catch (e) {}
  var t0 = Date.now();
  while (Date.now() - t0 < CONFIG.RISK_WAIT_TIMEOUT_MS) {
    if (!__atRisk()) {
      var waited = Date.now() - t0;
      ctx.globalDeadline += waited;
      __ocrInvalidate();
      console.info("[Risk] 安全验证已通过，恢复执行");
      return true;
    }
    sleep(1500);
  }
  console.error("[Risk] 等待安全验证超时");
  return false;
}

function __checkGlobalTimeout() {
  if (__atRisk()) {
    if (!__waitRisk()) {
      var riskErr = new Error("风控安全验证等待超时");
      riskErr.__isGlobalTimeout = true;
      throw riskErr;
    }
  }
  if (Date.now() > ctx.globalDeadline) {
    var err = new Error("触发全局运行超时看门狗 (" + CONFIG.GLOBAL_TIMEOUT_MS + "ms)");
    err.__isGlobalTimeout = true;
    throw err;
  }
}

function __checkRoundTimeout(roundDeadline, stageLabel) {
  __checkGlobalTimeout();
  if (roundDeadline && Date.now() > roundDeadline) {
    throw new Error("单轮超时熔断 [" + stageLabel + "]");
  }
}

function __safeSleep(totalMs, interruptible) {
  if (interruptible === undefined) interruptible = true;
  var end = Date.now() + Math.max(0, totalMs || 0);
  var slice = Math.max(80, CONFIG.SAFE_SLEEP_SLICE_MS || 250);
  while (Date.now() < end) {
    __checkGlobalTimeout();
    if (!interruptible) {
      sleep(Math.min(slice, end - Date.now()));
    } else {
      sleep(Math.min(slice, Math.max(10, end - Date.now())));
    }
  }
}

function __normX(r) {
  return Math.round(Math.max(0, Math.min(1, r)) * ctx.screenW);
}

function __normY(r) {
  return Math.round(Math.max(0, Math.min(1, r)) * ctx.screenH);
}

function __normRegion(r) {
  var x = __normX(r.x0);
  var y = __normY(r.y0);
  var w = Math.max(1, __normX(r.x1) - x);
  var h = Math.max(1, __normY(r.y1) - y);
  return [x, y, w, h];
}

function __inScreenBounds(b) {
  return b && b.right > b.left && b.bottom > b.top && b.left >= 0 && b.top >= 0 && b.right <= ctx.screenW + 4 && b.bottom <= ctx.screenH + 4;
}

function __isInForbiddenYBand(bounds, band) {
  if (!band || !bounds) return false;
  var cy = (bounds.top + bounds.bottom) / 2;
  return cy >= __normY(band.y0) && cy <= __normY(band.y1);
}

function __ocrInvalidate() {
  ctx.ocrCacheKey = "";
  ctx.ocrCacheAt = 0;
  ctx.ocrCacheItems = null;
}

function __launchApp(pkg, waitMs, verifyForeground) {
  console.info("[Nav] 启动应用:", pkg);
  app.launchPackage(pkg);
  __ocrInvalidate();
  __safeSleep(waitMs);
  if (verifyForeground && currentPackage() !== pkg) {
    console.warn("[Nav] 当前前台包名为 " + currentPackage() + "，尝试重试启动 " + pkg);
    app.launchPackage(pkg);
    __ocrInvalidate();
    __safeSleep(Math.min(2500, waitMs));
  }
}

function __jumpScheme(template, encodeParams, waitMs, fallbackPkg) {
  var resolved = __resolveTemplate(template);
  var uri = resolved;
  if (encodeParams) {
    var qIdx = resolved.indexOf("?");
    if (qIdx !== -1) {
      var base = resolved.slice(0, qIdx);
      var query = resolved.slice(qIdx + 1);
      var encodedPairs = query.split("&").map(function (kv) {
        var idx = kv.indexOf("=");
        if (idx === -1) return kv;
        var k = kv.slice(0, idx);
        var v = kv.slice(idx + 1);
        var decoded = v;
        try { decoded = decodeURIComponent(v); } catch (decErr) { decoded = v; }
        return k + "=" + encodeURIComponent(decoded);
      });
      uri = base + "?" + encodedPairs.join("&");
    } else {
      uri = encodeURI(resolved);
    }
  }
  console.info("[Scheme] 跳转:", uri);
  try {
    var intentSpec = {
      action: "android.intent.action.VIEW",
      data: uri
    };
    if (fallbackPkg) intentSpec.packageName = fallbackPkg;
    app.startActivity(intentSpec);
  } catch (e) {
    console.warn("[Scheme] 跳转失败，回退包名启动:", fallbackPkg, e);
    if (fallbackPkg) app.launchPackage(fallbackPkg);
  }
  __ocrInvalidate();
  __safeSleep(waitMs);
}

function __captureScreenSafe() {
  if (!images.getScreenCaptureOptions || !images.captureScreen) {
    return null;
  }
  return images.captureScreen();
}

function __ocrRecognizeRegion(region, engine) {
  var cacheKey = [engine || CONFIG.OCR_DEFAULT_ENGINE, region.x0, region.y0, region.x1, region.y1].join(":");
  if (ctx.ocrCacheItems && ctx.ocrCacheKey === cacheKey && Date.now() - ctx.ocrCacheAt < 1500) {
    return ctx.ocrCacheItems;
  }
  var img = __captureScreenSafe();
  if (!img) return [];
  try {
    var clipRect = __normRegion(region);
    var cropped = images.clip(img, clipRect[0], clipRect[1], clipRect[2], clipRect[3]);
    var results = [];
    try {
      if (engine === "paddle" && typeof paddle !== "undefined" && paddle.ocr) {
        results = paddle.ocr(cropped) || [];
      } else if (typeof ocr !== "undefined" && ocr.detect) {
        results = ocr.detect(cropped) || [];
      }
    } finally {
      if (cropped && cropped.recycle) cropped.recycle();
    }
    var mapped = results.map(function (item) {
      var b = item.bounds || item.rect || { left: 0, top: 0, right: 40, bottom: 20 };
      return {
        text: String(item.text || item.label || "").replace(/\\s+/g, ""),
        bounds: {
          left: clipRect[0] + (b.left || 0),
          top: clipRect[1] + (b.top || 0),
          right: clipRect[0] + (b.right || 0),
          bottom: clipRect[1] + (b.bottom || 0)
        }
      };
    });
    ctx.ocrCacheKey = cacheKey;
    ctx.ocrCacheAt = Date.now();
    ctx.ocrCacheItems = mapped;
    return mapped;
  } finally {
    if (img && img.recycle) img.recycle();
  }
}

function __findAccessibilityCandidate(candidates, region, matchMode, forbiddenYBand) {
  var clipRect = __normRegion(region);
  var rx0 = clipRect[0], ry0 = clipRect[1], rx1 = clipRect[0] + clipRect[2], ry1 = clipRect[1] + clipRect[3];
  for (var c = 0; c < candidates.length; c++) {
    var kw = String(candidates[c] || "");
    if (!kw) continue;
    var nodes = [];
    try {
      if (matchMode === "exact") {
        var t1 = text(kw).findOnce();
        var d1 = desc(kw).findOnce();
        if (t1) nodes.push(t1);
        if (d1) nodes.push(d1);
      } else if (matchMode === "regex") {
        var t2 = textMatches(kw).findOnce();
        var d2 = descMatches(kw).findOnce();
        if (t2) nodes.push(t2);
        if (d2) nodes.push(d2);
      } else {
        var t3 = textContains(kw).find();
        for (var i = 0; i < Math.min(t3.size(), 12); i++) nodes.push(t3.get(i));
        var d3 = descContains(kw).find();
        for (var j = 0; j < Math.min(d3.size(), 12); j++) nodes.push(d3.get(j));
      }
    } catch (e) {}

    for (var k = 0; k < nodes.length; k++) {
      try {
        var nd = nodes[k];
        var b = nd.bounds();
        if (!__inScreenBounds(b) || b.width() < 12 || b.height() < 12) continue;
        var cx = (b.left + b.right) / 2;
        var cy = (b.top + b.bottom) / 2;
        if (cx < rx0 || cx > rx1 || cy < ry0 || cy > ry1) continue;
        if (__isInForbiddenYBand(b, forbiddenYBand)) continue;
        console.info("[A11y] 无障碍优先命中:", kw);
        return {
          text: String(nd.text() || nd.desc() || kw),
          bounds: { left: b.left, top: b.top, right: b.right, bottom: b.bottom },
          node: nd
        };
      } catch (nodeErr) {}
    }
  }
  return null;
}

function __ocrFindCandidates(candidates, region, engine, matchMode, opts) {
  opts = opts || {};
  if (opts.preferAccessibility) {
    var a11yHit = __findAccessibilityCandidate(candidates, region, matchMode, opts.forbiddenYBand);
    if (a11yHit) return a11yHit;
  }
  var items = __ocrRecognizeRegion(region, engine || CONFIG.OCR_DEFAULT_ENGINE);
  for (var c = 0; c < candidates.length; c++) {
    var kw = String(candidates[c] || "");
    if (!kw) continue;
    for (var i = 0; i < items.length; i++) {
      if (__isInForbiddenYBand(items[i].bounds, opts.forbiddenYBand)) continue;
      var txt = items[i].text;
      var matched = false;
      if (matchMode === "exact") matched = txt === kw;
      else if (matchMode === "regex") {
        try {
          matched = new RegExp(kw).test(txt);
        } catch (reErr) {
          console.warn("[OCR] 正则表达式无效:", kw, reErr && reErr.message ? reErr.message : reErr);
        }
      } else matched = txt.indexOf(kw) !== -1;
      if (matched) {
        console.info("[OCR] 命中候选词:", kw, "->", txt);
        return items[i];
      }
    }
  }
  return null;
}

function __clickOcrMatch(matchItem, offsetXRatio, offsetYRatio, maxRetries, retryDelayMs, preferNodeClick) {
  if (preferNodeClick && matchItem && matchItem.node && !offsetXRatio && !offsetYRatio) {
    try {
      if (matchItem.node.clickable() && matchItem.node.click()) {
        console.info("[Click] 无障碍 node.click() 命中成功");
        __ocrInvalidate();
        return true;
      }
    } catch (e) {}
  }
  var b = matchItem.bounds;
  var w = Math.max(1, b.right - b.left);
  var h = Math.max(1, b.bottom - b.top);
  var cx = Math.round(b.left + w * (0.5 + (offsetXRatio || 0)));
  var cy = Math.round(b.top + h * (0.5 + (offsetYRatio || 0)));
  for (var attempt = 0; attempt <= (maxRetries || 0); attempt++) {
    if (click(cx, cy)) {
      console.info("[Click] 坐标点击成功:", cx, cy);
      __ocrInvalidate();
      return true;
    }
    __safeSleep(retryDelayMs || 400);
  }
  return false;
}

function __clickNormPoint(xRatio, yRatio, offsetXRatio, offsetYRatio, maxRetries, retryDelayMs) {
  var cx = __normX(xRatio + (offsetXRatio || 0));
  var cy = __normY(yRatio + (offsetYRatio || 0));
  for (var attempt = 0; attempt <= (maxRetries || 0); attempt++) {
    if (click(cx, cy)) {
      console.info("[Click] 比例坐标点击成功:", cx, cy);
      __ocrInvalidate();
      return true;
    }
    __safeSleep(retryDelayMs || 400);
  }
  return false;
}

function __swipeNorm(x0, y0, x1, y1, durationMs) {
  swipe(__normX(x0), __normY(y0), __normX(x1), __normY(y1), durationMs || 600);
  __ocrInvalidate();
}

function __dismissSystemPrompts() {
  var cancelWords = ["取消", "以后再说", "暂不", "暂不开启", "不允许", "拒绝"];
  try {
    var hasSys = textMatches(/.*(定位未开启|开启定位|使用您的定位|需要定位|定位服务|立即安装|应用安装).*/).findOnce();
    if (hasSys) {
      for (var i = 0; i < cancelWords.length; i++) {
        var nd = text(cancelWords[i]).findOnce() || desc(cancelWords[i]).findOnce();
        if (nd) {
          var b = nd.bounds();
          if (__inScreenBounds(b) && b.width() > 12) {
            console.info("[Prompt] 关闭系统/定位/安装弹窗:", cancelWords[i]);
            click(Math.round((b.left + b.right) / 2), Math.round((b.top + b.bottom) / 2));
            __ocrInvalidate();
            __safeSleep(1000);
            return true;
          }
        }
      }
    }
  } catch (e) {}
  return false;
}

function __dismissPopups(opts) {
  var maxLayers = Math.max(1, Math.min(10, opts.maxLayers || 3));
  var kws = opts.dismissKeywords || ["暂时离开", "确定离开", "关闭", "我知道了", "取消"];
  var waitMs = opts.waitAfterClickMs || 1000;
  var closedAny = false;
  var modalHintRe = /成功抽中|恭喜获得|专属券|领更多奖励|整点再来|暂时离开|放弃福利|残忍离开/;

  for (var layer = 1; layer <= maxLayers; layer++) {
    __checkGlobalTimeout();
    var hit = false;

    // 1. 优先精确匹配显式离开/关闭文案（无障碍控件）
    for (var k = 0; k < kws.length && !hit; k++) {
      try {
        var nd = text(kws[k]).findOnce() || desc(kws[k]).findOnce();
        if (nd) {
          var b = nd.bounds();
          if (__inScreenBounds(b) && b.width() > 14 && b.height() > 14) {
            console.info("[Popup] 第 " + layer + " 层无障碍关闭:", kws[k]);
            if (!(nd.clickable() && nd.click())) {
              click(Math.round((b.left + b.right) / 2), Math.round((b.top + b.bottom) / 2));
            }
            __ocrInvalidate();
            __safeSleep(waitMs);
            hit = true;
            closedAny = true;
          }
        }
      } catch (e) {}
    }
    if (hit) continue;

    // 2. 查找无障碍 descContains('关闭')
    if (opts.useAccessibilityClose) {
      try {
        var closeArr = descContains("关闭").find();
        for (var i = 0; i < closeArr.size(); i++) {
          var cnd = closeArr.get(i);
          var cb = cnd.bounds();
          if (__inScreenBounds(cb) && cb.width() > 18 && cb.height() > 18) {
            console.info("[Popup] 第 " + layer + " 层无障碍 desc=关闭");
            click(Math.round((cb.left + cb.right) / 2), Math.round((cb.top + cb.bottom) / 2));
            __ocrInvalidate();
            __safeSleep(waitMs);
            hit = true;
            closedAny = true;
            break;
          }
        }
      } catch (e) {}
    }
    if (hit) continue;

    // 3. OCR 扫描关闭词并检测是否存在遮挡弹层文案
    var hasModalHint = false;
    var ocrItems = __ocrRecognizeRegion({ x0: 0.02, y0: 0.1, x1: 0.98, y1: 0.96 }, CONFIG.OCR_DEFAULT_ENGINE);
    for (var j = 0; j < ocrItems.length && !hit; j++) {
      var t = ocrItems[j].text;
      if (modalHintRe.test(t)) hasModalHint = true;
      for (var m = 0; m < kws.length; m++) {
        if (t === kws[m] || (kws[m].length >= 2 && t.indexOf(kws[m]) !== -1)) {
          var ob = ocrItems[j].bounds;
          console.info("[Popup] 第 " + layer + " 层 OCR 关闭:", t);
          click(Math.round((ob.left + ob.right) / 2), Math.round((ob.top + ob.bottom) / 2));
          __ocrInvalidate();
          __safeSleep(waitMs);
          hit = true;
          closedAny = true;
          break;
        }
      }
    }
    if (hit) continue;

    // 4. 图形 X 归一化坐标兜底（仅当屏幕存在弹窗特征文案时触发）
    if (hasModalHint && opts.fallbackClosePoint) {
      var fx = __normX(opts.fallbackClosePoint.xRatio);
      var fy = __normY(opts.fallbackClosePoint.yRatio);
      console.info("[Popup] 第 " + layer + " 层图形 X 兜底点击:", fx, fy);
      click(fx, fy);
      __ocrInvalidate();
      __safeSleep(waitMs);
      closedAny = true;
      continue;
    }

    if (hasModalHint && opts.fallbackBackOnMiss) {
      console.info("[Popup] 未命中关闭按钮，执行 back() 兜底");
      back();
      __ocrInvalidate();
      __safeSleep(waitMs);
      closedAny = true;
      continue;
    }

    break;
  }
  return closedAny;
}

function __ocrFindCountdown() {
  var items = __ocrRecognizeRegion({ x0: 0.02, y0: 0.08, x1: 0.98, y1: 0.92 }, CONFIG.OCR_DEFAULT_ENGINE);
  var now = new Date();
  var hh = now.getHours(), mi = now.getMinutes();
  var pad = function (v) { return (v < 10 ? "0" : "") + v; };
  var nowA = hh + ":" + pad(mi);
  var nowB = pad(hh) + ":" + pad(mi);
  for (var i = 0; i < items.length; i++) {
    var t = items[i].text;
    if (/^\\d{1,2}[:：]\\d{2}$/.test(t)) {
      var norm = t.replace("：", ":");
      if (norm === nowA || norm === nowB) continue;
      var sec = parseInt(norm.split(":")[1], 10);
      if (sec > 59) continue;
      return items[i];
    }
    if (/^\\d{1,2}[sS秒]$/.test(t) || /浏览\\d+[秒sS]/.test(t)) {
      return items[i];
    }
  }
  return null;
}

function __returnFromCrossApp() {
  if (!CONFIG.APP_PACKAGE || currentPackage() === CONFIG.APP_PACKAGE) return true;
  console.info("[CrossApp] 检测到跨 App 跳转(" + currentPackage() + ")，尝试底部手势条横滑切回");
  for (var attempt = 1; attempt <= 2; attempt++) {
    try {
      swipe(__normX(0.3), ctx.screenH - 12, __normX(0.72), ctx.screenH - 12, 120);
    } catch (e) {}
    __ocrInvalidate();
    __safeSleep(1400);
    if (currentPackage() === CONFIG.APP_PACKAGE) return true;
  }
  app.launchPackage(CONFIG.APP_PACKAGE);
  __ocrInvalidate();
  __safeSleep(1600);
  return currentPackage() === CONFIG.APP_PACKAGE;
}

function __doLandingStay(opts) {
  var targetMs = Math.max(1000, ((opts.targetStaySec || 15) + (opts.extraBufferSec || 2)) * 1000);
  var tStart = Date.now();
  var sawCountdown = false;
  var lastCdAt = 0;
  var retBtnHit = null;

  if (opts.handleCrossAppGestureBack) {
    __dismissSystemPrompts();
    __returnFromCrossApp();
  }

  console.info("[LandingStay] 开始停留，目标 " + Math.round(targetMs / 1000) + "s (倒计时检测=" + Boolean(opts.detectCountdown) + ")");
  while (true) {
    __checkGlobalTimeout();
    __dismissSystemPrompts();
    var elapsed = Date.now() - tStart;
    __ocrInvalidate();

    if (opts.detectCountdown) {
      var cd = __ocrFindCountdown();
      if (cd) {
        if (!sawCountdown) console.info("[LandingStay] 检测到页面倒计时:", cd.text);
        sawCountdown = true;
        lastCdAt = Date.now();
      }
    }

    if (opts.returnButtonKeyword) {
      var rb = __ocrFindCandidates(
        [opts.returnButtonKeyword],
        { x0: 0.02, y0: 0.05, x1: 0.98, y1: 0.95 },
        CONFIG.OCR_DEFAULT_ENGINE,
        "contains",
        { preferAccessibility: true }
      );
      if (rb && ((sawCountdown && Date.now() - lastCdAt > 1500) || (!sawCountdown && elapsed >= targetMs))) {
        retBtnHit = rb;
        break;
      }
    }

    if (sawCountdown) {
      if (Date.now() - lastCdAt > 5500 && elapsed >= 3000) {
        console.info("[LandingStay] 倒计时归零，准备返回");
        break;
      }
      if (elapsed > Math.max(targetMs + 45000, 90000)) {
        console.warn("[LandingStay] 倒计时等待超时，强制返回");
        break;
      }
    } else if (elapsed >= targetMs) {
      console.info("[LandingStay] 已满足目标停留时长，准备返回");
      break;
    }
    __safeSleep(650);
  }

  if (retBtnHit) {
    console.info("[LandingStay] 点击页面返回按钮:", opts.returnButtonKeyword);
    __clickOcrMatch(retBtnHit, 0, 0, 1, 400, true);
    __safeSleep(1600);
  } else {
    back();
    __ocrInvalidate();
    __safeSleep(1500);
  }

  if (opts.dismissRetentionPopups) {
    __dismissPopups({
      maxLayers: 2,
      dismissKeywords: opts.retentionKeywords || ["暂时离开", "确定离开", "残忍离开", "放弃福利", "取消"],
      useAccessibilityClose: true,
      fallbackClosePoint: { xRatio: 0.495, yRatio: 0.898 },
      fallbackBackOnMiss: true,
      waitAfterClickMs: 1400
    });
  }

  if (opts.verifyBaseKeyword) {
    var maxBacks = Math.max(1, opts.maxBackAttempts || 2);
    for (var bTry = 0; bTry < maxBacks; bTry++) {
      __ocrInvalidate();
      var onBase = __ocrFindCandidates(
        [opts.verifyBaseKeyword],
        { x0: 0.02, y0: 0.05, x1: 0.98, y1: 0.95 },
        CONFIG.OCR_DEFAULT_ENGINE,
        "contains",
        { preferAccessibility: true }
      );
      if (onBase) return true;
      if (currentPackage() !== CONFIG.APP_PACKAGE) break;
      console.info("[LandingStay] 尚未回到基准页「" + opts.verifyBaseKeyword + "」，补发 back(" + (bTry + 1) + "/" + maxBacks + ")");
      back();
      __ocrInvalidate();
      __safeSleep(1400);
    }
  }
  return true;
}

function __backAndVerify(times, intervalMs, expectKeyword, engine, dismissRetentionPopups, maxExtraBacks) {
  for (var i = 0; i < (times || 1); i++) {
    back();
    __ocrInvalidate();
    __safeSleep(intervalMs || 1000);
    if (dismissRetentionPopups) {
      __dismissPopups({
        maxLayers: 2,
        dismissKeywords: ["暂时离开", "确定离开", "残忍离开", "放弃福利", "取消"],
        useAccessibilityClose: true,
        fallbackClosePoint: { xRatio: 0.495, yRatio: 0.898 },
        fallbackBackOnMiss: false,
        waitAfterClickMs: 1000
      });
    }
  }
  if (expectKeyword) {
    var attempts = Math.max(0, maxExtraBacks || 0);
    for (var extra = 0; extra <= attempts; extra++) {
      __ocrInvalidate();
      var check = __ocrFindCandidates(
        [expectKeyword],
        { x0: 0.02, y0: 0.05, x1: 0.98, y1: 0.95 },
        engine,
        "contains",
        { preferAccessibility: true }
      );
      if (check) return true;
      if (extra < attempts && currentPackage() === CONFIG.APP_PACKAGE) {
        console.warn("[Verify] 未检测到基准词「" + expectKeyword + "」，补发返回 (" + (extra + 1) + "/" + attempts + ")");
        back();
        __ocrInvalidate();
        __safeSleep(intervalMs || 1000);
      }
    }
    console.warn("[Verify] 返回后未检测到基准关键词:", expectKeyword);
  }
  return false;
}

function __recoverRound(action, pkg) {
  if (action === "relaunch" && pkg) {
    app.launchPackage(pkg);
    __ocrInvalidate();
    __safeSleep(2200);
  } else if (action === "back") {
    back();
    __ocrInvalidate();
    __safeSleep(1000);
  }
}

function __resolveCompiledMcpSnapshot(serverId, toolName, sanitizedArgs, optional) {
  // 离线安全模式：不携带任何远端凭据或直连硬编码密钥，仅读取编排期固化变量
  console.info("[MCP-Offline] " + serverId + "." + toolName + " args=" + JSON.stringify(sanitizedArgs) + " optional=" + optional);
  return { compiledOffline: true, serverId: serverId, toolName: toolName };
}

function __executeGlobalRecovery() {
  if (CONFIG.GLOBAL_RECOVERY_ACTION === "home_and_exit") {
    home();
  } else if (CONFIG.GLOBAL_RECOVERY_ACTION === "back_to_app") {
    back();
  }
}

function main() {
  __ensureSingleInstance();
  console.info("[OmniForge] 启动工作流:", ${escapeJsString(ir.meta.name)});
  if (!requestScreenCapture(false)) {
    throw new Error("未授予屏幕截图权限，无法执行 OCR 识字。");
  }

  try {
${indent(compiledBodyLines, 4)}
    console.info("[OmniForge] 流程执行完成，总耗时(ms):", Date.now() - ctx.startedAt);
  } catch (err) {
    console.error("[OmniForge] 流程中断:", err && err.message ? err.message : err);
    __executeGlobalRecovery();
  } finally {
    threads.shutDownAll();
  }
}

main();
`;

  const secretFindings = assertNoPlaintextSecrets(script);
  const seenJson = new WeakSet<object>();
  const irJson = JSON.stringify(
    ir,
    (_key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seenJson.has(value)) return '[CircularNodeRef]';
        seenJson.add(value);
      }
      return value;
    },
    2,
  );
  const apiContractJson = JSON.stringify(
    {
      schemaVersion: '1.0.0',
      generatedFrom: ir.meta.id,
      redacted: true,
      endpoints: apiContractEndpoints,
    },
    null,
    2,
  );

  return {
    script,
    irJson,
    apiContractJson,
    stats: {
      totalNodes: counts.total,
      enabledNodes: counts.enabled,
      disabledNodes: counts.disabled,
      estimatedWatchdogSec: Math.round(ir.policy.globalTimeoutMs / 1000),
      lineCount: script.split('\n').length,
      secretScanPassed: secretFindings.length === 0,
      secretFindings,
    },
    validation,
  };
}
