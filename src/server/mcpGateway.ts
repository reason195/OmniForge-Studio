import { redactTrafficPayload, type RedactionReport } from '../core/redaction';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: 'tools/list' | 'tools/call';
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface McpToolCallResult {
  content: Array<{ type: 'text' | 'json'; text?: string; json?: unknown }>;
  isError?: boolean;
}

export type McpErrorKind = 'transport_error' | 'protocol_error' | 'tool_execution_error' | 'timeout_error' | 'ssrf_blocked';

export interface McpGatewayResponse<T = unknown> {
  ok: boolean;
  degraded: boolean;
  serverId: 'autojs6' | 'proxypin';
  method: string;
  latencyMs: number;
  errorKind?: McpErrorKind;
  errorMessage?: string;
  data: T | null;
  redactionReport?: Omit<RedactionReport, 'redactedPayload'>;
  rawPreviewForAudit?: unknown;
}

const BLOCKED_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.goog',
  '0.0.0.0',
  '::',
  '::1',
  'localhost',
  '127.0.0.1',
]);

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

function isMetadataHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '169.254.169.254' || h === 'metadata.google.internal' || h === 'metadata.goog') {
    return true;
  }
  const octets = extractMappedIpv4Octets(h);
  if (octets && octets[0] === 169 && octets[1] === 254) {
    return true;
  }
  return false;
}

function isPrivateOrLinkLocalIp(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (BLOCKED_HOSTS.has(h)) return true;
  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  const octets = extractMappedIpv4Octets(h);
  if (!octets) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function validateMcpEndpointUrl(
  endpointUrl: string,
  allowlistHosts: string[] = [],
): { valid: boolean; reason?: string; parsed?: URL } {
  let parsed: URL;
  try {
    parsed = new URL(endpointUrl);
  } catch {
    return { valid: false, reason: '无效的 MCP Endpoint URL 格式。' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: `不支持的协议 "${parsed.protocol}"，仅允许 http: 或 https:。` };
  }

  const host = parsed.hostname.toLowerCase();
  // Always block cloud metadata addresses even when an allowlist exists
  if (isMetadataHost(host)) {
    return { valid: false, reason: '安全策略拦截：禁止访问云元数据地址。' };
  }

  const normalizedAllowlist = allowlistHosts.map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (normalizedAllowlist.includes(host)) {
    return { valid: true, parsed };
  }

  if (isPrivateOrLinkLocalIp(host)) {
    return {
      valid: false,
      reason:
        '托管 Web 环境默认禁止向内网/回环地址发起直连探测；请使用本地桌面/Android 原生桥接模式（local-bridge）或在服务端 MCP_ALLOWLIST_HOSTS 显式放行。',
    };
  }

  if (normalizedAllowlist.length > 0 && !normalizedAllowlist.includes(host)) {
    return { valid: false, reason: `主机 "${host}" 不在 MCP_ALLOWLIST_HOSTS 白名单中。` };
  }

  return { valid: true, parsed };
}

// ============================================================================
// Built-in Local Bridge MCP Servers (Real JSON-RPC 2.0 Protocol Dispatch)
// ============================================================================

const AUTOJS6_TOOLS: McpToolDefinition[] = [
  {
    name: 'get_device_state',
    description: '获取当前 Android 设备分辨率、前台包名、无障碍服务状态及当前 Activity',
    inputSchema: {
      type: 'object',
      properties: {
        includeUiTree: { type: 'boolean', description: '是否附带关键可见控件摘要' },
        includeScreenMetrics: { type: 'boolean', description: '是否附带屏幕宽高与 DPI' },
      },
    },
  },
  {
    name: 'capture_ui_tree',
    description: '采集当前页面的可点击控件树与 OCR 锚点候选区域',
    inputSchema: {
      type: 'object',
      properties: {
        maxNodes: { type: 'number', description: '最大返回控件节点数' },
      },
    },
  },
  {
    name: 'probe_ocr_region',
    description: '在指定归一化比例区域执行 PaddleOCR 试跑并返回识别文本与坐标',
    inputSchema: {
      type: 'object',
      properties: {
        x0: { type: 'number', description: '左边界比例 0..1' },
        y0: { type: 'number', description: '上边界比例 0..1' },
        x1: { type: 'number', description: '右边界比例 0..1' },
        y1: { type: 'number', description: '下边界比例 0..1' },
      },
      required: ['x0', 'y0', 'x1', 'y1'],
    },
  },
];

const PROXYPIN_TOOLS: McpToolDefinition[] = [
  {
    name: 'list_http_flows',
    description: '按域名、HTTP 方法、状态码或关键词检索 ProxyPin 抓包会话列表',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: '目标域名过滤，例如 ms.jr.jd.com' },
        method: { type: 'string', description: 'HTTP 方法，例如 GET / POST' },
        statusCode: { type: 'number', description: '状态码筛选，例如 200' },
        limit: { type: 'number', description: '最大返回条数' },
      },
    },
  },
  {
    name: 'get_flow_detail',
    description: '读取指定抓包 ID 的完整请求头、响应头与 JSON 正文',
    inputSchema: {
      type: 'object',
      properties: {
        flowId: { type: 'string', description: '抓包会话 ID' },
      },
      required: ['flowId'],
    },
  },
  {
    name: 'analyze_endpoints',
    description: '聚合统计高频任务接口路径、状态码分布与提取字段建议',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: '目标域名' },
      },
    },
  },
];

// Synthetic local capture dataset for ProxyPin MCP Local Bridge (safe demo values)
const SYNTHETIC_PROXYPIN_FLOWS = [
  {
    flowId: 'flow_jr_001',
    method: 'POST',
    url: 'https://ms.jr.jd.com/gw/generic/hy/h5/m/queryTaskList?token=demo_q_tok_9812',
    domain: 'ms.jr.jd.com',
    path: '/gw/generic/hy/h5/m/queryTaskList',
    statusCode: 200,
    durationMs: 142,
    requestHeaders: {
      Host: 'ms.jr.jd.com',
      Authorization: 'Bearer demo-session-token-9f8e7d6c5b4a3210',
      Cookie: 'pt_key=demo_cookie_abc123; pt_pin=jd_demo_user;',
      'X-Api-Key': 'demo-client-key-0042',
      'User-Agent': 'JDJR-Android/6.8.20',
    },
    responseHeaders: {
      'Content-Type': 'application/json;charset=UTF-8',
      'Set-Cookie': 'jr_sid=demo_sid_778899; HttpOnly',
    },
    responseBody: {
      resultCode: 0,
      userPhone: '13800138000',
      data: {
        pageTitle: '每日做任务领金币',
        tasks: [
          {
            taskId: 't_signin_01',
            title: '每日签到领京豆',
            buttonText: '去签到',
            status: 'TODO',
            browseSeconds: 0,
          },
          {
            taskId: 't_browse_02',
            title: '浏览理财精选会场',
            buttonText: '去浏览15秒',
            status: 'TODO',
            browseSeconds: 15,
          },
          {
            taskId: 't_reward_03',
            title: '阶段奖励待领取',
            buttonText: '领取奖励',
            status: 'CLAIMABLE',
            browseSeconds: 0,
          },
          {
            taskId: 't_done_04',
            title: '新人礼包已发放',
            buttonText: '已完成',
            status: 'DONE',
            browseSeconds: 0,
          },
        ],
      },
    },
  },
  {
    flowId: 'flow_jr_002',
    method: 'POST',
    url: 'https://ms.jr.jd.com/gw/generic/hy/h5/m/doTaskReport',
    domain: 'ms.jr.jd.com',
    path: '/gw/generic/hy/h5/m/doTaskReport',
    statusCode: 200,
    durationMs: 96,
    requestHeaders: {
      Host: 'ms.jr.jd.com',
      Authorization: 'Bearer demo-session-token-9f8e7d6c5b4a3210',
      Cookie: 'pt_key=demo_cookie_abc123; pt_pin=jd_demo_user;',
    },
    responseHeaders: {
      'Content-Type': 'application/json',
    },
    responseBody: {
      resultCode: 0,
      rewardAmount: 20,
      nextActionHint: '返回任务列表刷新状态',
      contactEmail: 'qa-demo@example.com',
    },
  },
];

function executeLocalMcpJsonRpc(
  serverId: 'autojs6' | 'proxypin',
  req: JsonRpcRequest,
): JsonRpcResponse {
  if (req.method === 'tools/list') {
    const tools = serverId === 'autojs6' ? AUTOJS6_TOOLS : PROXYPIN_TOOLS;
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: { tools },
    };
  }

  if (req.method === 'tools/call') {
    const params = (req.params || {}) as { name?: string; arguments?: Record<string, unknown> };
    const toolName = params.name || '';
    const args = params.arguments || {};

    // Simulate explicit tool execution error when testing error separation
    if (args.__simulateToolError === true) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [{ type: 'text', text: `Tool "${toolName}" executed with device rejection: Screen capture permission denied` }],
          isError: true,
        } satisfies McpToolCallResult,
      };
    }

    if (args.__simulateProtocolError === true) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: -32602,
          message: `JSON-RPC Invalid params for tool "${toolName}"`,
        },
      };
    }

    if (serverId === 'autojs6') {
      if (toolName === 'get_device_state') {
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: [
              {
                type: 'json',
                json: {
                  deviceModel: 'Pixel 8 Pro (Android 14)',
                  screenWidth: 1080,
                  screenHeight: 2400,
                  accessibilityReady: true,
                  screenCaptureReady: true,
                  currentPackage: 'com.jd.jrapp',
                  currentActivity: 'com.jd.jrapp.bm.main.MainWebActivity',
                  visibleActionTexts: ['每日做任务领金币', '去签到', '去浏览15秒', '领取奖励', '已完成'],
                  recommendedOcrRegion: { x0: 0.62, y0: 0.24, x1: 0.96, y1: 0.88 },
                },
              },
            ],
            isError: false,
          } satisfies McpToolCallResult,
        };
      }

      if (toolName === 'capture_ui_tree' || toolName === 'probe_ocr_region') {
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: [
              {
                type: 'json',
                json: {
                  engine: 'paddle',
                  nodes: [
                    { text: '去签到', boundsRatio: [0.68, 0.31, 0.91, 0.36], clickable: true },
                    { text: '去浏览15秒', boundsRatio: [0.66, 0.45, 0.92, 0.5], clickable: true },
                    { text: '领取奖励', boundsRatio: [0.68, 0.59, 0.91, 0.64], clickable: true },
                  ],
                },
              },
            ],
            isError: false,
          } satisfies McpToolCallResult,
        };
      }

      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32601, message: `AutoJs6 MCP 未知工具: ${toolName}` },
      };
    }

    if (serverId === 'proxypin') {
      if (toolName === 'list_http_flows') {
        const domainFilter = typeof args.domain === 'string' ? args.domain.trim().toLowerCase() : '';
        const methodFilter = typeof args.method === 'string' ? args.method.trim().toUpperCase() : '';
        const statusFilter = typeof args.statusCode === 'number' ? args.statusCode : undefined;
        const limit = typeof args.limit === 'number' ? args.limit : 20;

        const filtered = SYNTHETIC_PROXYPIN_FLOWS.filter((f) => {
          if (domainFilter && !f.domain.toLowerCase().includes(domainFilter)) return false;
          if (methodFilter && f.method !== methodFilter) return false;
          if (statusFilter !== undefined && f.statusCode !== statusFilter) return false;
          return true;
        }).slice(0, limit);

        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: [{ type: 'json', json: { total: filtered.length, flows: filtered } }],
            isError: false,
          } satisfies McpToolCallResult,
        };
      }

      if (toolName === 'get_flow_detail') {
        const flowId = String(args.flowId || 'flow_jr_001');
        const found = SYNTHETIC_PROXYPIN_FLOWS.find((f) => f.flowId === flowId) || SYNTHETIC_PROXYPIN_FLOWS[0];
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: [{ type: 'json', json: found }],
            isError: false,
          } satisfies McpToolCallResult,
        };
      }

      if (toolName === 'analyze_endpoints') {
        return {
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: [
              {
                type: 'json',
                json: {
                  domain: args.domain || 'ms.jr.jd.com',
                  endpoints: [
                    {
                      domain: 'ms.jr.jd.com',
                      path: '/gw/generic/hy/h5/m/queryTaskList',
                      method: 'POST',
                      statusCode: 200,
                      extractedHints: ['buttonText=去签到|去浏览15秒|领取奖励', 'browseSeconds=15'],
                    },
                    {
                      domain: 'ms.jr.jd.com',
                      path: '/gw/generic/hy/h5/m/doTaskReport',
                      method: 'POST',
                      statusCode: 200,
                      extractedHints: ['nextActionHint=返回任务列表刷新状态'],
                    },
                  ],
                },
              },
            ],
            isError: false,
          } satisfies McpToolCallResult,
        };
      }

      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32601, message: `ProxyPin MCP 未知工具: ${toolName}` },
      };
    }
  }

  return {
    jsonrpc: '2.0',
    id: req.id,
    error: { code: -32601, message: `Unsupported JSON-RPC method: ${req.method}` },
  };
}

export interface CallMcpGatewayOptions {
  serverId: 'autojs6' | 'proxypin';
  transport: 'http-jsonrpc' | 'local-bridge';
  endpointUrl: string;
  method: 'tools/list' | 'tools/call';
  toolName?: string;
  args?: Record<string, unknown>;
  timeoutMs?: number;
  optional?: boolean;
  allowlistHosts?: string[];
  fetchImpl?: typeof fetch;
}

export async function callMcpGateway(opts: CallMcpGatewayOptions): Promise<McpGatewayResponse> {
  const startedAt = Date.now();
  const timeoutMs = Math.max(300, Math.min(30000, opts.timeoutMs ?? 4000));
  const optional = opts.optional ?? false;

  const rpcRequest: JsonRpcRequest =
    opts.method === 'tools/list'
      ? { jsonrpc: '2.0', id: `rpc_${Date.now()}`, method: 'tools/list', params: {} }
      : {
          jsonrpc: '2.0',
          id: `rpc_${Date.now()}`,
          method: 'tools/call',
          params: { name: opts.toolName || '', arguments: opts.args || {} },
        };

  let rpcResponse: JsonRpcResponse;

  if (opts.transport === 'local-bridge') {
    rpcResponse = executeLocalMcpJsonRpc(opts.serverId, rpcRequest);
  } else {
    const urlCheck = validateMcpEndpointUrl(opts.endpointUrl, opts.allowlistHosts || []);
    if (!urlCheck.valid) {
      return {
        ok: false,
        degraded: optional,
        serverId: opts.serverId,
        method: opts.method,
        latencyMs: Date.now() - startedAt,
        errorKind: 'ssrf_blocked',
        errorMessage: urlCheck.reason,
        data: null,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const fetcher = opts.fetchImpl || fetch;

    try {
      const httpRes = await fetcher(urlCheck.parsed!.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rpcRequest),
        redirect: 'error',
        signal: controller.signal,
      });

      if (!httpRes.ok) {
        return {
          ok: false,
          degraded: optional,
          serverId: opts.serverId,
          method: opts.method,
          latencyMs: Date.now() - startedAt,
          errorKind: 'transport_error',
          errorMessage: `MCP HTTP 传输错误: ${httpRes.status} ${httpRes.statusText}`,
          data: null,
        };
      }

      rpcResponse = (await httpRes.json()) as JsonRpcResponse;
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      return {
        ok: false,
        degraded: optional,
        serverId: opts.serverId,
        method: opts.method,
        latencyMs: Date.now() - startedAt,
        errorKind: isAbort ? 'timeout_error' : 'transport_error',
        errorMessage: isAbort
          ? `MCP 请求超时 (${timeoutMs}ms)`
          : err instanceof Error
            ? err.message
            : 'MCP 网络传输异常',
        data: null,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // 1. Distinguish JSON-RPC protocol error
  if (rpcResponse.error) {
    return {
      ok: false,
      degraded: optional,
      serverId: opts.serverId,
      method: opts.method,
      latencyMs: Date.now() - startedAt,
      errorKind: 'protocol_error',
      errorMessage: `JSON-RPC 协议错误 (${rpcResponse.error.code}): ${rpcResponse.error.message}`,
      data: null,
    };
  }

  const result = rpcResponse.result as McpToolCallResult | { tools: McpToolDefinition[] } | undefined;
  if (!result) {
    return {
      ok: false,
      degraded: optional,
      serverId: opts.serverId,
      method: opts.method,
      latencyMs: Date.now() - startedAt,
      errorKind: 'protocol_error',
      errorMessage: 'JSON-RPC 响应缺少 result 字段',
      data: null,
    };
  }

  // 2. Distinguish MCP Tool execution error (isError: true)
  if (opts.method === 'tools/call') {
    const callRes = result as McpToolCallResult;
    if (callRes.isError) {
      const msg = callRes.content?.map((c) => c.text || JSON.stringify(c.json)).join('; ') || '工具返回执行失败';
      return {
        ok: false,
        degraded: optional,
        serverId: opts.serverId,
        method: opts.method,
        latencyMs: Date.now() - startedAt,
        errorKind: 'tool_execution_error',
        errorMessage: `MCP 工具执行错误 (isError=true): ${msg}`,
        data: null,
      };
    }
  }

  // Extract payload
  let payload: unknown = result;
  if (opts.method === 'tools/call') {
    const callRes = result as McpToolCallResult;
    const firstJson = callRes.content?.find((c) => c.json !== undefined)?.json;
    const firstText = callRes.content?.find((c) => c.text !== undefined)?.text;
    payload = firstJson ?? firstText ?? callRes;
  }

  // Always pass ProxyPin traffic (and AutoJs6 text payloads) through redaction pipeline before returning
  const report = redactTrafficPayload(payload, { maxStringLength: 512, maxArrayLength: 20 });

  return {
    ok: true,
    degraded: false,
    serverId: opts.serverId,
    method: opts.method,
    latencyMs: Date.now() - startedAt,
    data: report.redactedPayload,
    redactionReport: {
      redactedKeyCount: report.redactedKeyCount,
      maskedPatternCount: report.maskedPatternCount,
      truncatedCount: report.truncatedCount,
    },
    rawPreviewForAudit: opts.transport === 'local-bridge' && opts.serverId === 'proxypin' ? payload : undefined,
  };
}
