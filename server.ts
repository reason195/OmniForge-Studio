import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { callMcpGateway } from './src/server/mcpGateway';
import { defaultLlmRegistry, type LlmProviderId } from './src/server/llmProviders';
import { compileWorkflowToAutoJs6 } from './src/core/codegen';
import { isWorkflowIRShape } from './src/core/ir';
import { redactTrafficPayload } from './src/core/redaction';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'OmniForge Studio Gateway', timestamp: new Date().toISOString() });
  });

  // List registered LLM Provider Adapters & server-side availability
  app.get('/api/llm/providers', (_req, res) => {
    res.json({
      ok: true,
      providers: defaultLlmRegistry.listProviders(),
    });
  });

  // Dual MCP JSON-RPC 2.0 Gateway (AutoJs6 MCP & ProxyPin MCP)
  app.post('/api/mcp/rpc', async (req, res) => {
    try {
      const {
        serverId,
        transport = 'local-bridge',
        endpointUrl = '',
        method,
        toolName,
        args,
        timeoutMs,
        optional,
      } = req.body || {};

      if (serverId !== 'autojs6' && serverId !== 'proxypin') {
        res.status(400).json({ ok: false, error: '无效的 serverId，仅支持 autojs6 或 proxypin。' });
        return;
      }

      if (method !== 'tools/list' && method !== 'tools/call') {
        res.status(400).json({ ok: false, error: '无效的 MCP method，仅支持 tools/list 或 tools/call。' });
        return;
      }

      const allowlistHosts = (process.env.MCP_ALLOWLIST_HOSTS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const gatewayResult = await callMcpGateway({
        serverId,
        transport: transport === 'http-jsonrpc' ? 'http-jsonrpc' : 'local-bridge',
        endpointUrl: String(endpointUrl || ''),
        method,
        toolName: typeof toolName === 'string' ? toolName : undefined,
        args: args && typeof args === 'object' ? args : {},
        timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : 4000,
        optional: Boolean(optional),
        allowlistHosts,
      });

      res.json(gatewayResult);
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'MCP 网关内部异常',
      });
    }
  });

  // Server-side Redaction Check Endpoint
  app.post('/api/redact', (req, res) => {
    try {
      const { payload } = req.body || {};
      const report = redactTrafficPayload(payload);
      res.json({ ok: true, ...report });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : '脱敏管道处理失败',
      });
    }
  });

  // Workflow Compilation Endpoint (IR -> AutoJs6 .js + Secret Scan)
  app.post('/api/compile', (req, res) => {
    try {
      const { ir, apiContractEndpoints } = (req.body || {}) as {
        ir?: unknown;
        apiContractEndpoints?: Array<{
          domain: string;
          path: string;
          method: string;
          statusCode: number;
          extractedHints: string[];
        }>;
      };
      if (!isWorkflowIRShape(ir)) {
        res.status(400).json({
          ok: false,
          error: '工作流 IR 结构无效，需包含完整的 meta、policy、variables、mcpBindings 与 nodes。',
        });
        return;
      }
      const safeEndpoints = Array.isArray(apiContractEndpoints) ? apiContractEndpoints : [];
      const compiled = compileWorkflowToAutoJs6(ir, safeEndpoints);
      if (!compiled.stats.secretScanPassed || !compiled.validation.valid) {
        res.status(400).json({
          ok: false,
          error: !compiled.stats.secretScanPassed
            ? '编译产物未通过密钥泄露扫描，已阻止输出。'
            : `工作流 IR 校验未通过（${compiled.validation.summary.errors} 项错误）。`,
          ...compiled,
        });
        return;
      }
      res.json({ ok: true, ...compiled });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : '代码生成失败',
      });
    }
  });

  // Unified LLM Provider Adapter Refinement Endpoint
  app.post('/api/llm/refine', async (req, res) => {
    try {
      const {
        goal,
        workflowName,
        appPackage,
        fallbackKeywords,
        autojsState,
        proxypinTraffic,
        provider,
        timeoutMs,
      } = req.body || {};

      if (!goal || typeof goal !== 'string') {
        res.status(400).json({ ok: false, error: '请提供明确的规则提炼目标 (goal)。' });
        return;
      }

      const validProviders = new Set([
        'auto',
        'gemini',
        'openai_compatible',
        'ollama',
        'lmstudio',
        'deterministic_rules',
      ]);
      const selectedProvider: LlmProviderId =
        typeof provider === 'string' && validProviders.has(provider)
          ? (provider as LlmProviderId)
          : 'auto';

      const refined = await defaultLlmRegistry.refine({
        goal,
        workflowName: String(workflowName || 'OmniForge Workflow'),
        appPackage: String(appPackage || ''),
        fallbackKeywords: Array.isArray(fallbackKeywords) ? fallbackKeywords.map(String) : ['去完成', '去浏览'],
        autojsState,
        proxypinTraffic,
        provider: selectedProvider,
        timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : undefined,
      });

      res.json({ ok: true, result: refined });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'LLM 规则提炼请求失败';
      const status = msg.includes('尚未配置') || msg.includes('未配置') ? 503 : 502;
      res.status(status).json({ ok: false, error: msg });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`OmniForge Studio listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start OmniForge Studio server:', err);
  process.exit(1);
});
