import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectRuntimePlatform,
  fetchLlmProviders,
  invokeLlmRefine,
  invokeMcpRpc,
  type TauriInvokeFn,
} from './nativeBridge';

function withMockWindow(
  globals: Record<string, unknown> | undefined,
  userAgent: string,
  fn: () => Promise<void> | void,
) {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
  try {
    if (globals === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: globals,
        configurable: true,
        writable: true,
      });
    }
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent },
      configurable: true,
      writable: true,
    });
    return fn();
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
        writable: true,
      });
    }
    if (originalNavigator === undefined) {
      delete (globalThis as { navigator?: unknown }).navigator;
    } else {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
        writable: true,
      });
    }
  }
}

test('detectRuntimePlatform distinguishes web, tauri-desktop, and tauri-android', () => {
  withMockWindow(undefined, 'Mozilla/5.0', () => {
    assert.equal(detectRuntimePlatform(), 'web');
  });

  withMockWindow({ __TAURI_INTERNALS__: { invoke: async () => ({}) } }, 'Mozilla/5.0 Windows NT 10.0', () => {
    assert.equal(detectRuntimePlatform(), 'tauri-desktop');
  });

  withMockWindow(
    { __TAURI__: { core: { invoke: async () => ({}) } } },
    'Mozilla/5.0 (Linux; Android 14)',
    () => {
      assert.equal(detectRuntimePlatform(), 'tauri-android');
    },
  );
});

test('Web mode routes fetchLlmProviders, invokeMcpRpc, and invokeLlmRefine through /api/*', async () => {
  const calls: string[] = [];
  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url === '/api/llm/providers') {
      return new Response(
        JSON.stringify({
          ok: true,
          providers: [
            {
              id: 'deterministic_rules',
              label: 'Deterministic',
              kind: 'deterministic',
              available: true,
              defaultModel: 'deterministic-rule-engine-v1',
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url === '/api/mcp/rpc') {
      return new Response(
        JSON.stringify({
          ok: true,
          degraded: false,
          serverId: 'autojs6',
          method: 'tools/list',
          latencyMs: 12,
          data: { tools: [] },
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        ok: true,
        result: {
          refinedKeywords: ['去签到'],
          recommendedBrowseWaitMs: 16000,
          branchConditions: [],
          extractedApiHints: [],
          scriptSnippet: 'var ok = true;',
          modelUsed: 'deterministic-rule-engine-v1',
          providerUsed: 'deterministic_rules',
          providerLabel: 'Deterministic',
          providerKind: 'deterministic',
          routingNote: 'web-test',
          redactionStats: { redactedKeyCount: 0, maskedPatternCount: 0, truncatedCount: 0 },
        },
      }),
      { status: 200 },
    );
  };

  const providers = await fetchLlmProviders({ fetchImpl: mockFetch, tauriInvoke: null });
  assert.equal(providers.length, 1);

  const rpc = await invokeMcpRpc(
    {
      serverId: 'autojs6',
      transport: 'local-bridge',
      endpointUrl: 'http://127.0.0.1:9317/mcp',
      method: 'tools/list',
    },
    { fetchImpl: mockFetch, tauriInvoke: null },
  );
  assert.equal(rpc.ok, true);

  const refine = await invokeLlmRefine(
    {
      goal: 'test',
      workflowName: 'wf',
      appPackage: 'com.jd.jrapp',
      fallbackKeywords: ['去签到'],
    },
    { fetchImpl: mockFetch, tauriInvoke: null },
  );
  assert.equal(refine.ok, true);
  assert.deepEqual(calls, ['/api/llm/providers', '/api/mcp/rpc', '/api/llm/refine']);
});

test('Tauri native invokeMcpRpc redacts sensitive traffic and handles isError, protocol_error, ssrf_blocked, and timeout_error', async () => {
  // 1. Success + redaction
  const successRes = await invokeMcpRpc(
    {
      serverId: 'proxypin',
      transport: 'http-jsonrpc',
      endpointUrl: 'http://127.0.0.1:9318/mcp',
      method: 'tools/call',
      toolName: 'list_http_flows',
      args: { domain: 'ms.jr.jd.com' },
    },
    {
      tauriInvoke: (async () => ({
        latencyMs: 18,
        rpc: {
          jsonrpc: '2.0',
          id: '1',
          result: {
            content: [
              {
                type: 'json',
                json: {
                  flows: [
                    {
                      requestHeaders: {
                        Authorization: 'Bearer secret-token-9988',
                        Cookie: 'pt_key=secret;',
                      },
                      responseBody: {
                        phone: '13800138000',
                        data: { tasks: [{ buttonText: '去签到', status: 'TODO' }] },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      })) as never,
    },
  );
  assert.equal(successRes.ok, true);
  assert.ok((successRes.redactionReport?.redactedKeyCount || 0) >= 2);
  const serialized = JSON.stringify(successRes.data);
  assert.doesNotMatch(serialized, /secret-token-9988/);
  assert.doesNotMatch(serialized, /13800138000/);

  // 2. isError = true
  const toolErrorRes = await invokeMcpRpc(
    {
      serverId: 'autojs6',
      transport: 'http-jsonrpc',
      endpointUrl: 'http://127.0.0.1:9317/mcp',
      method: 'tools/call',
      toolName: 'get_device_state',
      optional: true,
    },
    {
      tauriInvoke: (async () => ({
        latencyMs: 7,
        rpc: {
          jsonrpc: '2.0',
          id: '2',
          result: { isError: true, content: [{ type: 'text', text: 'ADB offline' }] },
        },
      })) as never,
    },
  );
  assert.equal(toolErrorRes.ok, false);
  assert.equal(toolErrorRes.errorKind, 'tool_execution_error');
  assert.equal(toolErrorRes.degraded, true);

  // 3. JSON-RPC protocol error
  const protoErrorRes = await invokeMcpRpc(
    {
      serverId: 'autojs6',
      transport: 'http-jsonrpc',
      endpointUrl: 'http://127.0.0.1:9317/mcp',
      method: 'tools/list',
    },
    {
      tauriInvoke: (async () => ({
        latencyMs: 5,
        rpc: {
          jsonrpc: '2.0',
          id: '3',
          error: { code: -32601, message: 'Method not found' },
        },
      })) as never,
    },
  );
  assert.equal(protoErrorRes.ok, false);
  assert.equal(protoErrorRes.errorKind, 'protocol_error');

  // 4. SSRF blocked & timeout classification
  const ssrfRes = await invokeMcpRpc(
    {
      serverId: 'proxypin',
      transport: 'http-jsonrpc',
      endpointUrl: 'http://169.254.169.254/latest/meta-data',
      method: 'tools/list',
    },
    {
      tauriInvoke: async () => {
        throw new Error('Blocked access to cloud metadata host');
      },
    },
  );
  assert.equal(ssrfRes.errorKind, 'ssrf_blocked');

  const timeoutRes = await invokeMcpRpc(
    {
      serverId: 'proxypin',
      transport: 'http-jsonrpc',
      endpointUrl: 'http://127.0.0.1:9318/mcp',
      method: 'tools/list',
    },
    {
      tauriInvoke: async () => {
        throw new Error('operation timed out after 4000ms');
      },
    },
  );
  assert.equal(timeoutRes.errorKind, 'timeout_error');
});

test('Tauri native invokeLlmRefine executes deterministic refiner offline with mandatory redaction', async () => {
  const dummyInvoke = (async () => ({})) as TauriInvokeFn;
  const providers = await fetchLlmProviders({ tauriInvoke: dummyInvoke });
  assert.ok(providers.some((p) => p.id === 'deterministic_rules' && p.available));

  const out = await invokeLlmRefine(
    {
      goal: 'refine',
      workflowName: 'JD Daily',
      appPackage: 'com.jd.jrapp',
      fallbackKeywords: ['去完成'],
      autojsState: { visibleActionTexts: ['去签到', '已完成'] },
      proxypinTraffic: {
        flows: [
          {
            path: '/tasks',
            requestHeaders: { Cookie: 'pt_key=secret;' },
            responseBody: {
              data: {
                tasks: [
                  { buttonText: '领取奖励', status: 'CLAIMABLE', browseSeconds: 18 },
                  { buttonText: '已完成', status: 'DONE' },
                ],
              },
            },
          },
        ],
      },
      provider: 'auto',
    },
    { tauriInvoke: dummyInvoke },
  );

  assert.equal(out.ok, true);
  assert.equal(out.result?.providerUsed, 'deterministic_rules');
  assert.ok(out.result?.refinedKeywords.includes('领取奖励'));
  assert.ok(!out.result?.refinedKeywords.includes('已完成'));
  assert.equal(out.result?.recommendedBrowseWaitMs, 19000);
  assert.ok((out.result?.redactionStats.redactedKeyCount || 0) >= 1);

  const cloudErr = await invokeLlmRefine(
    {
      goal: 'refine',
      workflowName: 'JD Daily',
      appPackage: 'com.jd.jrapp',
      fallbackKeywords: ['去完成'],
      provider: 'gemini',
    },
    { tauriInvoke: dummyInvoke },
  );
  assert.equal(cloudErr.ok, false);
  assert.match(cloudErr.error || '', /原生离线安装包/);
});
