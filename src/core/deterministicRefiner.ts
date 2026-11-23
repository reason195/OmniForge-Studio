export interface DeterministicRefinerInput {
  fallbackKeywords: string[];
  autojsDeviceState: unknown;
  redactedProxyPinTraffic: unknown;
}

export interface DeterministicRefineResult {
  refinedKeywords: string[];
  recommendedBrowseWaitMs: number;
  branchConditions: Array<{
    when: string;
    action: string;
    reason: string;
  }>;
  extractedApiHints: Array<{
    endpoint: string;
    field: string;
    meaning: string;
  }>;
  scriptSnippet: string;
  modelUsed: string;
}

const TERMINAL_TEXTS = new Set(['已完成', '已领取', 'DONE', 'COMPLETED', '已结束', '已失效']);

export const DETERMINISTIC_MODEL_ID = 'deterministic-rule-engine-v1';

export function runDeterministicRefiner(input: DeterministicRefinerInput): DeterministicRefineResult {
  const keywordScores = new Map<string, number>();
  const addCandidate = (text: string, weight: number) => {
    const clean = text.trim();
    if (!clean || TERMINAL_TEXTS.has(clean)) return;
    keywordScores.set(clean, (keywordScores.get(clean) || 0) + weight);
  };

  let maxBrowseSec = 15;
  const extractedApiHints: Array<{ endpoint: string; field: string; meaning: string }> = [];

  // 1. Inspect AutoJs6 device/UI state
  const dev = (input.autojsDeviceState && typeof input.autojsDeviceState === 'object'
    ? input.autojsDeviceState
    : {}) as Record<string, unknown>;
  if (Array.isArray(dev.visibleActionTexts)) {
    for (const txt of dev.visibleActionTexts) {
      if (typeof txt === 'string' && /^(去|立即|马上|点击|继续|领取|签到|逛|看)/.test(txt.trim())) {
        addCandidate(txt, 3);
      }
    }
  }

  // 2. Inspect redacted ProxyPin flows
  const traffic = (input.redactedProxyPinTraffic && typeof input.redactedProxyPinTraffic === 'object'
    ? input.redactedProxyPinTraffic
    : {}) as Record<string, unknown>;
  const flows = Array.isArray(traffic.flows) ? traffic.flows : [];

  for (const rawFlow of flows) {
    if (!rawFlow || typeof rawFlow !== 'object') continue;
    const flow = rawFlow as Record<string, unknown>;
    const pathStr = String(flow.path || flow.url || '/unknown');
    const body = (flow.responseBody && typeof flow.responseBody === 'object'
      ? flow.responseBody
      : {}) as Record<string, unknown>;
    const dataObj = (body.data && typeof body.data === 'object' ? body.data : body) as Record<string, unknown>;
    const tasks = Array.isArray(dataObj.tasks) ? dataObj.tasks : [];

    if (tasks.length > 0) {
      extractedApiHints.push({
        endpoint: pathStr,
        field: 'data.tasks[].buttonText / browseSeconds',
        meaning: '可执行任务按钮文案与最短浏览秒数',
      });
    }

    for (const rawTask of tasks) {
      if (!rawTask || typeof rawTask !== 'object') continue;
      const t = rawTask as Record<string, unknown>;
      const status = String(t.status || '').toUpperCase();
      const btn = String(t.buttonText || '');
      if (status !== 'DONE' && status !== 'COMPLETED' && btn) {
        addCandidate(btn, status === 'CLAIMABLE' ? 5 : 4);
      }
      if (typeof t.browseSeconds === 'number' && t.browseSeconds > 0) {
        maxBrowseSec = Math.max(maxBrowseSec, t.browseSeconds);
      }
    }

    if (typeof body.nextActionHint === 'string' && body.nextActionHint) {
      extractedApiHints.push({
        endpoint: pathStr,
        field: 'nextActionHint',
        meaning: body.nextActionHint,
      });
    }
  }

  // 3. Merge fallback keywords with lower priority
  for (const fb of input.fallbackKeywords) {
    addCandidate(fb, 1);
  }

  const sortedKeywords = Array.from(keywordScores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);

  const refinedKeywords = sortedKeywords.length > 0 ? sortedKeywords : input.fallbackKeywords;
  const recommendedBrowseWaitMs = maxBrowseSec * 1000 + 1000;

  return {
    refinedKeywords,
    recommendedBrowseWaitMs,
    branchConditions: [
      {
        when: 'OCR 识别结果仅出现“已完成/已领取”或连续 3 轮未命中',
        action: 'break loop',
        reason: '依据任务状态字段与终态词过滤策略提前安全退出',
      },
      {
        when: '单轮执行超出 perRoundTimeoutMs',
        action: 'back() 后校验任务基准页',
        reason: '防止弹窗遮挡或 H5 卡死导致流程空转',
      },
    ],
    extractedApiHints:
      extractedApiHints.length > 0
        ? extractedApiHints
        : [
            {
              endpoint: 'local-fallback',
              field: 'fallbackKeywords',
              meaning: '未提供抓包流时沿用工作流兜底关键词',
            },
          ],
    scriptSnippet: `var matched = __ocrFindCandidates(${JSON.stringify(refinedKeywords)}, { x0: 0.62, y0: 0.24, x1: 0.96, y1: 0.88 }, "paddle", "contains");`,
    modelUsed: DETERMINISTIC_MODEL_ID,
  };
}
