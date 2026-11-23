import { useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import type { WorkflowIR } from '../core/ir';
import type { ApiContractEndpoint } from '../core/codegen';
import {
  detectRuntimePlatform,
  fetchLlmProviders,
  invokeLlmRefine,
  invokeMcpRpc,
} from '../core/nativeBridge';
import type { McpGatewayResponse, McpToolDefinition } from '../server/mcpGateway';
import type {
  LlmProviderId,
  LlmRefineOutput,
  ProviderStatusInfo,
} from '../server/llmProviders';

interface McpTrafficStudioProps {
  workflow: WorkflowIR;
  onInjectRefinedVariables: (
    keywords: string[],
    browseWaitMs: number,
    endpoints: ApiContractEndpoint[],
  ) => void;
}

export function McpTrafficStudio({
  workflow,
  onInjectRefinedVariables,
}: McpTrafficStudioProps) {
  const [autojsTransport, setAutojsTransport] = useState<'local-bridge' | 'http-jsonrpc'>('local-bridge');
  const [autojsUrl, setAutojsUrl] = useState('http://127.0.0.1:9317/mcp');
  const [autojsTools, setAutojsTools] = useState<McpToolDefinition[]>([]);
  const [autojsResult, setAutojsResult] = useState<McpGatewayResponse | null>(null);

  const [proxypinTransport, setProxypinTransport] = useState<'local-bridge' | 'http-jsonrpc'>('local-bridge');
  const [proxypinUrl, setProxypinUrl] = useState('http://127.0.0.1:9318/mcp');
  const [proxypinTools, setProxypinTools] = useState<McpToolDefinition[]>([]);
  const [proxypinResult, setProxypinResult] = useState<McpGatewayResponse | null>(null);
  const [domainFilter, setDomainFilter] = useState('ms.jr.jd.com');

  const [llmGoal, setLlmGoal] = useState(
    '从 AutoJs6 控件树与脱敏后的 ProxyPin 任务接口响应中提炼最高命中率按钮词与最小浏览停留时长',
  );
  const [providers, setProviders] = useState<ProviderStatusInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<LlmProviderId>('auto');
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [llmOutput, setLlmOutput] = useState<LlmRefineOutput | null>(null);
  const [injectedBanner, setInjectedBanner] = useState<string | null>(null);
  const [busyServer, setBusyServer] = useState<string | null>(null);
  const runtimePlatform = detectRuntimePlatform();

  useEffect(() => {
    let active = true;
    fetchLlmProviders()
      .then((list) => {
        if (active && list.length > 0) {
          setProviders(list);
        }
      })
      .catch(() => {
        // Keep selector usable even if initial provider probe fails
      });
    return () => {
      active = false;
    };
  }, []);

  const invokeMcp = async (
    serverId: 'autojs6' | 'proxypin',
    method: 'tools/list' | 'tools/call',
    toolName?: string,
    args?: Record<string, unknown>,
    optional = true,
  ) => {
    setBusyServer(`${serverId}:${method}:${toolName || ''}`);
    try {
      const json = await invokeMcpRpc({
        serverId,
        transport: serverId === 'autojs6' ? autojsTransport : proxypinTransport,
        endpointUrl: serverId === 'autojs6' ? autojsUrl : proxypinUrl,
        method,
        toolName,
        args,
        timeoutMs: 4000,
        optional,
      });
      if (serverId === 'autojs6') {
        if (method === 'tools/list' && json.ok && json.data && (json.data as { tools?: McpToolDefinition[] }).tools) {
          setAutojsTools((json.data as { tools: McpToolDefinition[] }).tools);
        }
        setAutojsResult(json);
      } else {
        if (method === 'tools/list' && json.ok && json.data && (json.data as { tools?: McpToolDefinition[] }).tools) {
          setProxypinTools((json.data as { tools: McpToolDefinition[] }).tools);
        }
        setProxypinResult(json);
      }
    } finally {
      setBusyServer(null);
    }
  };

  const runLlmRefinement = async () => {
    setLlmLoading(true);
    setLlmError(null);
    setInjectedBanner(null);
    try {
      const data = await invokeLlmRefine({
        goal: llmGoal,
        workflowName: workflow.meta.name,
        appPackage: workflow.meta.appPackage,
        fallbackKeywords: ['去完成', '去浏览', '立即签到', '领金币'],
        autojsState: autojsResult?.data ?? { currentPackage: workflow.meta.appPackage },
        proxypinTraffic: proxypinResult?.data ?? {},
        provider: selectedProvider,
      });
      if (!data.ok || !data.result) {
        setLlmError(data.error || '规则提炼请求失败');
      } else {
        setLlmOutput(data.result);
      }
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : '网络请求异常');
    } finally {
      setLlmLoading(false);
    }
  };

  const injectLlmResult = () => {
    if (!llmOutput) return;
    const contracts: ApiContractEndpoint[] = llmOutput.extractedApiHints.map((h) => ({
      domain: domainFilter || 'api.target.local',
      path: h.endpoint,
      method: 'POST',
      statusCode: 200,
      extractedHints: [`${h.field}: ${h.meaning}`],
    }));
    onInjectRefinedVariables(
      llmOutput.refinedKeywords,
      llmOutput.recommendedBrowseWaitMs || 16000,
      contracts,
    );
    setInjectedBanner(
      `已将 ${llmOutput.refinedKeywords.length} 个 LLM 提炼关键词注入工作流变量（含离线兜底值）`,
    );
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900">双 MCP 实时接入、抓包脱敏管道与 LLM 规则提炼</h1>
            <p className="text-sm text-slate-600 mt-1">
              通过统一 JSON-RPC 2.0 网关连接 AutoJs6 MCP 与 ProxyPin MCP，对敏感凭据执行强制脱敏后输入大模型提炼精确脚本变量。
            </p>
          </div>
          <div className="text-xs font-mono text-slate-600 bg-white border border-slate-200 rounded-md px-2.5 py-1.5">
            运行通道:{' '}
            {runtimePlatform === 'web'
              ? 'Web / Express 网关'
              : runtimePlatform === 'tauri-android'
                ? 'Android 原生桥接 (Tauri)'
                : '桌面原生桥接 (Tauri)'}
          </div>
        </div>

        {/* Dual MCP Connectors */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* AutoJs6 MCP Card */}
          <section className="bg-white border border-slate-200 rounded-md p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900">AutoJs6 MCP 客户端</h2>
                <div className="text-xs text-slate-500 mt-0.5">读取设备状态、UI 控件树与 PaddleOCR 锚点</div>
              </div>
              <select
                aria-label="AutoJs6 传输模式"
                value={autojsTransport}
                onChange={(e) => setAutojsTransport(e.target.value as 'local-bridge' | 'http-jsonrpc')}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
              >
                <option value="local-bridge">本地桥接模式 (Local Bridge)</option>
                <option value="http-jsonrpc">HTTP JSON-RPC 2.0</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                aria-label="AutoJs6 MCP 地址"
                value={autojsUrl}
                onChange={(e) => setAutojsUrl(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white"
              />
              <button
                type="button"
                onClick={() => invokeMcp('autojs6', 'tools/list')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-md cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>发现工具 (tools/list)</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busyServer !== null}
                onClick={() =>
                  invokeMcp('autojs6', 'tools/call', 'get_device_state', {
                    includeUiTree: true,
                    includeScreenMetrics: true,
                  })
                }
                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer whitespace-nowrap"
              >
                读取设备状态 (get_device_state)
              </button>
              <button
                type="button"
                onClick={() =>
                  invokeMcp('autojs6', 'tools/call', 'capture_ui_tree', { maxNodes: 15 })
                }
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-md cursor-pointer whitespace-nowrap"
              >
                采集控件树
              </button>
              <button
                type="button"
                onClick={() =>
                  invokeMcp(
                    'autojs6',
                    'tools/call',
                    'get_device_state',
                    { __simulateToolError: true },
                    true,
                  )
                }
                className="px-2.5 py-1.5 text-xs text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md cursor-pointer whitespace-nowrap"
              >
                模拟 isError 降级
              </button>
            </div>

            {autojsTools.length > 0 && (
              <div className="text-xs text-slate-600">
                已发现工具: {autojsTools.map((t) => t.name).join(' · ')}
              </div>
            )}

            {autojsResult && (
              <div className="bg-slate-900 text-slate-100 rounded-md p-3 space-y-1">
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 tabular-nums">
                  <span>
                    状态: {autojsResult.ok ? 'OK' : `${autojsResult.errorKind} (degraded=${String(autojsResult.degraded)})`}
                  </span>
                  <span>{autojsResult.latencyMs}ms</span>
                </div>
                <pre className="text-[11px] font-mono text-slate-200 overflow-x-auto max-h-48">
                  {JSON.stringify(
                    autojsResult.ok ? autojsResult.data : { error: autojsResult.errorMessage },
                    null,
                    2,
                  )}
                </pre>
              </div>
            )}
          </section>

          {/* ProxyPin MCP Card */}
          <section className="bg-white border border-slate-200 rounded-md p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900">ProxyPin MCP 客户端</h2>
                <div className="text-xs text-slate-500 mt-0.5">检索抓包会话并强制经过脱敏管道</div>
              </div>
              <select
                aria-label="ProxyPin 传输模式"
                value={proxypinTransport}
                onChange={(e) => setProxypinTransport(e.target.value as 'local-bridge' | 'http-jsonrpc')}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
              >
                <option value="local-bridge">本地桥接模式 (Local Bridge)</option>
                <option value="http-jsonrpc">HTTP JSON-RPC 2.0</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                aria-label="ProxyPin MCP 地址"
                value={proxypinUrl}
                onChange={(e) => setProxypinUrl(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white"
              />
              <button
                type="button"
                onClick={() => invokeMcp('proxypin', 'tools/list')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-md cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>发现工具 (tools/list)</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                aria-label="抓包域名过滤"
                value={domainFilter}
                onChange={(e) => setDomainFilter(e.target.value)}
                placeholder="域名过滤，如 ms.jr.jd.com"
                className="w-40 px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white"
              />
              <button
                type="button"
                disabled={busyServer !== null}
                onClick={() =>
                  invokeMcp('proxypin', 'tools/call', 'list_http_flows', {
                    domain: domainFilter,
                    statusCode: 200,
                    limit: 10,
                  })
                }
                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer whitespace-nowrap"
              >
                拉取脱敏抓包 (list_http_flows)
              </button>
              <button
                type="button"
                onClick={() =>
                  invokeMcp('proxypin', 'tools/call', 'analyze_endpoints', { domain: domainFilter })
                }
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-md cursor-pointer whitespace-nowrap"
              >
                接口统计
              </button>
            </div>

            {proxypinTools.length > 0 && (
              <div className="text-xs text-slate-600">
                已发现工具: {proxypinTools.map((t) => t.name).join(' · ')}
              </div>
            )}

            {proxypinResult && (
              <div className="bg-slate-900 text-slate-100 rounded-md p-3 space-y-1">
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 tabular-nums">
                  <span>
                    脱敏统计: 键掩码 {proxypinResult.redactionReport?.redactedKeyCount ?? 0} · 正则掩码{' '}
                    {proxypinResult.redactionReport?.maskedPatternCount ?? 0}
                  </span>
                  <span>{proxypinResult.latencyMs}ms</span>
                </div>
                <pre
                  data-testid="proxypin-redacted-output"
                  className="text-[11px] font-mono text-emerald-300 whitespace-pre-wrap break-all overflow-y-auto max-h-48"
                >
                  {JSON.stringify(
                    proxypinResult.ok ? proxypinResult.data : { error: proxypinResult.errorMessage },
                    null,
                    2,
                  )}
                </pre>
              </div>
            )}
          </section>
        </div>

        {/* Redaction Diff Audit */}
        {proxypinResult?.rawPreviewForAudit !== undefined && (
          <section className="bg-white border border-slate-200 rounded-md p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <ShieldCheck className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                <span>敏感数据脱敏管道对比审计（Authorization / Cookie / token / phone）</span>
              </div>
              <div className="text-xs font-mono text-slate-500 tabular-nums">
                已拦截敏感键: {proxypinResult.redactionReport?.redactedKeyCount ?? 0} · 模式掩码:{' '}
                {proxypinResult.redactionReport?.maskedPatternCount ?? 0}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <div className="text-xs font-semibold text-slate-600 mb-1.5">
                  原始抓包样本（仅本地合成演示样本用于对比）
                </div>
                <pre className="p-3 bg-slate-50 border border-slate-200 rounded-md text-[11px] font-mono text-slate-700 whitespace-pre-wrap break-all max-h-56 overflow-y-auto">
                  {JSON.stringify(proxypinResult.rawPreviewForAudit, null, 2)}
                </pre>
              </div>
              <div>
                <div className="text-xs font-semibold text-emerald-700 mb-1.5">
                  脱敏后输出（进入工作流变量与 Gemini LLM 提示词）
                </div>
                <pre className="p-3 bg-slate-900 border border-slate-800 rounded-md text-[11px] font-mono text-emerald-300 whitespace-pre-wrap break-all max-h-56 overflow-y-auto">
                  {JSON.stringify(proxypinResult.data, null, 2)}
                </pre>
              </div>
            </div>
          </section>
        )}

        {/* Unified LLM Provider Adapter Studio */}
        <section className="bg-white border border-slate-200 rounded-md p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-600" aria-hidden="true" />
                <span>统一推理适配器节点 (Cloud LLM / Local Inference / Deterministic Rules)</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                所有云端模型、本地推理服务与无模型确定性规则均收口于同一服务端适配器契约，上层积木与导出脚本完全无感知。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="选择 LLM Provider 适配器"
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value as LlmProviderId)}
                className="px-3 py-2 text-xs border border-slate-300 rounded-md bg-white text-slate-800"
              >
                {providers.length > 0 ? (
                  providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} {p.available ? '(就绪)' : '(未配置)'}
                    </option>
                  ))
                ) : (
                  <>
                    <option value="auto">自动路由 (云端 -&gt; 本地推理 -&gt; 确定性规则)</option>
                    <option value="gemini">Gemini 云端推理 (@google/genai)</option>
                    <option value="openai_compatible">OpenAI 兼容云端接口</option>
                    <option value="ollama">Ollama 本地推理服务</option>
                    <option value="lmstudio">LM Studio 本地推理服务</option>
                    <option value="deterministic_rules">无模型本地确定性规则引擎</option>
                  </>
                )}
              </select>
              <button
                type="button"
                disabled={llmLoading}
                onClick={runLlmRefinement}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-md cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{llmLoading ? '正在通过适配器提炼...' : '执行统一规则提炼'}</span>
              </button>
            </div>
          </div>

          {providers.length > 0 && (() => {
            const activeMeta = providers.find((p) => p.id === selectedProvider);
            if (!activeMeta || activeMeta.available) return null;
            return (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                当前选中适配器状态: {activeMeta.reason}（切换为「自动路由」将自动选择可用适配器）
              </div>
            );
          })()}

          <div>
            <label htmlFor="llm-studio-goal" className="block text-xs font-medium text-slate-700 mb-1">
              提炼目标描述
            </label>
            <input
              id="llm-studio-goal"
              type="text"
              value={llmGoal}
              onChange={(e) => setLlmGoal(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
            />
          </div>

          {llmError && (
            <div className="p-3 rounded-md border border-red-200 bg-red-50 text-xs text-red-800 space-y-1">
              <div className="font-semibold">适配器返回错误</div>
              <div>{llmError}</div>
            </div>
          )}

          {injectedBanner && (
            <div className="p-3 rounded-md border border-emerald-200 bg-emerald-50 text-xs text-emerald-800 font-medium">
              {injectedBanner}
            </div>
          )}

          {llmOutput && (
            <div data-testid="llm-adapter-output" className="border-t border-slate-200 pt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-slate-800">
                    实际执行适配器: {llmOutput.providerLabel} ({llmOutput.modelUsed}) · 建议停留:{' '}
                    <span className="font-mono tabular-nums">{llmOutput.recommendedBrowseWaitMs}ms</span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {llmOutput.routingNote} · 脱敏统计: 键掩码 {llmOutput.redactionStats.redactedKeyCount} / 正则掩码{' '}
                    {llmOutput.redactionStats.maskedPatternCount}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={injectLlmResult}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer whitespace-nowrap"
                >
                  注入工作流 IR 变量
                </button>
              </div>
              <pre className="p-3 bg-slate-900 text-slate-200 rounded-md text-[11px] font-mono whitespace-pre-wrap break-all overflow-x-auto">
                {JSON.stringify(llmOutput, null, 2)}
              </pre>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
