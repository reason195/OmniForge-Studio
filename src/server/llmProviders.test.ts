import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DeterministicRuleProviderAdapter,
  GeminiProviderAdapter,
  LlmProviderRegistry,
  LmStudioProviderAdapter,
  OllamaProviderAdapter,
  OpenAICompatibleProviderAdapter,
  validateProviderEndpointUrl,
} from './llmProviders';

const SAMPLE_INPUT = {
  goal: '提炼按钮优先级与等待时长',
  workflowName: 'JD Daily Tasks',
  appPackage: 'com.jd.jrapp',
  fallbackKeywords: ['去完成', '去浏览'],
  autojsState: {
    currentPackage: 'com.jd.jrapp',
    visibleActionTexts: ['去签到', '去浏览15秒', '已完成'],
  },
  proxypinTraffic: {
    flows: [
      {
        path: '/gw/generic/hy/h5/m/queryTaskList',
        requestHeaders: {
          Authorization: 'Bearer super-secret-token-9988',
          Cookie: 'pt_key=secret_cookie;',
        },
        responseBody: {
          userPhone: '13800138000',
          data: {
            tasks: [
              { buttonText: '去签到', status: 'TODO', browseSeconds: 0 },
              { buttonText: '去浏览15秒', status: 'TODO', browseSeconds: 15 },
              { buttonText: '领取奖励', status: 'CLAIMABLE', browseSeconds: 0 },
              { buttonText: '已完成', status: 'DONE', browseSeconds: 0 },
            ],
          },
        },
      },
    ],
  },
};

test('auto routing selects deterministic_rules when no cloud/local model env is configured and filters terminal buttons', async () => {
  const registry = new LlmProviderRegistry();
  const out = await registry.refine({ ...SAMPLE_INPUT, provider: 'auto' }, {});

  assert.equal(out.providerUsed, 'deterministic_rules');
  assert.equal(out.providerKind, 'deterministic');
  assert.ok(out.refinedKeywords.includes('去签到'));
  assert.ok(out.refinedKeywords.includes('领取奖励'));
  assert.ok(!out.refinedKeywords.includes('已完成'));
  assert.equal(out.recommendedBrowseWaitMs, 16000);
  assert.ok(out.redactionStats.redactedKeyCount >= 3);
});

test('explicit unavailable provider rejects transparently instead of silently mocking', async () => {
  const registry = new LlmProviderRegistry();
  await assert.rejects(
    () => registry.refine({ ...SAMPLE_INPUT, provider: 'gemini' }, {}),
    /GEMINI_API_KEY/,
  );
});

test('OpenAICompatible, Ollama, and LM Studio adapters receive strictly redacted context and normalize responses', async () => {
  let capturedOpenAiBody = '';
  const fakeOpenAiFetch: typeof fetch = async (_url, init) => {
    capturedOpenAiBody = String(init?.body || '');
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                refinedKeywords: ['领取奖励', '去签到'],
                recommendedBrowseWaitMs: 17000,
                branchConditions: [{ when: 'timeout', action: 'back', reason: 'recover' }],
                extractedApiHints: [{ endpoint: '/queryTaskList', field: 'status', meaning: 'task status' }],
                scriptSnippet: 'var k = ["领取奖励"];',
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  let capturedOllamaBody = '';
  const fakeOllamaFetch: typeof fetch = async (_url, init) => {
    capturedOllamaBody = String(init?.body || '');
    return new Response(
      JSON.stringify({
        message: {
          content:
            '```json\n{"refinedKeywords":["去浏览15秒"],"recommendedBrowseWaitMs":16000,"branchConditions":[],"extractedApiHints":[],"scriptSnippet":"var ok = true;"}\n```',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const registry = new LlmProviderRegistry([
    new GeminiProviderAdapter(),
    new OpenAICompatibleProviderAdapter(fakeOpenAiFetch),
    new OllamaProviderAdapter(fakeOllamaFetch),
    new LmStudioProviderAdapter(fakeOpenAiFetch),
    new DeterministicRuleProviderAdapter(),
  ]);

  const openaiRes = await registry.refine(
    { ...SAMPLE_INPUT, provider: 'openai_compatible' },
    {
      OPENAI_COMPAT_BASE_URL: 'https://api.example.com/v1',
      OPENAI_COMPAT_API_KEY: 'test-key-env-only',
    },
  );
  assert.equal(openaiRes.providerUsed, 'openai_compatible');
  assert.equal(openaiRes.recommendedBrowseWaitMs, 17000);
  assert.doesNotMatch(capturedOpenAiBody, /super-secret-token-9988/);
  assert.doesNotMatch(capturedOpenAiBody, /13800138000/);
  assert.match(capturedOpenAiBody, /\[REDACTED\]/);

  const ollamaRes = await registry.refine(
    { ...SAMPLE_INPUT, provider: 'ollama' },
    {
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
      LLM_ALLOW_LOCAL_INFERENCE: 'true',
    },
  );
  assert.equal(ollamaRes.providerUsed, 'ollama');
  assert.equal(ollamaRes.providerKind, 'local_llm');
  assert.deepEqual(ollamaRes.refinedKeywords, ['去浏览15秒']);
  assert.doesNotMatch(capturedOllamaBody, /super-secret-token-9988/);
});

test('validateProviderEndpointUrl blocks cloud metadata, IPv4-mapped IPv6, and gates localhost behind LLM_ALLOW_LOCAL_INFERENCE', async () => {
  assert.equal(validateProviderEndpointUrl('http://169.254.169.254/v1', true).valid, false);
  assert.equal(validateProviderEndpointUrl('http://[::ffff:169.254.169.254]/v1', true).valid, false);
  assert.equal(validateProviderEndpointUrl('http://[::ffff:127.0.0.1]:11434', false).valid, false);
  assert.equal(validateProviderEndpointUrl('http://100.64.0.5:11434', false).valid, false);
  assert.equal(validateProviderEndpointUrl('http://127.0.0.1:11434', false).valid, false);
  assert.equal(validateProviderEndpointUrl('http://127.0.0.1:11434', true).valid, true);
  assert.equal(validateProviderEndpointUrl('https://api.openai.com/v1', false).valid, true);

  let capturedRedirect: RequestRedirect | undefined;
  const adapter = new OpenAICompatibleProviderAdapter(async (_url, init) => {
    capturedRedirect = init?.redirect;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                refinedKeywords: ['去签到'],
                recommendedBrowseWaitMs: 15000,
                branchConditions: [],
                extractedApiHints: [],
                scriptSnippet: 'var ok = true;',
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });
  await adapter.refine(
    {
      goal: 'test',
      workflowName: 'wf',
      appPackage: 'com.jd.jrapp',
      fallbackKeywords: ['去签到'],
      autojsDeviceState: {},
      redactedProxyPinTraffic: {},
      timeoutMs: 3000,
    },
    { OPENAI_COMPAT_BASE_URL: 'https://api.example.com/v1', OPENAI_COMPAT_API_KEY: 'test-key' },
  );
  assert.equal(capturedRedirect, 'error');
});

test('auto mode transparently fails over to deterministic_rules when upstream cloud model returns 503', async () => {
  const failingFetch: typeof fetch = async () => new Response('Service Unavailable', { status: 503 });
  const registry = new LlmProviderRegistry([
    new GeminiProviderAdapter(),
    new OpenAICompatibleProviderAdapter(failingFetch),
    new OllamaProviderAdapter(failingFetch),
    new LmStudioProviderAdapter(failingFetch),
    new DeterministicRuleProviderAdapter(),
  ]);

  const out = await registry.refine(
    { ...SAMPLE_INPUT, provider: 'auto' },
    {
      OPENAI_COMPAT_BASE_URL: 'https://api.example.com/v1',
      OPENAI_COMPAT_API_KEY: 'test-key',
    },
  );

  assert.equal(out.providerUsed, 'deterministic_rules');
  assert.match(out.routingNote, /已自动切换至/);
  assert.ok(out.refinedKeywords.includes('去签到'));
});
