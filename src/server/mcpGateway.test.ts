import test from 'node:test';
import assert from 'node:assert/strict';
import { callMcpGateway, validateMcpEndpointUrl } from './mcpGateway';

test('callMcpGateway discovers tools via local-bridge tools/list', async () => {
  const res = await callMcpGateway({
    serverId: 'autojs6',
    transport: 'local-bridge',
    endpointUrl: 'http://127.0.0.1:9317/mcp',
    method: 'tools/list',
  });

  assert.equal(res.ok, true);
  assert.equal(res.degraded, false);
  const data = res.data as { tools: Array<{ name: string }> };
  assert.ok(Array.isArray(data.tools));
  assert.ok(data.tools.some((t) => t.name === 'get_device_state'));
});

test('callMcpGateway redacts ProxyPin sensitive traffic fields automatically', async () => {
  const res = await callMcpGateway({
    serverId: 'proxypin',
    transport: 'local-bridge',
    endpointUrl: 'http://127.0.0.1:9318/mcp',
    method: 'tools/call',
    toolName: 'list_http_flows',
    args: { domain: 'ms.jr.jd.com', limit: 5 },
  });

  assert.equal(res.ok, true);
  assert.ok((res.redactionReport?.redactedKeyCount ?? 0) > 0);
  const serialized = JSON.stringify(res.data);
  assert.doesNotMatch(serialized, /demo-session-token-9f8e7d6c5b4a3210/);
  assert.doesNotMatch(serialized, /13800138000/);
  assert.match(serialized, /\[REDACTED\]/);
});

test('callMcpGateway distinguishes JSON-RPC protocol errors from tool execution errors (isError=true) and supports optional degradation', async () => {
  const toolErr = await callMcpGateway({
    serverId: 'autojs6',
    transport: 'local-bridge',
    endpointUrl: 'http://127.0.0.1:9317/mcp',
    method: 'tools/call',
    toolName: 'get_device_state',
    args: { __simulateToolError: true },
    optional: true,
  });
  assert.equal(toolErr.ok, false);
  assert.equal(toolErr.errorKind, 'tool_execution_error');
  assert.equal(toolErr.degraded, true);

  const protoErr = await callMcpGateway({
    serverId: 'autojs6',
    transport: 'local-bridge',
    endpointUrl: 'http://127.0.0.1:9317/mcp',
    method: 'tools/call',
    toolName: 'get_device_state',
    args: { __simulateProtocolError: true },
    optional: false,
  });
  assert.equal(protoErr.ok, false);
  assert.equal(protoErr.errorKind, 'protocol_error');
  assert.equal(protoErr.degraded, false);
});

test('validateMcpEndpointUrl blocks cloud metadata and unapproved loopback in http-jsonrpc mode', () => {
  assert.equal(validateMcpEndpointUrl('http://169.254.169.254/latest/meta-data').valid, false);
  assert.equal(validateMcpEndpointUrl('file:///etc/passwd').valid, false);
  assert.equal(validateMcpEndpointUrl('http://127.0.0.1:9317/mcp').valid, false);
  assert.equal(validateMcpEndpointUrl('http://127.0.0.1:9317/mcp', ['127.0.0.1']).valid, true);
  assert.equal(validateMcpEndpointUrl('http://[::ffff:127.0.0.1]:9317/mcp').valid, false);
  assert.equal(validateMcpEndpointUrl('http://[::ffff:169.254.169.254]/latest', ['[::ffff:a9fe:a9fe]']).valid, false);
  assert.equal(validateMcpEndpointUrl('http://100.64.0.1:9317/mcp').valid, false);
});

test('callMcpGateway disables HTTP redirects on outbound http-jsonrpc fetch', async () => {
  let capturedRedirect: RequestRedirect | undefined;
  const mockFetch: typeof fetch = async (_url, init) => {
    capturedRedirect = init?.redirect;
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: '1', result: { tools: [] } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const res = await callMcpGateway({
    serverId: 'autojs6',
    transport: 'http-jsonrpc',
    endpointUrl: 'https://mcp.example.com/rpc',
    method: 'tools/list',
    fetchImpl: mockFetch,
  });

  assert.equal(res.ok, true);
  assert.equal(capturedRedirect, 'error');
});

