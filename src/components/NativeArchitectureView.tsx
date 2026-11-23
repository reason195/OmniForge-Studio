import { useState } from 'react';
import { Monitor, Smartphone } from 'lucide-react';

type PlatformId = 'windows' | 'macos' | 'android';

interface PlatformSpec {
  id: PlatformId;
  title: string;
  runtime: string;
  ipcBridge: string;
  networkDiscovery: string;
  permissionsAndKeepAlive: string;
  packagingCommand: string;
  highlights: string[];
}

const PLATFORM_SPECS: Record<PlatformId, PlatformSpec> = {
  windows: {
    id: 'windows',
    title: 'Windows (x64 / ARM64)',
    runtime: 'Tauri 2 + WebView2 + Rust Sidecar Core',
    ipcBridge:
      'Tauri Command IPC + 本地 Rust Axum HTTP/JSON-RPC 网关（无需浏览器 CORS 代理）',
    networkDiscovery:
      'ADB USB 端口转发 (adb forward tcp:9317 tcp:9317) 或同网段 mDNS (_omniforge._tcp.local) 连接 Android AutoJs6 与本地 ProxyPin',
    permissionsAndKeepAlive:
      'Windows Defender 防火墙入站放行（仅局域网 Private Profile）；桌面端无后台冻结，支持托盘驻留与全局热键中断',
    packagingCommand: 'npm run build && cargo tauri build --target x86_64-pc-windows-msvc',
    highlights: [
      '生成 NSIS (.exe) 与 MSI 安装包，体积约 12–18 MB',
      '内置 adb.exe Sidecar 自动检测连线 Android 设备并建立 127.0.0.1 隧道',
      '敏感凭据托管于 Windows Credential Manager，绝不写入导出的 .js 文件',
    ],
  },
  macos: {
    id: 'macos',
    title: 'macOS (Apple Silicon / Universal)',
    runtime: 'Tauri 2 + WKWebView + Rust Core (Universal Binary)',
    ipcBridge:
      'Tauri Native IPC + Unix Domain Socket / Loopback JSON-RPC 桥接 ProxyPin 桌面版',
    networkDiscovery:
      'Loopback 127.0.0.1:9318 直连本机 ProxyPin MCP；通过 Bonjour/mDNS 或 ADB Wi-Fi 调试端口连接 Android 真机 AutoJs6 MCP',
    permissionsAndKeepAlive:
      'App Sandbox 关闭或显式申请 com.apple.security.network.client/server；Local Network Privacy 权限提示；NSProcessInfo.beginActivity 防止长编排休眠',
    packagingCommand: 'npm run build && cargo tauri build --target universal-apple-darwin',
    highlights: [
      '生成 Universal .app 与公证签名 .dmg（支持 M1/M2/M3/M4 与 Intel）',
      '通过 Keychain Services 安全存储 LLM API Key 与远端 MCP Bearer Token',
      '导出的 AutoJs6 脚本支持一键 AirDrop / ADB Push 到测试机',
    ],
  },
  android: {
    id: 'android',
    title: 'Android (Mobile Native APK)',
    runtime: 'Tauri 2 Mobile (JNI / Kotlin Bridge) + 同机双进程/Broadcast 协同',
    ipcBridge:
      'Kotlin ForegroundService + LocalHost JSON-RPC (127.0.0.1:9317 / 9318) 直连同机 AutoJs6 与 ProxyPin Android 版',
    networkDiscovery:
      '同机回环直连无需 ADB；Android 9+ 需在 network_security_config.xml 为 127.0.0.1 显式允许明文 HTTP JSON-RPC',
    permissionsAndKeepAlive:
      'Foreground Service (dataSync|mediaProjection) + 悬浮窗 (SYSTEM_ALERT_WINDOW) + 电池优化白名单 (REQUEST_IGNORE_BATTERY_OPTIMIZATIONS) + 无障碍服务保活',
    packagingCommand: 'npm run build && cargo tauri android build --apk --target aarch64',
    highlights: [
      '同机零延时调用 AutoJs6 PaddleOCR 试跑与 ProxyPin 本地 VPN 抓包流',
      '针对 Android 14 前台服务类型限制进行 foregroundServiceType 显式声明',
      '断网/熄屏场景下自动降级为编排期固化的离线兜底变量执行',
    ],
  },
};

export function NativeArchitectureView() {
  const [platform, setPlatform] = useState<PlatformId>('windows');
  const spec = PLATFORM_SPECS[platform];

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-bold text-slate-900">
            全平台原生架构（Windows / macOS / Android）与共享核心抽象
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            前端采用 React + TypeScript 共享可视化编排引擎与 IR 编译器，底层通过 Tauri 2 + Rust 统一封装本地 MCP 网关、脱敏管道与三端原生差异。
          </p>
        </div>

        {/* Platform Selector */}
        <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setPlatform('windows')}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
              platform === 'windows' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Windows 原生端</span>
          </button>
          <button
            type="button"
            onClick={() => setPlatform('macos')}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
              platform === 'macos' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" aria-hidden="true" />
            <span>macOS 原生端</span>
          </button>
          <button
            type="button"
            onClick={() => setPlatform('android')}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
              platform === 'android' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Android 原生端</span>
          </button>
        </div>

        {/* Selected Platform Matrix */}
        <section className="bg-white border border-slate-200 rounded-md p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
            <div>
              <h2 className="text-base font-bold text-slate-900">{spec.title}</h2>
              <div className="text-xs text-slate-500 mt-0.5">{spec.runtime}</div>
            </div>
            <div className="text-xs font-mono text-slate-700 bg-slate-100 px-3 py-1.5 rounded-md border border-slate-200">
              {spec.packagingCommand}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs leading-relaxed">
            <div className="space-y-1.5">
              <div className="font-semibold text-slate-900">本地服务与进程桥接</div>
              <p className="text-slate-600">{spec.ipcBridge}</p>
            </div>
            <div className="space-y-1.5">
              <div className="font-semibold text-slate-900">回环与局域网通信策略</div>
              <p className="text-slate-600">{spec.networkDiscovery}</p>
            </div>
            <div className="space-y-1.5">
              <div className="font-semibold text-slate-900">系统权限与后台保活</div>
              <p className="text-slate-600">{spec.permissionsAndKeepAlive}</p>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 space-y-2">
            <div className="text-xs font-semibold text-slate-900">平台工程要点</div>
            <ul className="space-y-1.5 text-xs text-slate-600 list-disc pl-4">
              {spec.highlights.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* Cross-platform Risks & Stability Blindspots */}
        <section className="bg-white border border-slate-200 rounded-md p-6 space-y-4">
          <h2 className="text-sm font-bold text-slate-900">
            关键稳定性盲点与风控边界矩阵
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-4 font-semibold">盲点分类</th>
                  <th className="py-2 pr-4 font-semibold">典型失效场景</th>
                  <th className="py-2 font-semibold">OmniForge 架构级防线</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                <tr>
                  <td className="py-2.5 pr-4 font-medium text-slate-900 whitespace-nowrap">屏幕分辨率碎片化</td>
                  <td className="py-2.5 pr-4">折叠屏、挖孔屏、刘海屏状态栏高度与 DPI 变化导致绝对像素点偏离</td>
                  <td className="py-2.5">全流程采用 0..1 归一化坐标 + OCR 边界框中心偏移 (offsetXRatio / offsetYRatio)</td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-4 font-medium text-slate-900 whitespace-nowrap">阻塞等待假死</td>
                  <td className="py-2.5 pr-4">sleep(16000) 期间达到全局超时却无法中断，导致脚本失控</td>
                  <td className="py-2.5">编译为 250ms 切片的 __safeSleep()，每次切片强制检查全局与单轮看门狗</td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-4 font-medium text-slate-900 whitespace-nowrap">凭据与隐私泄露</td>
                  <td className="py-2.5 pr-4">抓包 Header 携带 Cookie/Authorization 被送入大模型或写入脚本</td>
                  <td className="py-2.5">服务端强脱敏管道 + IR 密钥扫描 + 编译期 assertNoPlaintextSecrets 阻断</td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-4 font-medium text-slate-900 whitespace-nowrap">强依赖外部网络</td>
                  <td className="py-2.5 pr-4">手机端离线执行导出的 .js 时无电脑端 MCP 或 LLM 可连接</td>
                  <td className="py-2.5">编排期将 LLM 提炼词固化至 RUNTIME_VARS 并保留 fallbackValue 离线兜底</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
