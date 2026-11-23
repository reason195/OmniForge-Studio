# OmniForge Studio

跨平台可视化自动化脚本搭建工具：把工作流画布上的节点编译成可直接运行的 **AutoJs6 JavaScript 脚本**，并通过双 MCP（AutoJs6 MCP + ProxyPin MCP）获取真机状态与抓包流量，经脱敏和规则/LLM 提炼后回注工作流。

> Cross-platform visual automation script builder with AutoJs6 & ProxyPin MCP integration, traffic redaction, and AutoJs6 JS code generation.

## 功能

- **工作流画布（Workflow Canvas）**：9 种节点（启动应用、Scheme 跳转、返回校验、OCR 查找、点击、滑动等待、循环块、MCP 调用、LLM 提炼），内置京东金融、电商签到两个模板；IR 实时校验（循环依赖、悬空引用、必填变量、密钥嫌疑等），错误定位到节点。
- **MCP & 流量工作室（MCP & Traffic）**：双 MCP JSON-RPC 2.0 网关调用；ProxyPin 流量自动脱敏（Authorization / Cookie / Token / 手机号等）后才允许进入提炼；提炼结果（按钮关键词、浏览等待时长、接口契约）一键回注工作流变量。
- **代码导出（Code & Export）**：IR → 自包含 AutoJs6 `.js`，导出前强制密钥泄露扫描，未通过校验或扫描的工作流拒绝导出；禁用节点以注释形式保留。
- **多通道 LLM 提炼**：`auto` 路由支持 Gemini、OpenAI 兼容接口、Ollama、LM Studio，未配置或上游失败时透明降级到零外部模型的确定性规则引擎（离线可用）。
- **原生端（Tauri 2）**：同一套前端可打包为 Windows `.exe`（NSIS）与 Android `.apk`；原生桥通过 Rust 命令直连本机 `127.0.0.1` MCP 端口，强制阻断云元数据 SSRF、HTTP 重定向与明文外网（Android 仅放行环回地址）。

## 快速开始（Web 版）

前置：Node.js 20+

```bash
npm install --legacy-peer-deps
cp .env.example .env   # 按需填写，全部可空：无任何 Key 时自动走确定性规则引擎
npm run dev            # http://localhost:3000
```

生产构建与运行：

```bash
npm run build
NODE_ENV=production npm start
```

## 环境变量

见 [`.env.example`](.env.example)。要点：

| 变量 | 说明 |
|---|---|
| `GEMINI_API_KEY` | Gemini 云端提炼（服务端持有，不下发前端） |
| `OPENAI_COMPAT_BASE_URL` / `OPENAI_COMPAT_API_KEY` / `OPENAI_COMPAT_MODEL` | OpenAI 兼容接口 |
| `OLLAMA_BASE_URL` / `LMSTUDIO_BASE_URL` | 本地推理服务；需同时设 `LLM_ALLOW_LOCAL_INFERENCE=true` |
| `MCP_ALLOWLIST_HOSTS` | `http-jsonrpc` 模式下允许连接的 MCP 主机白名单（逗号分隔） |

## 开发与验证

```bash
npm run lint   # tsc --noEmit 类型检查
npm test       # 全部单元测试（IR / 代码生成 / 脱敏 / 原生桥 / MCP 网关 / LLM Provider，共 27 项）
npm run build  # Vite 生产构建
```

## 原生打包（Windows `.exe` / Android `.apk`）

推荐直接用 GitHub Actions：推送到 `main` 分支或在 Actions 页面手动运行 **Build Native Apps**，完成后在运行详情的 Artifacts 下载 `OmniForge-Studio-Windows-exe` 与 `OmniForge-Studio-Android-apk`。本机构建步骤见 [BUILD_NATIVE.md](BUILD_NATIVE.md)。

## 目录结构

```
src/core/        工作流 IR、AutoJs6 代码生成、脱敏、确定性提炼、原生桥（Web/Tauri 双通道）
src/server/      MCP 网关、LLM Provider 适配器（仅服务端）
src/components/  画布、节点检查器、MCP 流量工作室、代码导出、原生架构视图
server.ts        Express 网关：/api/mcp/rpc、/api/llm/refine、/api/redact、/api/compile、/api/health
src-tauri/       Tauri 2 原生壳：Rust MCP/LLM 桥、能力声明、Android 网络安全策略
.github/workflows/build-native.yml  质量门 + Windows/Android 构建流水线
```

## 安全设计

- 流量与 LLM 上下文在离开本机前强制脱敏；编译产物导出前做密钥泄露扫描。
- MCP / LLM 出站请求统一校验目标 URL：阻断云元数据地址（`169.254.169.254`、`metadata.google.internal` 等）、未授权环回与重定向。
- API Key 只存在于服务端环境变量或原生端请求头中，不写入工作流 IR 与导出脚本。

## License

[MIT](LICENSE)
