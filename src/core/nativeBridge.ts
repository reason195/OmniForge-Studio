import { DETERMINISTIC_MODEL_ID, runDeterministicRefiner } from './deterministicRefiner';
import { redactTrafficPayload } from './redaction';
import type { McpGatewayResponse, McpToolCallResult, McpToolDefinition } from '../server/mcpGateway';
import type { LlmProviderId, LlmRefineOutput, ProviderStatusInfo } from '../server/llmProviders';

export type RuntimePlatformKind = 'web' | 'tauri-desktop' | 'tauri-android';

export type TauriInvokeFn = <T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<T>;

interface TauriWindowGlobals {
  __TAURI_INTERNALS__?: { invoke?: TauriInvokeFn };
  __TAURI__?: { core?: { invoke?: TauriInvokeFn } };
}

export function getTauriInvoke(): TauriInvokeFn | null {
  if (typeof window === 'undefined') return null;
  const g = window as unknown as TauriWindowGlobals;
  if (typeof g.__TAURI_INTERNALS__?.invoke === 'function') {
    return g.__TAURI_INTERNALS__.invoke;
  }
  if (typeof g.__TAURI__?.core?.invoke === 'function') {
    return g.__TAURI__.core.invoke;
  }
  return null;
}

export function detectRuntimePlatform(): RuntimePlatformKind {
  const invoke = getTauriInvoke();
  if (!invoke) return 'web';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /Android/i.test(ua) ? 'tauri-android' : 'tauri-desktop';
}

export interface McpRpcBridgeRequest {
  serverId: 'autojs6' | 'proxypin';
  transport: 'local-bridge' | 'http-jsonrpc';
  endpointUrl: string;
  method: 'tools/list' | 'tools/call';
  toolName?: string;
  args?: Record<string, unknown>;
  timeoutMs?: number;
  optional?: boolean;
}

export interface LlmRefineBridgeRequest {
  goal: string;
  workflowName: string;
  appPackage: string;
  fallbackKeywords: string[];
  autojsState?: unknown;
  proxypinTraffic?: unknown;
  provider?: LlmProviderId;
}

export interface BridgeCallOptions {
  fetchImpl?: typeof fetch;
  tauriInvoke?: TauriInvokeFn | null;
}

interface NativeRpcCommandResponse {
  latencyMs: number;
  rpc: {
    jsonrpc?: string;
    id?: string | number | null;
    result?: McpToolCallResult | { tools: McpToolDefinition[] };
    error?: { code: number; message: string };
  };
}

export async function fetchLlmProviders(options: BridgeCallOptions = {}): Promise<ProviderStatusInfo[]> {
  const tauriInvoke = options.tauriInvoke !== undefined ? options.tauriInvoke : getTauriInvoke();
  if (tauriInvoke) {
    return [
      {
        id: 'auto',
        label: '自动路由 (本地确定性规则引擎 — 离线桌面/移动端)',
        kind: 'router',
        available: true,
        defaultModel: DETERMINISTIC_MODEL_ID,
      },
      {
        id: 'deterministic_rules',
        label: '无模型本地确定性规则引擎 (原生内置)',
        kind: 'deterministic',
        available: true,
        defaultModel: DETERMINISTIC_MODEL_ID,
      },
    ];
  }

  const fetcher = options.fetchImpl ?? fetch;
  const res = await fetcher('/api/llm/providers');
  const data = (await res.json()) as { ok?: boolean; providers?: ProviderStatusInfo[] };
  return data?.ok && Array.isArray(data.providers) ? data.providers : [];
}

export async function invokeMcpRpc(
  req: McpRpcBridgeRequest,
  options: BridgeCallOptions = {},
): Promise<McpGatewayResponse> {
  const tauriInvoke = options.tauriInvoke !== undefined ? options.tauriInvoke : getTauriInvoke();

  if (!tauriInvoke) {
    const fetcher = options.fetchImpl ?? fetch;
    const res = await fetcher('/api/mcp/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    return (await res.json()) as McpGatewayResponse;
  }

  // Native Tauri Runtime (Windows / macOS / Android): invoke Rust JSON-RPC bridge + redact in TypeScript
  const optional = req.optional ?? true;
  const rpcBody =
    req.method === 'tools/list'
      ? { jsonrpc: '2.0', id: `rpc_${Date.now()}`, method: 'tools/list', params: {} }
      : {
          jsonrpc: '2.0',
          id: `rpc_${Date.now()}`,
          method: 'tools/call',
          params: { name: req.toolName || '', arguments: req.args || {} },
        };

  try {
    const nativeRes = await tauriInvoke<NativeRpcCommandResponse>('mcp_jsonrpc_call', {
      endpointUrl: req.endpointUrl,
      rpcBody,
      timeoutMs: req.timeoutMs ?? 4000,
    });

    const rpc = nativeRes.rpc;
    if (rpc.error) {
      return {
        ok: false,
        degraded: optional,
        serverId: req.serverId,
        method: req.method,
        latencyMs: nativeRes.latencyMs,
        errorKind: 'protocol_error',
        errorMessage: `JSON-RPC 协议错误 (${rpc.error.code}): ${rpc.error.message}`,
        data: null,
      };
    }

    if (!rpc.result) {
      return {
        ok: false,
        degraded: optional,
        serverId: req.serverId,
        method: req.method,
        latencyMs: nativeRes.latencyMs,
        errorKind: 'protocol_error',
        errorMessage: 'JSON-RPC 响应缺少 result 字段',
        data: null,
      };
    }

    if (req.method === 'tools/call') {
      const callRes = rpc.result as McpToolCallResult;
      if (callRes.isError) {
        const msg =
          callRes.content?.map((c) => c.text || JSON.stringify(c.json)).join('; ') ||
          '工具返回执行失败';
        return {
          ok: false,
          degraded: optional,
          serverId: req.serverId,
          method: req.method,
          latencyMs: nativeRes.latencyMs,
          errorKind: 'tool_execution_error',
          errorMessage: `MCP 工具执行错误 (isError=true): ${msg}`,
          data: null,
        };
      }
    }

    let payload: unknown = rpc.result;
    if (req.method === 'tools/call') {
      const callRes = rpc.result as McpToolCallResult;
      const firstJson = callRes.content?.find((c) => c.json !== undefined)?.json;
      const firstText = callRes.content?.find((c) => c.text !== undefined)?.text;
      payload = firstJson ?? firstText ?? callRes;
    }

    const report = redactTrafficPayload(payload, { maxStringLength: 512, maxArrayLength: 20 });
    return {
      ok: true,
      degraded: false,
      serverId: req.serverId,
      method: req.method,
      latencyMs: nativeRes.latencyMs,
      data: report.redactedPayload,
      redactionReport: {
        redactedKeyCount: report.redactedKeyCount,
        maskedPatternCount: report.maskedPatternCount,
        truncatedCount: report.truncatedCount,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = /timeout|timed out/i.test(message);
    const isBlocked = /metadata|blocked|scheme/i.test(message);
    return {
      ok: false,
      degraded: optional,
      serverId: req.serverId,
      method: req.method,
      latencyMs: 0,
      errorKind: isBlocked ? 'ssrf_blocked' : isTimeout ? 'timeout_error' : 'transport_error',
      errorMessage: message,
      data: null,
    };
  }
}

export async function invokeLlmRefine(
  req: LlmRefineBridgeRequest,
  options: BridgeCallOptions = {},
): Promise<{ ok: boolean; result?: LlmRefineOutput; error?: string }> {
  const tauriInvoke = options.tauriInvoke !== undefined ? options.tauriInvoke : getTauriInvoke();

  if (!tauriInvoke) {
    const fetcher = options.fetchImpl ?? fetch;
    const res = await fetcher('/api/llm/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    const data = (await res.json()) as { ok?: boolean; result?: LlmRefineOutput; error?: string };
    return {
      ok: Boolean(res.ok && data.ok),
      result: data.result,
      error: data.error,
    };
  }

  // Native Tauri Offline/Deterministic Refiner with mandatory redaction
  const redactedState = redactTrafficPayload(req.autojsState ?? {}, {
    maxStringLength: 400,
    maxArrayLength: 15,
  });
  const redactedTraffic = redactTrafficPayload(req.proxypinTraffic ?? {}, {
    maxStringLength: 400,
    maxArrayLength: 15,
  });

  if (
    req.provider &&
    req.provider !== 'auto' &&
    req.provider !== 'deterministic_rules'
  ) {
    return {
      ok: false,
      error: `原生离线安装包默认启用本地确定性规则引擎；如需云端适配器 "${req.provider}"，请通过 Web 网关或设置本地环境变量。`,
    };
  }

  const raw = runDeterministicRefiner({
    fallbackKeywords: req.fallbackKeywords,
    autojsDeviceState: redactedState.redactedPayload,
    redactedProxyPinTraffic: redactedTraffic.redactedPayload,
  });

  return {
    ok: true,
    result: {
      ...raw,
      providerUsed: 'deterministic_rules',
      providerLabel: '无模型本地确定性规则引擎 (原生内置)',
      providerKind: 'deterministic',
      routingNote: '原生桌面/Android 端离线运行，已自动路由至本地确定性规则引擎',
      redactionStats: {
        redactedKeyCount: redactedState.redactedKeyCount + redactedTraffic.redactedKeyCount,
        maskedPatternCount: redactedState.maskedPatternCount + redactedTraffic.maskedPatternCount,
        truncatedCount: redactedState.truncatedCount + redactedTraffic.truncatedCount,
      },
    },
  };
}
