import { AlertTriangle, CheckCircle2, Crosshair, RefreshCw, X } from 'lucide-react';
import type { ValidationCategory, ValidationIssue, ValidationResult } from '../core/ir';

export const VALIDATION_CATEGORY_LABELS: Record<ValidationCategory, string> = {
  circular_dependency: '循环依赖',
  dangling_reference: '悬空引用',
  missing_variable: '缺失必填变量',
  schema_policy: '策略校验',
  security: '安全校验',
};

export function getValidationIssueKey(issue: ValidationIssue, index: number): string {
  return `${issue.category}:${issue.nodeId ?? 'global'}:${issue.field}:${index}`;
}

export interface ValidationSummaryProps {
  issues?: ValidationIssue[];
  report?: ValidationResult;
  isStale?: boolean;
  activeIssueKey?: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onSelectIssue?: (issue: ValidationIssue, issueKey: string) => void;
  onRevalidate?: () => void;
  onDismiss?: () => void;
}

export function ValidationSummary({
  issues: issuesProp,
  report,
  isStale = false,
  activeIssueKey = null,
  onSelectNode,
  onSelectIssue,
  onRevalidate,
  onDismiss,
}: ValidationSummaryProps) {
  const issueList = issuesProp ?? report?.issues ?? [];

  const summary = report?.summary ?? {
    errors: issueList.filter((i) => i.level === 'error').length,
    warnings: issueList.filter((i) => i.level === 'warning').length,
    circularDependencies: issueList.filter((i) => i.category === 'circular_dependency').length,
    danglingReferences: issueList.filter((i) => i.category === 'dangling_reference').length,
    missingVariables: issueList.filter((i) => i.category === 'missing_variable').length,
  };

  const isValid = report ? report.valid : summary.errors === 0;

  const orderedIssues = [...issueList].sort((a, b) => {
    if (a.level === b.level) return 0;
    return a.level === 'error' ? -1 : 1;
  });

  return (
    <section
      aria-label="Workflow Validation Summary"
      data-testid="validation-summary"
      className={`rounded-md border p-3.5 text-xs space-y-2.5 shadow-sm backdrop-blur-xs ${
        isValid
          ? 'border-emerald-200 bg-emerald-50/95 text-emerald-950'
          : 'border-red-200 bg-red-50/95 text-red-950'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold min-w-0">
          {isValid ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
          )}
          <span className="truncate">
            {isValid
              ? 'WorkflowIR 校验通过 — 可安全编译导出'
              : `WorkflowIR 校验未通过（${summary.errors} 项错误，${summary.warnings} 项警告）`}
          </span>
          {isStale && (
            <span className="text-[11px] font-normal text-slate-600 whitespace-nowrap">
              （画布已变更，建议重新校验）
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onRevalidate && (
            <button
              type="button"
              onClick={onRevalidate}
              aria-label="重新校验 WorkflowIR"
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 bg-white/90 hover:bg-white border border-slate-200 rounded cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              <span>重新校验</span>
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="收起校验摘要"
              className="inline-flex items-center gap-1 px-1.5 py-1 text-[11px] text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              <span>收起</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] tabular-nums">
        <div className="rounded border border-slate-200/80 bg-white/90 px-2.5 py-1.5 flex items-center justify-between">
          <span className="text-slate-600">循环依赖</span>
          <span
            className={
              summary.circularDependencies > 0
                ? 'font-bold text-red-700'
                : 'font-semibold text-slate-800'
            }
          >
            {summary.circularDependencies}
          </span>
        </div>
        <div className="rounded border border-slate-200/80 bg-white/90 px-2.5 py-1.5 flex items-center justify-between">
          <span className="text-slate-600">悬空节点引用</span>
          <span
            className={
              summary.danglingReferences > 0
                ? 'font-bold text-red-700'
                : 'font-semibold text-slate-800'
            }
          >
            {summary.danglingReferences}
          </span>
        </div>
        <div className="rounded border border-slate-200/80 bg-white/90 px-2.5 py-1.5 flex items-center justify-between">
          <span className="text-slate-600">缺失必填变量</span>
          <span
            className={
              summary.missingVariables > 0
                ? 'font-bold text-red-700'
                : 'font-semibold text-slate-800'
            }
          >
            {summary.missingVariables}
          </span>
        </div>
        <div className="rounded border border-slate-200/80 bg-white/90 px-2.5 py-1.5 flex items-center justify-between">
          <span className="text-slate-600">策略/警告项</span>
          <span className="font-semibold text-slate-800">{summary.warnings}</span>
        </div>
      </div>

      {orderedIssues.length > 0 && (
        <ul className="space-y-1.5 max-h-44 overflow-y-auto pr-0.5">
          {orderedIssues.map((issue, idx) => {
            const issueKey = getValidationIssueKey(issue, idx);
            const isActive = activeIssueKey === issueKey;

            return (
              <li key={issueKey}>
                <button
                  type="button"
                  onClick={() => {
                    onSelectNode(issue.nodeId ?? null);
                    onSelectIssue?.(issue, issueKey);
                  }}
                  aria-label={
                    issue.nodeId
                      ? `高亮异常节点 ${issue.nodeId} (${idx + 1}): ${issue.message}`
                      : `查看全局校验问题 (${idx + 1}): ${issue.message}`
                  }
                  className={`w-full text-left flex flex-wrap items-center justify-between gap-2 rounded border px-2.5 py-1.5 transition-colors cursor-pointer ${
                    isActive
                      ? 'border-red-500 bg-red-100/70 ring-1 ring-red-500/30 text-slate-950'
                      : 'border-red-200/80 bg-white/95 hover:bg-red-50/70 hover:border-red-300 text-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span
                      className={`px-1.5 py-0.5 text-[10px] font-semibold rounded shrink-0 ${
                        issue.level === 'error'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {VALIDATION_CATEGORY_LABELS[issue.category]}
                    </span>
                    <span className="break-words leading-snug">{issue.message}</span>
                  </div>

                  {issue.nodeId ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-blue-700 bg-blue-50/80 border border-blue-200 rounded shrink-0">
                      <Crosshair className="w-3 h-3" aria-hidden="true" />
                      <span>高亮节点 ({issue.nodeId})</span>
                    </span>
                  ) : (
                    <span className="text-[11px] font-mono text-slate-500 shrink-0">
                      {issue.field}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
