import { useState } from 'react';
import { Check, Copy, Download, ShieldCheck } from 'lucide-react';
import type { CompileResult } from '../core/codegen';
import type { WorkflowIR } from '../core/ir';

interface CodeExportViewProps {
  workflow: WorkflowIR;
  compiled: CompileResult;
  onDownloadFile: (filename: string, content: string, mimeType: string) => void;
}

export function CodeExportView({ workflow, compiled, onDownloadFile }: CodeExportViewProps) {
  const [artifactTab, setArtifactTab] = useState<'js' | 'ir' | 'contract'>('js');
  const [copied, setCopied] = useState(false);

  const activeContent =
    artifactTab === 'js'
      ? compiled.script
      : artifactTab === 'ir'
        ? compiled.irJson
        : compiled.apiContractJson;

  const activeFilename =
    artifactTab === 'js'
      ? `${workflow.meta.id}.autojs6.js`
      : artifactTab === 'ir'
        ? `${workflow.meta.id}.workflow.json`
        : `${workflow.meta.id}.api-contract.json`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-slate-900">产物编译、安全扫描与多格式导出</h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1 tabular-nums">
              <span>启用积木: {compiled.stats.enabledNodes}/{compiled.stats.totalNodes}</span>
              <span aria-hidden="true">·</span>
              <span>代码行数: {compiled.stats.lineCount}</span>
              <span aria-hidden="true">·</span>
              <span>全局看门狗: {compiled.stats.estimatedWatchdogSec}s</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                {compiled.stats.secretScanPassed ? '密钥泄露扫描通过 (0 风险)' : '存在风险变量'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-md cursor-pointer whitespace-nowrap"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
              <span>{copied ? '已复制' : '复制当前产物'}</span>
            </button>
            <button
              type="button"
              disabled={artifactTab === 'js' && !compiled.validation.valid}
              onClick={() => onDownloadFile(activeFilename, activeContent, 'text/plain;charset=utf-8')}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed rounded-md cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {artifactTab === 'js' && !compiled.validation.valid
                  ? '需先通过 IR 校验'
                  : `下载 ${activeFilename}`}
              </span>
            </button>
          </div>
        </div>

        {!compiled.validation.valid && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900 space-y-1">
            <div className="font-semibold">
              工作流 IR 校验未通过（错误 {compiled.validation.summary.errors} 项），已阻止导出 .autojs6.js 脚本：
            </div>
            {compiled.validation.issues.map((issue, idx) => (
              <div key={idx}>• {issue.message}</div>
            ))}
          </div>
        )}

        {/* Segmented Control */}
        <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => setArtifactTab('js')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap transition-colors ${
              artifactTab === 'js' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            AutoJs6 脚本 (.js)
          </button>
          <button
            type="button"
            onClick={() => setArtifactTab('ir')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap transition-colors ${
              artifactTab === 'ir' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            工作流工程 IR (.json)
          </button>
          <button
            type="button"
            onClick={() => setArtifactTab('contract')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap transition-colors ${
              artifactTab === 'contract' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            抓包接口契约 (.json)
          </button>
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-md overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800 text-xs font-mono text-slate-400">
            <span>{activeFilename}</span>
            <span className="tabular-nums">{activeContent.split('\n').length} lines</span>
          </div>
          <pre
            data-testid="export-artifact-viewer"
            className="p-4 text-xs font-mono leading-relaxed text-slate-200 overflow-auto max-h-[600px]"
          >
            {activeContent}
          </pre>
        </div>
      </div>
    </div>
  );
}
