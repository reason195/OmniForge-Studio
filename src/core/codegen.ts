import {
  type BackCheckParams,
  type ClickTargetParams,
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
          `__backAndVerify(${p.times}, ${p.intervalMs}, ${escapeJsString(p.expectKeyword)}, ${escapeJsString(p.ocrEngine)});`,
        );
        break;
      }

      case 'ocr_find': {
        const p = node.params as OcrFindParams;
        const varRefExpr = p.variableRef.trim()
          ? `__getVarArray(${escapeJsString(p.variableRef)}, ${JSON.stringify(p.candidates)})`
          : JSON.stringify(p.candidates);
        const safeVar = p.saveMatchVar.replace(/[^a-zA-Z0-9_$]/g, '_') || 'ocrMatch';
        lines.push(
          `var ${safeVar} = __ocrFindCandidates(${varRefExpr}, ${JSON.stringify(p.region)}, ${escapeJsString(p.engine)}, ${escapeJsString(p.matchMode)});`,
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
            `  __clickOcrMatch(ctx.vars[${escapeJsString(targetKey)}], ${p.offsetXRatio}, ${p.offsetYRatio}, ${p.maxRetries}, ${p.retryDelayMs});`,
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

  const script = `/**
 * ============================================================================
 * OmniForge Studio — AutoJs6 独立可运行自动化脚本
 * 工作流: ${sanitizeComment(ir.meta.name)} (${sanitizeComment(ir.meta.id)})
 * Schema: ${sanitizeComment(ir.schemaVersion)} | 目标包名: ${sanitizeComment(ir.meta.appPackage)}
 * 特性: 全局超时看门狗 / 单轮超时熔断恢复 / 归一化坐标换算 / 连续无命中退出 / 离线兜底
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
  SAFE_SLEEP_SLICE_MS: ${ir.policy.safeSleepSliceMs}
};

// 编排期注入变量（已通过脱敏管道校验，保留离线运行兜底值）
var RUNTIME_VARS = ${JSON.stringify(sanitizedVars, null, 2)};

var ctx = {
  startedAt: Date.now(),
  globalDeadline: Date.now() + CONFIG.GLOBAL_TIMEOUT_MS,
  screenW: device.width || 1080,
  screenH: device.height || 2400,
  vars: {}
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

function __checkGlobalTimeout() {
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

function __launchApp(pkg, waitMs, verifyForeground) {
  console.info("[Nav] 启动应用:", pkg);
  app.launchPackage(pkg);
  __safeSleep(waitMs);
  if (verifyForeground && currentPackage() !== pkg) {
    console.warn("[Nav] 当前前台包名为 " + currentPackage() + "，尝试重试启动 " + pkg);
    app.launchPackage(pkg);
    __safeSleep(Math.min(2500, waitMs));
  }
}

function __jumpScheme(template, encodeParams, waitMs, fallbackPkg) {
  var resolved = __resolveTemplate(template);
  var uri = resolved;
  if (encodeParams) {
    var parts = resolved.split("?");
    if (parts.length === 2) {
      var encodedPairs = parts[1].split("&").map(function (kv) {
        var idx = kv.indexOf("=");
        if (idx === -1) return kv;
        var k = kv.slice(0, idx);
        var v = kv.slice(idx + 1);
        return k + "=" + encodeURIComponent(decodeURIComponent(v));
      });
      uri = parts[0] + "?" + encodedPairs.join("&");
    } else {
      uri = encodeURI(resolved);
    }
  }
  console.info("[Scheme] 跳转:", uri);
  try {
    app.startActivity({
      action: "android.intent.action.VIEW",
      data: uri
    });
  } catch (e) {
    console.warn("[Scheme] 跳转失败，回退包名启动:", fallbackPkg, e);
    if (fallbackPkg) app.launchPackage(fallbackPkg);
  }
  __safeSleep(waitMs);
}

function __captureScreenSafe() {
  if (!images.getScreenCaptureOptions || !images.captureScreen) {
    return null;
  }
  return images.captureScreen();
}

function __ocrRecognizeRegion(region, engine) {
  var img = __captureScreenSafe();
  if (!img) return [];
  try {
    var clipRect = __normRegion(region);
    var cropped = images.clip(img, clipRect[0], clipRect[1], clipRect[2], clipRect[3]);
    var results = [];
    if (engine === "paddle" && typeof paddle !== "undefined" && paddle.ocr) {
      results = paddle.ocr(cropped) || [];
    } else if (typeof ocr !== "undefined" && ocr.detect) {
      results = ocr.detect(cropped) || [];
    }
    cropped.recycle();
    return results.map(function (item) {
      var b = item.bounds || item.rect || { left: 0, top: 0, right: 40, bottom: 20 };
      return {
        text: String(item.text || item.label || ""),
        bounds: {
          left: clipRect[0] + (b.left || 0),
          top: clipRect[1] + (b.top || 0),
          right: clipRect[0] + (b.right || 0),
          bottom: clipRect[1] + (b.bottom || 0)
        }
      };
    });
  } finally {
    if (img && img.recycle) img.recycle();
  }
}

function __ocrFindCandidates(candidates, region, engine, matchMode) {
  var items = __ocrRecognizeRegion(region, engine || CONFIG.OCR_DEFAULT_ENGINE);
  for (var c = 0; c < candidates.length; c++) {
    var kw = String(candidates[c] || "");
    if (!kw) continue;
    for (var i = 0; i < items.length; i++) {
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

function __clickOcrMatch(matchItem, offsetXRatio, offsetYRatio, maxRetries, retryDelayMs) {
  var b = matchItem.bounds;
  var w = Math.max(1, b.right - b.left);
  var h = Math.max(1, b.bottom - b.top);
  var cx = Math.round(b.left + w * (0.5 + (offsetXRatio || 0)));
  var cy = Math.round(b.top + h * (0.5 + (offsetYRatio || 0)));
  for (var attempt = 0; attempt <= (maxRetries || 0); attempt++) {
    if (click(cx, cy)) {
      console.info("[Click] 点击成功:", cx, cy);
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
      return true;
    }
    __safeSleep(retryDelayMs || 400);
  }
  return false;
}

function __swipeNorm(x0, y0, x1, y1, durationMs) {
  swipe(__normX(x0), __normY(y0), __normX(x1), __normY(y1), durationMs || 600);
}

function __backAndVerify(times, intervalMs, expectKeyword, engine) {
  for (var i = 0; i < (times || 1); i++) {
    back();
    __safeSleep(intervalMs || 800);
  }
  if (expectKeyword) {
    var check = __ocrFindCandidates([expectKeyword], { x0: 0.02, y0: 0.05, x1: 0.98, y1: 0.95 }, engine, "contains");
    if (!check) {
      console.warn("[Verify] 返回后未检测到基准关键词:", expectKeyword);
    }
  }
}

function __recoverRound(action, pkg) {
  if (action === "relaunch" && pkg) {
    app.launchPackage(pkg);
    __safeSleep(2200);
  } else if (action === "back") {
    back();
    __safeSleep(900);
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
