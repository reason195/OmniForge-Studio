import { GoogleGenAI, Type } from '@google/genai';
import { DETERMINISTIC_MODEL_ID, runDeterministicRefiner } from '../core/deterministicRefiner';
import { assertNoPlaintextSecrets, redactTrafficPayload } from '../core/redaction';

export type ConcreteProviderId =
  | 'gemini'
  | 'openai_compatible'
  | 'ollama'
  | 'lmstudio'
  | 'deterministic_rules';

export type LlmProviderId = 'auto' | ConcreteProviderId;

export interface LlmRefineInput {
  goal: string;
  workflowName: string;
  appPackage: string;
  fallbackKeywords: string[];
  autojsState?: unknown;
  proxypinTraffic?: unknown;
  provider?: LlmProviderId;
  timeoutMs?: number;
}

export interface SanitizedRefineContext {
  goal: string;
  workflowName: string;
  appPackage: string;
  fallbackKeywords: string[];
  autojsDeviceState: unknown;
  redactedProxyPinTraffic: unknown;
  timeoutMs: number;
}

export interface RawRefineResult {
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

export interface LlmRefineOutput extends RawRefineResult {
  providerUsed: ConcreteProviderId;
  providerLabel: string;
  providerKind: 'cloud' | 'local_llm' | 'deterministic';
  routingNote: string;
  redactionStats: {
    redactedKeyCount: number;
    maskedPatternCount: number;
    truncatedCount: number;
  };
}

export interface ProviderStatusInfo {
  id: LlmProviderId;
  label: string;
  kind: 'router' | 'cloud' | 'local_llm' | 'deterministic';
  available: boolean;
  reason?: string;
  defaultModel: string;
}

export interface LlmProviderAdapter {
  readonly id: ConcreteProviderId;
  readonly label: string;
  readonly kind: 'cloud' | 'local_llm' | 'deterministic';
  readonly defaultModel: string;
  isAvailable(env?: NodeJS.ProcessEnv): { available: boolean; reason?: string };
  refine(ctx: SanitizedRefineContext, env?: NodeJS.ProcessEnv): Promise<RawRefineResult>;
}

const SYSTEM_PROMPT =
  '你是资深移动端自动化与抓包协议分析工程师。严禁输出任何硬编码密钥、Token 或真实手机号。必须严格按 JSON 格式返回结果，包含 refinedKeywords (string[])、recommendedBrowseWaitMs (integer)、branchConditions (array of {when, action, reason})、extractedApiHints (array of {endpoint, field, meaning})、scriptSnippet (string)。按钮候选词应按可执行优先级排序，排除“已完成”等终态词。';

function extractMappedIpv4Octets(hostname: string): [number, number, number, number] | null {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map(Number);
    if (octets.every((n) => n >= 0 && n <= 255)) {
      return [octets[0], octets[1], octets[2], octets[3]];
    }
    return null;
  }
  const dottedMapped = /^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (dottedMapped) {
    const octets = dottedMapped.slice(1).map(Number);
    if (octets.every((n) => n >= 0 && n <= 255)) {
      return [octets[0], octets[1], octets[2], octets[3]];
    }
  }
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
  }
  return null;
}

function isCloudMetadataHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '169.254.169.254' || h === 'metadata.google.internal' || h === 'metadata.goog' || h === '0.0.0.0') {
    return true;
  }
  const octets = extractMappedIpv4Octets(h);
  return Boolean(octets && ((octets[0] === 169 && octets[1] === 254) || octets[0] === 0));
}

function isLocalhostOrPrivate(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '::') return true;
  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  const octets = extractMappedIpv4Octets(h);
  if (!octets) return false;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

export function validateProviderEndpointUrl(
  baseUrl: string,
  allowLocal: boolean,
): { valid: boolean; reason?: string; normalizedUrl?: string } {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { valid: false, reason: '模型服务端点 URL 格式无效。' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: `不支持的协议 "${parsed.protocol}"。` };
  }
  if (isCloudMetadataHost(parsed.hostname)) {
    return { valid: false, reason: '安全策略拦截：禁止访问云元数据地址。' };
  }
  if (!allowLocal && isLocalhostOrPrivate(parsed.hostname)) {
    return {
      valid: false,
      reason: '当前环境未启用本地推理桥接（需设置 LLM_ALLOW_LOCAL_INFERENCE=true 或在原生桌面/移动端运行）。',
    };
  }
  return { valid: true, normalizedUrl: parsed.toString().replace(/\/+$/, '') };
}

function normalizeParsedJson(raw: unknown, fallbackKeywords: string[], modelUsed: string): RawRefineResult {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kw = Array.isArray(obj.refinedKeywords)
    ? obj.refinedKeywords.map((x) => String(x).trim()).filter(Boolean)
    : [];
  const wait =
    typeof obj.recommendedBrowseWaitMs === 'number' && Number.isFinite(obj.recommendedBrowseWaitMs)
      ? Math.max(1000, Math.min(120000, Math.round(obj.recommendedBrowseWaitMs)))
      : 16000;
  const branchConditions = Array.isArray(obj.branchConditions)
    ? obj.branchConditions.slice(0, 8).map((item) => {
        const rec = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        return {
          when: String(rec.when || ''),
          action: String(rec.action || ''),
          reason: String(rec.reason || ''),
        };
      })
    : [];
  const extractedApiHints = Array.isArray(obj.extractedApiHints)
    ? obj.extractedApiHints.slice(0, 10).map((item) => {
        const rec = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        return {
          endpoint: String(rec.endpoint || ''),
          field: String(rec.field || ''),
          meaning: String(rec.meaning || ''),
        };
      })
    : [];

  let scriptSnippet = String(obj.scriptSnippet || '').trim();
  if (!scriptSnippet) {
    scriptSnippet = `var target = __ocrFindCandidates(${JSON.stringify(kw.length > 0 ? kw : fallbackKeywords)}, { x0: 0.6, y0: 0.22, x1: 0.96, y1: 0.88 }, "paddle", "contains");`;
  }

  // Strip code fences if any model wrapped JSON in markdown
  const secretFindings = assertNoPlaintextSecrets(scriptSnippet);
  if (secretFindings.length > 0) {
    throw new Error(`模型输出的脚本片段未通过安全密钥扫描: ${secretFindings.join(', ')}`);
  }

  return {
    refinedKeywords: kw.length > 0 ? kw : fallbackKeywords,
    recommendedBrowseWaitMs: wait,
    branchConditions,
    extractedApiHints,
    scriptSnippet,
    modelUsed,
  };
}

function parseJsonWithCodeFenceFallback(text: string): unknown {
  const trimmed = text.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return JSON.parse(fenceMatch ? fenceMatch[1] : trimmed);
}

// ============================================================================
// 1. Cloud Adapter: Google Gemini (@google/genai)
// ============================================================================
export class GeminiProviderAdapter implements LlmProviderAdapter {
  readonly id = 'gemini' as const;
  readonly label = 'Gemini 云端推理 (@google/genai)';
  readonly kind = 'cloud' as const;
  readonly defaultModel = 'gemini-4-hydrogen';

  isAvailable(env: NodeJS.ProcessEnv = process.env) {
    const key = env.GEMINI_API_KEY;
    if (!key || key === 'MY_GEMINI_API_KEY') {
      return { available: false, reason: '未配置 GEMINI_API_KEY（可在 Settings > Secrets 中设置）' };
    }
    return { available: true };
  }

  async refine(ctx: SanitizedRefineContext, env: NodeJS.ProcessEnv = process.env): Promise<RawRefineResult> {
    const avail = this.isAvailable(env);
    if (!avail.available) {
      throw new Error(avail.reason || 'GEMINI_API_KEY 尚未配置。');
    }

    const ai = new GoogleGenAI({
      apiKey: env.GEMINI_API_KEY,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const response = await ai.models.generateContent({
      model: this.defaultModel,
      contents:
        '请基于以下经过脱敏的移动端自动化上下文（AutoJs6 设备状态 + ProxyPin 抓包接口），提炼精准的 OCR 按钮候选词优先级、等待时间、分支恢复条件和一段可直接插入 AutoJs6 的轻量判断片段：\n' +
        JSON.stringify(ctx, null, 2),
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            refinedKeywords: { type: Type.ARRAY, items: { type: Type.STRING } },
            recommendedBrowseWaitMs: { type: Type.INTEGER },
            branchConditions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  when: { type: Type.STRING },
                  action: { type: Type.STRING },
                  reason: { type: Type.STRING },
                },
                required: ['when', 'action', 'reason'],
              },
            },
            extractedApiHints: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  endpoint: { type: Type.STRING },
                  field: { type: Type.STRING },
                  meaning: { type: Type.STRING },
                },
                required: ['endpoint', 'field', 'meaning'],
              },
            },
            scriptSnippet: { type: Type.STRING },
          },
          required: [
            'refinedKeywords',
            'recommendedBrowseWaitMs',
            'branchConditions',
            'extractedApiHints',
            'scriptSnippet',
          ],
        },
      },
    });

    const text = (response.text || '').trim();
    if (!text) throw new Error('Gemini 模型返回为空。');
    return normalizeParsedJson(JSON.parse(text), ctx.fallbackKeywords, this.defaultModel);
  }
}

// ============================================================================
// 2. Cloud Adapter: OpenAI-Compatible Chat Completions
// ============================================================================
export class OpenAICompatibleProviderAdapter implements LlmProviderAdapter {
  readonly id = 'openai_compatible' as const;
  readonly label = 'OpenAI 兼容云端接口';
  readonly kind = 'cloud' as const;
  readonly defaultModel = 'gpt-4o-mini';

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  isAvailable(env: NodeJS.ProcessEnv = process.env) {
    const key = env.OPENAI_COMPAT_API_KEY;
    const base = env.OPENAI_COMPAT_BASE_URL;
    if (!key || !base) {
      return {
        available: false,
        reason: '未配置服务端 OPENAI_COMPAT_BASE_URL 与 OPENAI_COMPAT_API_KEY',
      };
    }
    const urlCheck = validateProviderEndpointUrl(base, env.LLM_ALLOW_LOCAL_INFERENCE === 'true');
    if (!urlCheck.valid) return { available: false, reason: urlCheck.reason };
    return { available: true };
  }

  async refine(ctx: SanitizedRefineContext, env: NodeJS.ProcessEnv = process.env): Promise<RawRefineResult> {
    const avail = this.isAvailable(env);
    if (!avail.available) throw new Error(avail.reason || 'OpenAI 兼容接口未配置。');

    const baseUrl = (env.OPENAI_COMPAT_BASE_URL || '').replace(/\/+$/, '');
    const model = env.OPENAI_COMPAT_MODEL || this.defaultModel;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);

    try {
      const res = await this.fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.OPENAI_COMPAT_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(ctx) },
          ],
        }),
        redirect: 'error',
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`OpenAI 兼容接口请求失败: ${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('OpenAI 兼容接口返回缺少 message.content。');
      return normalizeParsedJson(parseJsonWithCodeFenceFallback(content), ctx.fallbackKeywords, model);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ============================================================================
// 3. Local Inference Adapter: Ollama (/api/chat)
// ============================================================================
export class OllamaProviderAdapter implements LlmProviderAdapter {
  readonly id = 'ollama' as const;
  readonly label = 'Ollama 本地推理服务';
  readonly kind = 'local_llm' as const;
  readonly defaultModel = 'qwen2.5:7b';

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  isAvailable(env: NodeJS.ProcessEnv = process.env) {
    const base = env.OLLAMA_BASE_URL;
    if (!base) {
      return { available: false, reason: '未配置 OLLAMA_BASE_URL（例如 http://127.0.0.1:11434）' };
    }
    const urlCheck = validateProviderEndpointUrl(base, env.LLM_ALLOW_LOCAL_INFERENCE === 'true');
    if (!urlCheck.valid) return { available: false, reason: urlCheck.reason };
    return { available: true };
  }

  async refine(ctx: SanitizedRefineContext, env: NodeJS.ProcessEnv = process.env): Promise<RawRefineResult> {
    const avail = this.isAvailable(env);
    if (!avail.available) throw new Error(avail.reason || 'Ollama 服务不可用。');

    const baseUrl = (env.OLLAMA_BASE_URL || '').replace(/\/+$/, '');
    const model = env.OLLAMA_MODEL || this.defaultModel;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);

    try {
      const res = await this.fetchImpl(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          format: 'json',
          stream: false,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(ctx) },
          ],
        }),
        redirect: 'error',
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Ollama 请求失败: ${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as { message?: { content?: string } };
      const content = data.message?.content;
      if (!content) throw new Error('Ollama 返回缺少 message.content。');
      return normalizeParsedJson(parseJsonWithCodeFenceFallback(content), ctx.fallbackKeywords, model);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ============================================================================
// 4. Local Inference Adapter: LM Studio (/v1/chat/completions)
// ============================================================================
export class LmStudioProviderAdapter implements LlmProviderAdapter {
  readonly id = 'lmstudio' as const;
  readonly label = 'LM Studio 本地推理服务';
  readonly kind = 'local_llm' as const;
  readonly defaultModel = 'local-model';

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  isAvailable(env: NodeJS.ProcessEnv = process.env) {
    const base = env.LMSTUDIO_BASE_URL;
    if (!base) {
      return { available: false, reason: '未配置 LMSTUDIO_BASE_URL（例如 http://127.0.0.1:1234/v1）' };
    }
    const urlCheck = validateProviderEndpointUrl(base, env.LLM_ALLOW_LOCAL_INFERENCE === 'true');
    if (!urlCheck.valid) return { available: false, reason: urlCheck.reason };
    return { available: true };
  }

  async refine(ctx: SanitizedRefineContext, env: NodeJS.ProcessEnv = process.env): Promise<RawRefineResult> {
    const avail = this.isAvailable(env);
    if (!avail.available) throw new Error(avail.reason || 'LM Studio 服务不可用。');

    const baseUrl = (env.LMSTUDIO_BASE_URL || '').replace(/\/+$/, '');
    const model = env.LMSTUDIO_MODEL || this.defaultModel;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);

    try {
      const res = await this.fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(ctx) },
          ],
        }),
        redirect: 'error',
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`LM Studio 请求失败: ${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('LM Studio 返回缺少 message.content。');
      return normalizeParsedJson(parseJsonWithCodeFenceFallback(content), ctx.fallbackKeywords, model);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ============================================================================
// 5. Zero-Model Fallback Adapter: Deterministic Rule Engine
// ============================================================================
export class DeterministicRuleProviderAdapter implements LlmProviderAdapter {
  readonly id = 'deterministic_rules' as const;
  readonly label = '无模型本地确定性规则引擎';
  readonly kind = 'deterministic' as const;
  readonly defaultModel = DETERMINISTIC_MODEL_ID;

  isAvailable() {
    return { available: true };
  }

  async refine(ctx: SanitizedRefineContext): Promise<RawRefineResult> {
    return runDeterministicRefiner({
      fallbackKeywords: ctx.fallbackKeywords,
      autojsDeviceState: ctx.autojsDeviceState,
      redactedProxyPinTraffic: ctx.redactedProxyPinTraffic,
    });
  }
}

// ============================================================================
// Unified Adapter Registry & Router
// ============================================================================
export class LlmProviderRegistry {
  private readonly adapters: Map<ConcreteProviderId, LlmProviderAdapter>;
  private readonly autoPriority: ConcreteProviderId[] = [
    'gemini',
    'openai_compatible',
    'ollama',
    'lmstudio',
    'deterministic_rules',
  ];

  constructor(adapters?: LlmProviderAdapter[]) {
    const list: LlmProviderAdapter[] = adapters || [
      new GeminiProviderAdapter(),
      new OpenAICompatibleProviderAdapter(),
      new OllamaProviderAdapter(),
      new LmStudioProviderAdapter(),
      new DeterministicRuleProviderAdapter(),
    ];
    this.adapters = new Map(list.map((a) => [a.id, a]));
  }

  listProviders(env: NodeJS.ProcessEnv = process.env): ProviderStatusInfo[] {
    const items: ProviderStatusInfo[] = [
      {
        id: 'auto',
        label: '自动路由 (云端 -> 本地推理 -> 确定性规则)',
        kind: 'router',
        available: true,
        defaultModel: 'auto-select',
      },
    ];

    for (const id of this.autoPriority) {
      const adapter = this.adapters.get(id);
      if (!adapter) continue;
      const status = adapter.isAvailable(env);
      items.push({
        id: adapter.id,
        label: adapter.label,
        kind: adapter.kind,
        available: status.available,
        reason: status.reason,
        defaultModel: adapter.defaultModel,
      });
    }
    return items;
  }

  async refine(
    input: LlmRefineInput,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<LlmRefineOutput> {
    // 1. Mandatory pre-adapter redaction pipeline (shared across ALL providers)
    const redactedState = redactTrafficPayload(input.autojsState ?? {}, {
      maxStringLength: 400,
      maxArrayLength: 15,
    });
    const redactedTraffic = redactTrafficPayload(input.proxypinTraffic ?? {}, {
      maxStringLength: 400,
      maxArrayLength: 15,
    });

    const sanitizedCtx: SanitizedRefineContext = {
      goal: input.goal,
      workflowName: input.workflowName,
      appPackage: input.appPackage,
      fallbackKeywords: input.fallbackKeywords,
      autojsDeviceState: redactedState.redactedPayload,
      redactedProxyPinTraffic: redactedTraffic.redactedPayload,
      timeoutMs: Math.max(1000, Math.min(30000, input.timeoutMs ?? 12000)),
    };

    const requested = input.provider ?? 'auto';

    if (requested !== 'auto') {
      const targetAdapter = this.adapters.get(requested);
      if (!targetAdapter) {
        throw new Error(`未知的 LLM Provider: ${requested}`);
      }
      const status = targetAdapter.isAvailable(env);
      if (!status.available) {
        throw new Error(status.reason || `Provider "${requested}" 当前不可用。`);
      }
      const rawResult = await targetAdapter.refine(sanitizedCtx, env);
      return {
        ...rawResult,
        providerUsed: targetAdapter.id,
        providerLabel: targetAdapter.label,
        providerKind: targetAdapter.kind,
        routingNote: `按显式指定路由至: ${targetAdapter.label}`,
        redactionStats: {
          redactedKeyCount: redactedState.redactedKeyCount + redactedTraffic.redactedKeyCount,
          maskedPatternCount: redactedState.maskedPatternCount + redactedTraffic.maskedPatternCount,
          truncatedCount: redactedState.truncatedCount + redactedTraffic.truncatedCount,
        },
      };
    }

    // In 'auto' mode, iterate available adapters in priority order with transparent failover reporting
    const skippedReasons: string[] = [];
    for (const candidateId of this.autoPriority) {
      const candidate = this.adapters.get(candidateId);
      if (!candidate || !candidate.isAvailable(env).available) {
        continue;
      }

      try {
        const rawResult = await candidate.refine(sanitizedCtx, env);
        const routingNote =
          skippedReasons.length > 0
            ? `主适配器暂不可用 (${skippedReasons.join('; ')})；已自动切换至: ${candidate.label}`
            : candidateId === 'deterministic_rules'
              ? '未检测到云端或本地推理模型配置，自动路由至本地确定性规则引擎'
              : `自动路由命中可用适配器: ${candidate.label}`;

        return {
          ...rawResult,
          providerUsed: candidate.id,
          providerLabel: candidate.label,
          providerKind: candidate.kind,
          routingNote,
          redactionStats: {
            redactedKeyCount: redactedState.redactedKeyCount + redactedTraffic.redactedKeyCount,
            maskedPatternCount: redactedState.maskedPatternCount + redactedTraffic.maskedPatternCount,
            truncatedCount: redactedState.truncatedCount + redactedTraffic.truncatedCount,
          },
        };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        skippedReasons.push(`${candidate.id}: ${reason.slice(0, 120)}`);
      }
    }

    throw new Error(`所有可用推理适配器均执行失败: ${skippedReasons.join(' | ')}`);
  }
}

export const defaultLlmRegistry = new LlmProviderRegistry();
