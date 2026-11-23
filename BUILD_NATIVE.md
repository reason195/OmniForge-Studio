# OmniForge Studio 原生打包指南（Windows `.exe` & Android `.apk`）

本项目采用 **Web + Tauri 2 双运行通道架构**：
- **Web 在线预览 / 本地 Node 服务**：通过 Express 网关（`server.ts`）代理 `/api/mcp/rpc` 与 `/api/llm/refine`。
- **原生桌面端 / Android App（Tauri 2）**：通过 `src/core/nativeBridge.ts` 自动识别原生外壳，将 MCP JSON-RPC 请求交由 Rust 命令 `mcp_jsonrpc_call`（基于 `rustls`，零 OpenSSL 依赖、强制阻断云元数据 SSRF 与 HTTP 重定向）直连本地 `127.0.0.1` 工具端口，并内置确定性规则引擎实现离线提炼。

---

## 一、推荐方式：GitHub Actions 云端自动构建（零本机环境配置）

仓库已包含 `.github/workflows/build-native.yml`：
1. 将本项目代码推送到你的 GitHub 仓库（`main` / `master` 分支，或在 **Actions** 页面手动点击 **Run workflow**）。
2. 工作流会自动完成：
   - **quality-gate**：运行 `npm run lint`、全部单元测试与 `npm run build`。
   - **build-windows**：在 Windows Server Runner 上生成图标、执行 `cargo test` 并产出 **NSIS `.exe` 安装包**。
   - **build-android**：在 Ubuntu Runner 上安装 Android SDK 34 + NDK 26，注入 `src-tauri/android/network_security_config.xml`（仅放行 `127.0.0.1` / `localhost` 环回 MCP 通信，拦截外网明文 HTTP），最终产出 **`aarch64` `.apk` 安装包**。
3. 构建完成后，在 Workflow 运行详情底部的 **Artifacts** 区域直接下载：
   - `OmniForge-Studio-Windows-exe`
   - `OmniForge-Studio-Android-apk`

---

## 二、本机构建 Windows `.exe` 安装包

### 前置依赖（Windows 10 / 11）
1. **Node.js 20+**
2. **Rust 工具链**：安装 [rustup](https://rustup.rs/)（MSVC 工具链）
3. **Microsoft Visual Studio C++ Build Tools**（勾选“使用 C++ 的桌面开发”）
4. **WebView2 Runtime**（Windows 11 默认自带）

### 构建命令
```bash
npm install
npx --yes @tauri-apps/cli@^2 icon src-tauri/icons/app-icon.png
npx --yes @tauri-apps/cli@^2 build --bundles nsis
```
产物路径：`src-tauri/target/release/bundle/nsis/OmniForge Studio_0.1.0_x64-setup.exe`

---

## 三、本机构建 Android `.apk` 安装包

### 前置依赖（macOS / Linux / Windows WSL2）
1. **Node.js 20+** 与 **JDK 17**（设置 `JAVA_HOME`）
2. **Android SDK (API 34)** 与 **Android NDK r26+**（设置 `ANDROID_HOME` 与 `NDK_HOME`）
3. **Rust Android 目标平台**：
   ```bash
   rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android i686-linux-android
   ```

### 构建命令
```bash
npm install
npx --yes @tauri-apps/cli@^2 icon src-tauri/icons/app-icon.png
npx --yes @tauri-apps/cli@^2 android init --ci
```

将 `src-tauri/android/network_security_config.xml` 拷贝到 `src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml`，并在 `AndroidManifest.xml` 的 `<application` 标签添加：
```xml
android:networkSecurityConfig="@xml/network_security_config"
```
随后执行编译打包：
```bash
npx --yes @tauri-apps/cli@^2 android build --apk --target aarch64
```
> 提示：测试阶段若需直接安装到手机（`adb install`），请根据需要生成或配置 Android 签名密钥（`.keystore`）。产物位于 `src-tauri/gen/android/app/build/outputs/apk/`。

---

## 四、目录结构说明
- `src/core/nativeBridge.ts`：统一运行通道适配层（Web `fetch('/api/...')` vs Tauri `invoke('mcp_jsonrpc_call')` + 强制脱敏）。
- `src/core/deterministicRefiner.ts`：Web 后端与原生端共享的零外部模型确定性规则提炼引擎。
- `src-tauri/`：Tauri 2 原生壳配置、Rust MCP/LLM 桥接源码、能力权限声明与 Android 网络安全策略。
- `.github/workflows/build-native.yml`：Windows `.exe` 与 Android `.apk` CI/CD 流水线。
