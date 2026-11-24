import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  BLOCK_CATALOG,
  createDefaultNode,
  validateWorkflowIR,
  type BlockCategory,
  type LoopBlockParams,
  type NodeType,
  type OcrFindParams,
  type ValidationIssue,
  type ValidationResult,
  type WorkflowIR,
  type WorkflowNode,
} from '../core/ir';
import type { CompileResult } from '../core/codegen';
import { NodeInspector } from './NodeInspector';
import { VALIDATION_CATEGORY_LABELS, ValidationSummary } from './ValidationSummary';

export type WorkflowTemplateId = 'jd' | 'miaosha' | 'coupon' | 'signin';

interface WorkflowWorkspaceProps {
  workflow: WorkflowIR;
  compiled: CompileResult;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onChangeWorkflow: (next: WorkflowIR) => void;
  onLoadTemplate: (templateId: WorkflowTemplateId) => void;
  validationTrigger?: number;
  handledValidationTrigger?: number;
  onValidationHandled?: (trigger: number) => void;
}

const CATEGORY_LABELS: Record<BlockCategory, string> = {
  navigation: '启动与导航',
  ocr_screen: 'OCR 与屏幕交互',
  flow_watchdog: '流程控制与保护',
  mcp_llm: 'MCP 与大模型',
};

function summarizeNode(node: WorkflowNode): string {
  switch (node.type) {
    case 'launch_app':
      return `${node.params.packageName} · 等待 ${node.params.waitMs}ms`;
    case 'scheme_jump':
      return `${node.params.encodeParams ? 'encodeURI' : 'raw'} · 等待 ${node.params.waitMs}ms`;
    case 'back_check':
      return `返回 ${node.params.times} 次 · 校验「${node.params.expectKeyword || '无'}」${node.params.dismissRetentionPopups !== false ? ' · 防挽留' : ''}`;
    case 'dismiss_popup':
      return `最多 ${node.params.maxLayers} 层 · ${node.params.dismissKeywords.slice(0, 3).join('/') || '图形X兜底'}`;
    case 'landing_stay':
      return `停留 ${node.params.targetStaySec}+${node.params.extraBufferSec}s · ${node.params.detectCountdown ? '倒计时识别' : '固定等待'}${node.params.handleCrossAppGestureBack ? ' · 跨App切回' : ''}`;
    case 'ocr_find': {
      const p = node.params as OcrFindParams;
      return `${p.preferAccessibility ? '无障碍+' : ''}${p.engine} · ${p.matchMode} · [${p.region.x0.toFixed(2)},${p.region.y0.toFixed(2)}..${p.region.x1.toFixed(2)},${p.region.y1.toFixed(2)}]`;
    }
    case 'click_target':
      return `${node.params.mode === 'ocr_result' ? (node.params.preferNodeClick ? 'node.click/中心' : 'OCR 中心') : '比例坐标'} · 重试 ${node.params.maxRetries} 次`;
    case 'swipe_wait':
      return `滑动 ${node.params.durationMs}ms · __safeSleep(${node.params.waitAfterMs}ms)`;
    case 'loop_block':
      return `最多 ${node.params.maxIterations} 轮 · 连续未命中≥${node.params.breakWhenMissStreak}退出 · 单轮熔断 ${Math.round(node.params.perRoundTimeoutMs / 1000)}s`;
    case 'mcp_call':
      return `${node.params.serverId}.${node.params.toolName} · ${node.params.optional ? 'optional 降级' : '严格模式'}`;
    case 'llm_refine':
      return `输出变量 ${node.params.targetVar} · 含离线兜底`;
  }
}

export function WorkflowWorkspace({
  workflow,
  compiled,
  selectedNodeId,
  onSelectNode,
  onChangeWorkflow,
  onLoadTemplate,
  validationTrigger = 0,
  handledValidationTrigger,
  onValidationHandled,
}: WorkflowWorkspaceProps) {
  const [rightTab, setRightTab] = useState<'inspector' | 'code'>('inspector');
  const [insertIntoSelectedLoop, setInsertIntoSelectedLoop] = useState(false);
  const [simLogs, setSimLogs] = useState<string[]>([]);
  const [activeSimNodeId, setActiveSimNodeId] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [validationReport, setValidationReport] = useState<ValidationResult | null>(null);
  const [isReportStale, setIsReportStale] = useState(false);
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
  const [activeIssueKey, setActiveIssueKey] = useState<string | null>(null);
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const workflowRef = useRef(workflow);
  workflowRef.current = workflow;

  const localHandledTriggerRef = useRef(0);

  useEffect(() => {
    setIsReportStale(true);
    setHighlightedNodeId(null);
    setActiveIssueKey(null);
  }, [workflow]);

  useEffect(() => {
    const alreadyHandled =
      handledValidationTrigger !== undefined
        ? validationTrigger <= handledValidationTrigger
        : validationTrigger <= localHandledTriggerRef.current;

    if (validationTrigger > 0 && !alreadyHandled) {
      localHandledTriggerRef.current = validationTrigger;
      const result = validateWorkflowIR(workflowRef.current);
      setValidationReport(result);
      setIsReportStale(false);
      setActiveIssueKey(null);
      const firstErrNode = result.issues.find((i) => i.level === 'error' && i.nodeId)?.nodeId ?? null;
      setHighlightedNodeId(firstErrNode);
      onValidationHandled?.(validationTrigger);
    }
  }, [validationTrigger, handledValidationTrigger, onValidationHandled]);

  const handleValidateWorkflow = (): ValidationResult => {
    const result = validateWorkflowIR(workflow);
    setValidationReport(result);
    setIsReportStale(false);
    setActiveIssueKey(null);
    const firstErrNode = result.issues.find((i) => i.level === 'error' && i.nodeId)?.nodeId ?? null;
    setHighlightedNodeId(firstErrNode);
    return result;
  };

  const handleHighlightProblemNode = (nodeId: string | null) => {
    setHighlightedNodeId(nodeId);
    if (!nodeId) return;
    onSelectNode(nodeId);
    setRightTab('inspector');
    const targetEl = nodeRefs.current[nodeId];
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleSelectValidationIssue = (_issue: ValidationIssue, issueKey: string) => {
    setActiveIssueKey(issueKey);
  };

  const findNodeById = (nodes: WorkflowNode[], id: string | null): WorkflowNode | null => {
    if (!id) return null;
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.type === 'loop_block') {
        const hit = findNodeById((n.params as LoopBlockParams).children, id);
        if (hit) return hit;
      }
    }
    return null;
  };

  const selectedNode = findNodeById(workflow.nodes, selectedNodeId);

  const updateNodeTree = (
    nodes: WorkflowNode[],
    updater: (n: WorkflowNode) => WorkflowNode,
  ): WorkflowNode[] => {
    return nodes.map((n) => {
      const updated = updater(n);
      if (updated.type === 'loop_block') {
        return {
          ...updated,
          params: {
            ...updated.params,
            children: updateNodeTree((updated.params as LoopBlockParams).children, updater),
          },
        };
      }
      return updated;
    });
  };

  const handleUpdateNode = (updatedNode: WorkflowNode) => {
    onChangeWorkflow({
      ...workflow,
      meta: { ...workflow.meta, updatedAt: new Date().toISOString() },
      nodes: updateNodeTree(workflow.nodes, (n) => (n.id === updatedNode.id ? updatedNode : n)),
    });
  };

  const handleAddBlock = (type: NodeType) => {
    const newNode = createDefaultNode(type, String(Date.now()).slice(-5));
    const targetLoop =
      insertIntoSelectedLoop && selectedNode?.type === 'loop_block' && type !== 'loop_block'
        ? selectedNode
        : null;

    if (targetLoop) {
      onChangeWorkflow({
        ...workflow,
        nodes: updateNodeTree(workflow.nodes, (n) =>
          n.id === targetLoop.id && n.type === 'loop_block'
            ? {
                ...n,
                params: {
                  ...n.params,
                  children: [...(n.params as LoopBlockParams).children, newNode],
                },
              }
            : n,
        ),
      });
    } else {
      onChangeWorkflow({
        ...workflow,
        nodes: [...workflow.nodes, newNode],
      });
    }
    onSelectNode(newNode.id);
    setRightTab('inspector');
  };

  const mutateList = (
    list: WorkflowNode[],
    nodeId: string,
    op: 'up' | 'down' | 'delete' | 'duplicate',
  ): { next: WorkflowNode[]; changed: boolean } => {
    const idx = list.findIndex((n) => n.id === nodeId);
    if (idx !== -1) {
      const next = [...list];
      if (op === 'delete') {
        next.splice(idx, 1);
      } else if (op === 'up' && idx > 0) {
        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      } else if (op === 'down' && idx < next.length - 1) {
        [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      } else if (op === 'duplicate') {
        const clone: WorkflowNode = JSON.parse(JSON.stringify(next[idx]));
        clone.id = `${clone.id}_copy_${String(Date.now()).slice(-4)}`;
        clone.label = `${clone.label} (副本)`;
        next.splice(idx + 1, 0, clone);
      }
      return { next, changed: true };
    }

    let changed = false;
    const mapped = list.map((n) => {
      if (n.type === 'loop_block') {
        const res = mutateList((n.params as LoopBlockParams).children, nodeId, op);
        if (res.changed) {
          changed = true;
          return {
            ...n,
            params: { ...n.params, children: res.next },
          };
        }
      }
      return n;
    });
    return { next: mapped, changed };
  };

  const handleNodeAction = (nodeId: string, op: 'up' | 'down' | 'delete' | 'duplicate') => {
    const res = mutateList(workflow.nodes, nodeId, op);
    if (res.changed) {
      onChangeWorkflow({ ...workflow, nodes: res.next });
      if (op === 'delete' && selectedNodeId === nodeId) {
        onSelectNode(null);
      }
    }
  };

  const handleToggleEnabled = (node: WorkflowNode) => {
    handleUpdateNode({ ...node, enabled: !node.enabled });
  };

  const runDrySimulation = () => {
    const validation = handleValidateWorkflow();
    if (!validation.valid) {
      const firstNodeIssue = validation.issues.find((i) => i.level === 'error' && i.nodeId);
      if (firstNodeIssue?.nodeId) {
        onSelectNode(firstNodeIssue.nodeId);
      }
      setSimLogs([
        `[Validate] 编译前校验未通过（错误 ${validation.summary.errors} 项）：`,
        ...validation.issues.map((i) => `  - [${VALIDATION_CATEGORY_LABELS[i.category]}] ${i.message}`),
      ]);
      return;
    }

    const logs: string[] = [];
    logs.push(`[Watchdog] 启动全局超时保护 (${Math.round(workflow.policy.globalTimeoutMs / 1000)}s)`);
    let firstActiveId: string | null = null;

    for (const node of workflow.nodes) {
      if (!node.enabled) {
        logs.push(`[跳过] 已禁用积木: ${node.label}`);
        continue;
      }
      if (!firstActiveId) firstActiveId = node.id;

      if (node.type === 'loop_block') {
        const lp = node.params as LoopBlockParams;
        logs.push(
          `[循环] 进入「${node.label}」(max=${lp.maxIterations}, breakWhenMissStreak=${lp.breakWhenMissStreak}, 单轮超时=${lp.perRoundTimeoutMs}ms)`,
        );
        for (const child of lp.children) {
          if (!child.enabled) {
            logs.push(`  [跳过子积木] ${child.label}`);
          } else {
            logs.push(`  [执行子积木] ${child.label} -> ${summarizeNode(child)}`);
          }
        }
        logs.push(`[循环模拟结束] 第 2 轮无新任务命中，missStreak 达到退出条件`);
      } else {
        logs.push(`[执行] ${node.label} -> ${summarizeNode(node)}`);
      }
    }
    logs.push(`[完成] 校验通过，导出脚本不含任何硬编码密钥`);
    setActiveSimNodeId(firstActiveId);
    setSimLogs(logs);
  };

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(compiled.script);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      setCopiedCode(false);
    }
  };

  const renderNodeRow = (
    node: WorkflowNode,
    indexLabel: string,
    isChild = false,
    siblingCount = 1,
    siblingIndex = 0,
  ) => {
    const isSelected = selectedNodeId === node.id;
    const isSimHighlight = activeSimNodeId === node.id;
    const isProblemHighlighted = highlightedNodeId === node.id;
    const nodeIssues = (validationReport?.issues ?? []).filter((i) => i.nodeId === node.id);
    const hasNodeError = nodeIssues.some((i) => i.level === 'error');
    const cat = BLOCK_CATALOG.find((b) => b.type === node.type)?.category || 'navigation';

    return (
      <div
        key={node.id}
        id={`node-${node.id}`}
        ref={(el) => {
          nodeRefs.current[node.id] = el;
        }}
        data-node-id={node.id}
        data-highlighted={isProblemHighlighted ? 'true' : 'false'}
        className={isChild ? 'ml-6' : ''}
      >
        <div
          className={`group rounded-md border bg-white transition-colors ${
            isProblemHighlighted
              ? 'border-red-600 ring-2 ring-red-500/35 bg-red-50/40'
              : isSelected
                ? 'border-blue-600 ring-2 ring-blue-600/20'
                : hasNodeError
                  ? 'border-red-400 bg-red-50/20'
                  : isSimHighlight
                    ? 'border-amber-500 ring-2 ring-amber-500/20'
                    : 'border-slate-200 hover:border-slate-300'
          } ${!node.enabled ? 'opacity-60 bg-slate-50' : ''}`}
        >
          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <button
              type="button"
              onClick={() => {
                onSelectNode(node.id);
                setRightTab('inspector');
              }}
              className="flex-1 text-left min-w-0 cursor-pointer focus-visible:outline-none"
            >
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <span className="font-mono tabular-nums font-medium text-slate-700">{indexLabel}</span>
                <span aria-hidden="true">·</span>
                <span>{CATEGORY_LABELS[cat]}</span>
                {isProblemHighlighted && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-red-700 font-semibold">校验异常定位</span>
                  </>
                )}
                {!node.enabled && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-amber-700 font-medium">已禁用</span>
                  </>
                )}
              </div>
              <div className="text-sm font-semibold text-slate-900 truncate mt-0.5">{node.label}</div>
              <div className="text-xs font-mono text-slate-500 truncate mt-0.5 tabular-nums">
                {summarizeNode(node)}
              </div>
            </button>

            <div className="flex items-center gap-1 shrink-0">
              <label
                className="inline-flex items-center px-1.5 py-1 text-xs text-slate-600 cursor-pointer"
                title={node.enabled ? '禁用积木' : '启用积木'}
              >
                <input
                  type="checkbox"
                  aria-label={`启用或禁用「${node.label}」`}
                  checked={node.enabled}
                  onChange={() => handleToggleEnabled(node)}
                  className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 cursor-pointer"
                />
              </label>

              <button
                type="button"
                aria-label={`上移「${node.label}」`}
                disabled={siblingIndex === 0}
                onClick={() => handleNodeAction(node.id, 'up')}
                className="p-1.5 text-slate-400 hover:text-slate-800 disabled:opacity-30 cursor-pointer rounded hover:bg-slate-100"
              >
                <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`下移「${node.label}」`}
                disabled={siblingIndex === siblingCount - 1}
                onClick={() => handleNodeAction(node.id, 'down')}
                className="p-1.5 text-slate-400 hover:text-slate-800 disabled:opacity-30 cursor-pointer rounded hover:bg-slate-100"
              >
                <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`复制「${node.label}」`}
                onClick={() => handleNodeAction(node.id, 'duplicate')}
                className="p-1.5 text-slate-400 hover:text-slate-800 cursor-pointer rounded hover:bg-slate-100"
              >
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`删除「${node.label}」`}
                onClick={() => handleNodeAction(node.id, 'delete')}
                className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer rounded hover:bg-red-50"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        {node.type === 'loop_block' && (
          <div className="mt-2 space-y-2 border-l border-slate-300 pl-3 ml-3">
            {(node.params as LoopBlockParams).children.length === 0 ? (
              <div className="ml-6 px-3 py-2 text-xs text-slate-500 border border-dashed border-slate-300 rounded-md bg-slate-50/70">
                循环体为空。选中此循环并勾选左侧「添加到循环内」即可插入子积木。
              </div>
            ) : (
              (node.params as LoopBlockParams).children.map((child, cIdx, arr) =>
                renderNodeRow(child, `${indexLabel}.${cIdx + 1}`, true, arr.length, cIdx),
              )
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden bg-slate-50">
      {/* Left Block Palette (260px) */}
      <aside className="w-full lg:w-64 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col shrink-0 overflow-y-auto">
        <div className="p-4 border-b border-slate-200 space-y-2">
          <div className="text-xs font-semibold text-slate-900">工作流模板</div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => onLoadTemplate('jd')}
              className={`px-2 py-1.5 text-xs font-medium rounded-md border text-center cursor-pointer transition-colors ${
                workflow.meta.id === 'wf_jd_jr_daily_01'
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
              }`}
            >
              京东金融任务
            </button>
            <button
              type="button"
              onClick={() => onLoadTemplate('miaosha')}
              className={`px-2 py-1.5 text-xs font-medium rounded-md border text-center cursor-pointer transition-colors ${
                workflow.meta.id === 'wf_jd_miaosha_beans_03'
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
              }`}
            >
              秒杀·天天领豆
            </button>
            <button
              type="button"
              onClick={() => onLoadTemplate('coupon')}
              className={`px-2 py-1.5 text-xs font-medium rounded-md border text-center cursor-pointer transition-colors ${
                workflow.meta.id === 'wf_jd_coupon_center_04'
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
              }`}
            >
              京东领券中心
            </button>
            <button
              type="button"
              onClick={() => onLoadTemplate('signin')}
              className={`px-2 py-1.5 text-xs font-medium rounded-md border text-center cursor-pointer transition-colors ${
                workflow.meta.id === 'wf_signin_coupon_02'
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900'
              }`}
            >
              电商签到领券
            </button>
          </div>
        </div>

        <div className="p-3.5 space-y-3 flex-1 overflow-y-auto">
          <label className="flex items-center gap-2 text-xs text-slate-700 pb-2 border-b border-slate-100 cursor-pointer">
            <input
              type="checkbox"
              checked={insertIntoSelectedLoop}
              onChange={(e) => setInsertIntoSelectedLoop(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600"
            />
            <span>添加到选中循环块内部</span>
          </label>

          {(['navigation', 'ocr_screen', 'flow_watchdog', 'mcp_llm'] as BlockCategory[]).map(
            (category) => (
              <div key={category} className="space-y-1">
                <div className="text-[11px] font-semibold text-slate-500">
                  {CATEGORY_LABELS[category]}
                </div>
                <div className="space-y-1">
                  {BLOCK_CATALOG.filter((item) => item.category === category).map((item) => (
                    <button
                      key={item.type}
                      type="button"
                      onClick={() => handleAddBlock(item.type)}
                      className="w-full text-left px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:border-blue-400 hover:bg-blue-50/40 transition-colors cursor-pointer group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-900 group-hover:text-blue-700">
                          {item.title}
                        </span>
                        <Plus className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600" aria-hidden="true" />
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 leading-tight truncate">
                        {item.summary}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      </aside>

      {/* Center Interactive Flow Canvas */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Global Watchdog & Policy Strip */}
        <div className="bg-white border-b border-slate-200 px-5 py-3 flex flex-wrap items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-slate-900 truncate">{workflow.meta.name}</h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-0.5 tabular-nums">
              <span>包名: {workflow.meta.appPackage}</span>
              <span aria-hidden="true">·</span>
              <span>已启用 {compiled.stats.enabledNodes}/{compiled.stats.totalNodes} 积木</span>
              <span aria-hidden="true">·</span>
              <span>生成代码 {compiled.stats.lineCount} 行</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-700">
              <label htmlFor="policy-global-timeout" className="text-slate-500">
                全局超时(s)
              </label>
              <input
                id="policy-global-timeout"
                type="number"
                min={10}
                max={3600}
                value={Math.round(workflow.policy.globalTimeoutMs / 1000)}
                onChange={(e) =>
                  onChangeWorkflow({
                    ...workflow,
                    policy: {
                      ...workflow.policy,
                      globalTimeoutMs: Math.max(5000, (Number(e.target.value) || 60) * 1000),
                    },
                  })
                }
                className="w-16 px-2 py-1 text-xs font-mono tabular-nums border border-slate-300 rounded bg-white"
              />
            </div>

            <div className="flex items-center gap-1.5 text-xs text-slate-700">
              <label htmlFor="policy-ocr-engine" className="text-slate-500">
                默认 OCR
              </label>
              <select
                id="policy-ocr-engine"
                value={workflow.policy.ocrDefaultEngine}
                onChange={(e) =>
                  onChangeWorkflow({
                    ...workflow,
                    policy: {
                      ...workflow.policy,
                      ocrDefaultEngine: e.target.value as 'paddle' | 'mlkit' | 'tesseract',
                    },
                  })
                }
                className="px-2 py-1 text-xs border border-slate-300 rounded bg-white"
              >
                <option value="paddle">paddle</option>
                <option value="mlkit">mlkit</option>
                <option value="tesseract">tesseract</option>
              </select>
            </div>

            <label
              className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer whitespace-nowrap"
              title="启动时自动终止其他运行中脚本并开启验证码风控暂停"
            >
              <input
                id="policy-single-instance"
                type="checkbox"
                checked={workflow.policy.preventConcurrentScripts !== false}
                onChange={(e) =>
                  onChangeWorkflow({
                    ...workflow,
                    policy: {
                      ...workflow.policy,
                      preventConcurrentScripts: e.target.checked,
                    },
                  })
                }
                className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600"
              />
              <span>单实例防抢控</span>
            </label>

            <button
              type="button"
              onClick={handleValidateWorkflow}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-md cursor-pointer whitespace-nowrap"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
              <span>Validate</span>
            </button>

            {validationReport && validationReport.summary.errors === 0 && !isReportStale && (
              <span
                data-testid="validation-pass-status"
                className="text-xs font-medium text-emerald-700 whitespace-nowrap tabular-nums"
              >
                校验通过 (0 错误)
              </span>
            )}

            <button
              type="button"
              onClick={runDrySimulation}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-md cursor-pointer whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
              <span>模拟运行</span>
            </button>
          </div>
        </div>

        {/* Canvas Block Stream */}
        <div className="flex-1 overflow-y-auto px-5 pt-5 pb-5 flex flex-col justify-between gap-4" data-testid="workflow-canvas-list">
          <div className="space-y-3">
            {workflow.nodes.length === 0 ? (
              <div className="p-8 text-center bg-white border border-dashed border-slate-300 rounded-md space-y-3">
                <div className="text-sm font-medium text-slate-800">画布暂无积木节点</div>
                <div className="text-xs text-slate-500">
                  从左侧积木库点击任意模块添加，或恢复默认京东金融日常任务模板。
                </div>
                <button
                  type="button"
                  onClick={() => onLoadTemplate('jd')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>恢复默认模板</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2.5 max-w-3xl">
                {workflow.nodes.map((node, idx) =>
                  renderNodeRow(node, String(idx + 1).padStart(2, '0'), false, workflow.nodes.length, idx),
                )}
              </div>
            )}

            {simLogs.length > 0 && (
              <div className="max-w-3xl mt-4 bg-slate-900 text-slate-100 rounded-md p-3.5 space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-semibold text-slate-200">本地干跑模拟轨迹 (Dry-Run)</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSimLogs([]);
                      setActiveSimNodeId(null);
                    }}
                    className="text-xs text-slate-400 hover:text-white cursor-pointer"
                  >
                    清除日志
                  </button>
                </div>
                <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap text-slate-300">
                  {simLogs.join('\n')}
                </pre>
              </div>
            )}
          </div>

          {validationReport && validationReport.summary.errors > 0 && (
            <div className="sticky bottom-0 z-20 -mx-5 -mb-5 px-5 pt-2.5 pb-4 bg-slate-50/95 backdrop-blur-xs border-t border-slate-200/80">
              <div className="max-w-3xl">
                <ValidationSummary
                  issues={validationReport.issues}
                  report={validationReport}
                  isStale={isReportStale}
                  activeIssueKey={activeIssueKey}
                  onSelectNode={handleHighlightProblemNode}
                  onSelectIssue={handleSelectValidationIssue}
                  onRevalidate={handleValidateWorkflow}
                  onDismiss={() => {
                    setValidationReport(null);
                    setHighlightedNodeId(null);
                    setActiveIssueKey(null);
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Right Inspector + Live Code Preview Split (420px) */}
      <aside className="w-full lg:w-[420px] bg-white border-t lg:border-t-0 lg:border-l border-slate-200 flex flex-col shrink-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 border-b border-slate-200 bg-slate-50/60 shrink-0">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setRightTab('inspector')}
              className={`py-2.5 text-xs font-semibold border-b-2 cursor-pointer whitespace-nowrap ${
                rightTab === 'inspector'
                  ? 'border-blue-600 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              积木参数检查器
            </button>
            <button
              type="button"
              onClick={() => {
                handleValidateWorkflow();
                setRightTab('code');
              }}
              className={`py-2.5 text-xs font-semibold border-b-2 cursor-pointer whitespace-nowrap ${
                rightTab === 'code'
                  ? 'border-blue-600 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              实时 AutoJs6 预览
            </button>
          </div>
          {rightTab === 'code' && (
            <button
              type="button"
              onClick={copyScript}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 cursor-pointer whitespace-nowrap"
            >
              {copiedCode ? '已复制' : '复制脚本'}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {rightTab === 'inspector' ? (
            <NodeInspector node={selectedNode} onUpdateNode={handleUpdateNode} />
          ) : (
            <div className="h-full bg-slate-950 text-slate-100 p-4 overflow-auto">
              <pre
                data-testid="live-code-preview"
                className="text-[11px] font-mono leading-relaxed whitespace-pre text-slate-200"
              >
                {compiled.script}
              </pre>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
