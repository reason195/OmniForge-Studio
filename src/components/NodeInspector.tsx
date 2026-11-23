import type {
  BackCheckParams,
  ClickTargetParams,
  LaunchAppParams,
  LlmRefineParams,
  LoopBlockParams,
  McpCallParams,
  OcrFindParams,
  SchemeJumpParams,
  SwipeWaitParams,
  WorkflowNode,
} from '../core/ir';
import { PhoneRegionPreview } from './PhoneRegionPreview';

interface NodeInspectorProps {
  node: WorkflowNode | null;
  onUpdateNode: (updated: WorkflowNode) => void;
}

export function NodeInspector({ node, onUpdateNode }: NodeInspectorProps) {
  if (!node) {
    return (
      <div className="p-5 text-sm text-slate-500">
        请在中间画布点击任意积木节点，即可在此编辑其参数、超时保护或归一化坐标区域。
      </div>
    );
  }

  const updateParams = (patch: Record<string, unknown>) => {
    onUpdateNode({
      ...node,
      params: { ...node.params, ...patch },
    } as WorkflowNode);
  };

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-3 pb-3 border-b border-slate-200">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-mono text-slate-500">{node.type} · {node.id}</span>
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={node.enabled}
              onChange={(e) => onUpdateNode({ ...node, enabled: e.target.checked })}
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            <span>启用此积木</span>
          </label>
        </div>

        <div>
          <label htmlFor="node-label-input" className="block text-xs font-medium text-slate-700 mb-1">
            积木显示名称
          </label>
          <input
            id="node-label-input"
            type="text"
            value={node.label}
            onChange={(e) => onUpdateNode({ ...node, label: e.target.value })}
            className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <div>
          <label htmlFor="node-depends-on" className="block text-xs font-medium text-slate-700 mb-1">
            前置依赖节点 ID（可选，逗号分隔，用于校验闭环与悬空引用）
          </label>
          <input
            id="node-depends-on"
            type="text"
            placeholder="例如: node_launch_1, node_scheme_2"
            value={(node.dependsOn ?? []).join(', ')}
            onChange={(e) => {
              const nextDeps = e.target.value
                .split(/[,，]/)
                .map((s) => s.trim())
                .filter(Boolean);
              onUpdateNode({
                ...node,
                dependsOn: nextDeps.length > 0 ? nextDeps : undefined,
              });
            }}
            className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
      </div>

      {node.type === 'launch_app' && (() => {
        const p = node.params as LaunchAppParams;
        return (
          <div className="space-y-3">
            <div>
              <label htmlFor="launch-pkg" className="block text-xs font-medium text-slate-700 mb-1">
                目标应用包名 (Package Name)
              </label>
              <input
                id="launch-pkg"
                type="text"
                value={p.packageName}
                onChange={(e) => updateParams({ packageName: e.target.value })}
                className="w-full px-3 py-1.5 text-sm font-mono bg-white border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="launch-wait" className="block text-xs font-medium text-slate-700 mb-1">
                启动等待时间 (ms)
              </label>
              <input
                id="launch-wait"
                type="number"
                min={500}
                step={200}
                value={p.waitMs}
                onChange={(e) => updateParams({ waitMs: Number(e.target.value) || 0 })}
                className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={p.verifyForeground}
                onChange={(e) => updateParams({ verifyForeground: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300 text-blue-600"
              />
              <span>校验前台包名一致（不一致时自动重试一次）</span>
            </label>
          </div>
        );
      })()}

      {node.type === 'scheme_jump' && (() => {
        const p = node.params as SchemeJumpParams;
        return (
          <div className="space-y-3">
            <div>
              <label htmlFor="scheme-tpl" className="block text-xs font-medium text-slate-700 mb-1">
                Scheme / URL 跳转模板
              </label>
              <textarea
                id="scheme-tpl"
                rows={3}
                value={p.schemeTemplate}
                onChange={(e) => updateParams({ schemeTemplate: e.target.value })}
                className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="scheme-wait" className="block text-xs font-medium text-slate-700 mb-1">
                  跳转后等待 (ms)
                </label>
                <input
                  id="scheme-wait"
                  type="number"
                  value={p.waitMs}
                  onChange={(e) => updateParams({ waitMs: Number(e.target.value) || 0 })}
                  className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="scheme-fallback" className="block text-xs font-medium text-slate-700 mb-1">
                  失败兜底包名
                </label>
                <input
                  id="scheme-fallback"
                  type="text"
                  value={p.fallbackPackage}
                  onChange={(e) => updateParams({ fallbackPackage: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={p.encodeParams}
                onChange={(e) => updateParams({ encodeParams: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300 text-blue-600"
              />
              <span>自动对查询参数执行 encodeURIComponent 编码</span>
            </label>
          </div>
        );
      })()}

      {node.type === 'back_check' && (() => {
        const p = node.params as BackCheckParams;
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="back-times" className="block text-xs font-medium text-slate-700 mb-1">
                  返回次数
                </label>
                <input
                  id="back-times"
                  type="number"
                  min={1}
                  max={5}
                  value={p.times}
                  onChange={(e) => updateParams({ times: Number(e.target.value) || 1 })}
                  className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="back-interval" className="block text-xs font-medium text-slate-700 mb-1">
                  返回间隔 (ms)
                </label>
                <input
                  id="back-interval"
                  type="number"
                  step={100}
                  value={p.intervalMs}
                  onChange={(e) => updateParams({ intervalMs: Number(e.target.value) || 500 })}
                  className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="back-expect" className="block text-xs font-medium text-slate-700 mb-1">
                  基准页校验关键词
                </label>
                <input
                  id="back-expect"
                  type="text"
                  value={p.expectKeyword}
                  onChange={(e) => updateParams({ expectKeyword: e.target.value })}
                  className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="back-ocr-engine" className="block text-xs font-medium text-slate-700 mb-1">
                  校验 OCR 引擎
                </label>
                <select
                  id="back-ocr-engine"
                  value={p.ocrEngine}
                  onChange={(e) => updateParams({ ocrEngine: e.target.value })}
                  className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md"
                >
                  <option value="paddle">paddle</option>
                  <option value="mlkit">mlkit</option>
                  <option value="tesseract">tesseract</option>
                </select>
              </div>
            </div>
          </div>
        );
      })()}

      {node.type === 'ocr_find' && (() => {
        const p = node.params as OcrFindParams;
        return (
          <div className="space-y-3">
            <PhoneRegionPreview mode="region" region={p.region} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="ocr-engine" className="block text-xs font-medium text-slate-700 mb-1">
                  OCR 引擎
                </label>
                <select
                  id="ocr-engine"
                  value={p.engine}
                  onChange={(e) => updateParams({ engine: e.target.value })}
                  className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md"
                >
                  <option value="paddle">paddle (默认)</option>
                  <option value="mlkit">mlkit</option>
                  <option value="tesseract">tesseract</option>
                </select>
              </div>
              <div>
                <label htmlFor="ocr-mode" className="block text-xs font-medium text-slate-700 mb-1">
                  匹配模式
                </label>
                <select
                  id="ocr-mode"
                  value={p.matchMode}
                  onChange={(e) => updateParams({ matchMode: e.target.value })}
                  className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md"
                >
                  <option value="contains">包含匹配 (contains)</option>
                  <option value="exact">精确匹配 (exact)</option>
                  <option value="regex">正则匹配 (regex)</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="ocr-candidates" className="block text-xs font-medium text-slate-700 mb-1">
                兜底候选词（逗号分隔，按优先级匹配）
              </label>
              <input
                id="ocr-candidates"
                type="text"
                value={p.candidates.join(', ')}
                onChange={(e) =>
                  updateParams({
                    candidates: e.target.value
                      .split(/[,，]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="ocr-varref" className="block text-xs font-medium text-slate-700 mb-1">
                绑定增强变量名 (优先读取编排期 LLM 注入)
              </label>
              <input
                id="ocr-varref"
                type="text"
                value={p.variableRef}
                onChange={(e) => updateParams({ variableRef: e.target.value })}
                className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
              />
            </div>
            <div className="grid grid-cols-4 gap-2">
              {(['x0', 'y0', 'x1', 'y1'] as const).map((coord) => (
                <div key={coord}>
                  <label htmlFor={`ocr-${coord}`} className="block text-[11px] font-mono text-slate-600 mb-1">
                    {coord}
                  </label>
                  <input
                    id={`ocr-${coord}`}
                    type="number"
                    step={0.02}
                    min={0}
                    max={1}
                    value={p.region[coord]}
                    onChange={(e) =>
                      updateParams({
                        region: { ...p.region, [coord]: Number(e.target.value) },
                      })
                    }
                    className="w-full px-2 py-1 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md"
                  />
                </div>
              ))}
            </div>
            <div>
              <label htmlFor="ocr-save-var" className="block text-xs font-medium text-slate-700 mb-1">
                命中结果保存变量名 (saveMatchVar)
              </label>
              <input
                id="ocr-save-var"
                type="text"
                value={p.saveMatchVar}
                onChange={(e) => updateParams({ saveMatchVar: e.target.value })}
                className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                id="ocr-optional"
                type="checkbox"
                checked={p.optional}
                onChange={(e) => updateParams({ optional: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300 text-blue-600"
              />
              <span>optional: true（未命中时不强制中断当前分支）</span>
            </label>
          </div>
        );
      })()}

      {node.type === 'click_target' && (() => {
        const p = node.params as ClickTargetParams;
        return (
          <div className="space-y-3">
            <PhoneRegionPreview
              mode="point"
              point={{
                xRatio: p.xRatio,
                yRatio: p.yRatio,
                offsetXRatio: p.offsetXRatio,
                offsetYRatio: p.offsetYRatio,
              }}
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="click-mode" className="block text-xs font-medium text-slate-700 mb-1">
                  点击模式
                </label>
                <select
                  id="click-mode"
                  value={p.mode}
                  onChange={(e) => updateParams({ mode: e.target.value })}
                  className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md"
                >
                  <option value="ocr_result">OCR 命中控件中心</option>
                  <option value="normalized_point">固定归一化坐标</option>
                </select>
              </div>
              <div>
                <label htmlFor="click-wait" className="block text-xs font-medium text-slate-700 mb-1">
                  点击后停留 (ms)
                </label>
                <input
                  id="click-wait"
                  type="number"
                  step={100}
                  value={p.waitAfterMs}
                  onChange={(e) => updateParams({ waitAfterMs: Number(e.target.value) || 0 })}
                  className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md"
                />
              </div>
            </div>
            {p.mode === 'normalized_point' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="click-x-ratio" className="block text-xs font-medium text-slate-700 mb-1">
                    xRatio (0–1)
                  </label>
                  <input
                    id="click-x-ratio"
                    type="number"
                    step={0.02}
                    min={0}
                    max={1}
                    value={p.xRatio}
                    onChange={(e) => updateParams({ xRatio: Number(e.target.value) })}
                    className="w-full px-3 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="click-y-ratio" className="block text-xs font-medium text-slate-700 mb-1">
                    yRatio (0–1)
                  </label>
                  <input
                    id="click-y-ratio"
                    type="number"
                    step={0.02}
                    min={0}
                    max={1}
                    value={p.yRatio}
                    onChange={(e) => updateParams({ yRatio: Number(e.target.value) })}
                    className="w-full px-3 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md"
                  />
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="click-ox" className="block text-xs font-medium text-slate-700 mb-1">
                  offsetXRatio
                </label>
                <input
                  id="click-ox"
                  type="number"
                  step={0.02}
                  min={-0.5}
                  max={0.5}
                  value={p.offsetXRatio}
                  onChange={(e) => updateParams({ offsetXRatio: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="click-oy" className="block text-xs font-medium text-slate-700 mb-1">
                  offsetYRatio
                </label>
                <input
                  id="click-oy"
                  type="number"
                  step={0.02}
                  min={-0.5}
                  max={0.5}
                  value={p.offsetYRatio}
                  onChange={(e) => updateParams({ offsetYRatio: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="click-retries" className="block text-xs font-medium text-slate-700 mb-1">
                  失败重试次数
                </label>
                <input
                  id="click-retries"
                  type="number"
                  min={0}
                  max={5}
                  value={p.maxRetries}
                  onChange={(e) => updateParams({ maxRetries: Number(e.target.value) || 0 })}
                  className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="click-var" className="block text-xs font-medium text-slate-700 mb-1">
                  OCR 目标变量
                </label>
                <input
                  id="click-var"
                  type="text"
                  value={p.targetVar}
                  onChange={(e) => updateParams({ targetVar: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                />
              </div>
            </div>
          </div>
        );
      })()}

      {node.type === 'swipe_wait' && (() => {
        const p = node.params as SwipeWaitParams;
        return (
          <div className="space-y-3">
            <PhoneRegionPreview
              mode="swipe"
              swipe={{
                x0Ratio: p.x0Ratio,
                y0Ratio: p.y0Ratio,
                x1Ratio: p.x1Ratio,
                y1Ratio: p.y1Ratio,
              }}
            />
            <div className="grid grid-cols-4 gap-2">
              {(['x0Ratio', 'y0Ratio', 'x1Ratio', 'y1Ratio'] as const).map((field) => (
                <div key={field}>
                  <label htmlFor={`swipe-${field}`} className="block text-[11px] font-mono text-slate-600 mb-1">
                    {field.replace('Ratio', '')}
                  </label>
                  <input
                    id={`swipe-${field}`}
                    type="number"
                    step={0.05}
                    min={0}
                    max={1}
                    value={p[field]}
                    onChange={(e) => updateParams({ [field]: Number(e.target.value) })}
                    className="w-full px-2 py-1 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md"
                  />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="swipe-dur" className="block text-xs font-medium text-slate-700 mb-1">
                  滑动时长 (ms)
                </label>
                <input
                  id="swipe-dur"
                  type="number"
                  step={50}
                  value={p.durationMs}
                  onChange={(e) => updateParams({ durationMs: Number(e.target.value) || 500 })}
                  className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="swipe-wait" className="block text-xs font-medium text-slate-700 mb-1">
                  安全等待 __safeSleep (ms)
                </label>
                <input
                  id="swipe-wait"
                  type="number"
                  step={500}
                  value={p.waitAfterMs}
                  onChange={(e) => updateParams({ waitAfterMs: Number(e.target.value) || 0 })}
                  className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                id="swipe-interruptible"
                type="checkbox"
                checked={p.interruptible}
                onChange={(e) => updateParams({ interruptible: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300 text-blue-600"
              />
              <span>允许全局/单轮超时看门狗打断等待 (__safeSleep)</span>
            </label>
          </div>
        );
      })()}

      {node.type === 'loop_block' && (() => {
        const p = node.params as LoopBlockParams;
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="loop-max" className="block text-xs font-medium text-slate-700 mb-1">
                  最大轮次 (maxIterations)
                </label>
                <input
                  id="loop-max"
                  type="number"
                  min={1}
                  max={500}
                  value={p.maxIterations}
                  onChange={(e) => updateParams({ maxIterations: Number(e.target.value) || 1 })}
                  className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="loop-miss" className="block text-xs font-medium text-slate-700 mb-1">
                  连续无命中退出阈值
                </label>
                <input
                  id="loop-miss"
                  type="number"
                  min={1}
                  max={20}
                  value={p.breakWhenMissStreak}
                  onChange={(e) => updateParams({ breakWhenMissStreak: Number(e.target.value) || 1 })}
                  className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="loop-timeout" className="block text-xs font-medium text-slate-700 mb-1">
                  单轮超时熔断 (ms)
                </label>
                <input
                  id="loop-timeout"
                  type="number"
                  step={1000}
                  value={p.perRoundTimeoutMs}
                  onChange={(e) => updateParams({ perRoundTimeoutMs: Number(e.target.value) || 10000 })}
                  className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="loop-recovery" className="block text-xs font-medium text-slate-700 mb-1">
                  超时恢复动作
                </label>
                <select
                  id="loop-recovery"
                  value={p.roundRecoveryAction}
                  onChange={(e) => updateParams({ roundRecoveryAction: e.target.value })}
                  className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md"
                >
                  <option value="back">back() 返回任务页</option>
                  <option value="relaunch">relaunch 重启应用</option>
                  <option value="skip">skip 跳过本轮</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="loop-miss-var" className="block text-xs font-medium text-slate-700 mb-1">
                连续无命中检测变量 (missVar)
              </label>
              <input
                id="loop-miss-var"
                type="text"
                value={p.missVar}
                onChange={(e) => updateParams({ missVar: e.target.value })}
                className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
              />
            </div>
          </div>
        );
      })()}

      {node.type === 'mcp_call' && (() => {
        const p = node.params as McpCallParams;
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="mcp-server" className="block text-xs font-medium text-slate-700 mb-1">
                  MCP 服务端
                </label>
                <select
                  id="mcp-server"
                  value={p.serverId}
                  onChange={(e) => updateParams({ serverId: e.target.value })}
                  className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md"
                >
                  <option value="autojs6">AutoJs6 MCP</option>
                  <option value="proxypin">ProxyPin MCP</option>
                </select>
              </div>
              <div>
                <label htmlFor="mcp-tool" className="block text-xs font-medium text-slate-700 mb-1">
                  工具名称 (tools/call)
                </label>
                <input
                  id="mcp-tool"
                  type="text"
                  value={p.toolName}
                  onChange={(e) => updateParams({ toolName: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="mcp-timeout" className="block text-xs font-medium text-slate-700 mb-1">
                  调用超时 (ms)
                </label>
                <input
                  id="mcp-timeout"
                  type="number"
                  step={500}
                  value={p.timeoutMs}
                  onChange={(e) => updateParams({ timeoutMs: Number(e.target.value) || 3000 })}
                  className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="mcp-save" className="block text-xs font-medium text-slate-700 mb-1">
                  结果保存变量
                </label>
                <input
                  id="mcp-save"
                  type="text"
                  value={p.saveAsVar}
                  onChange={(e) => updateParams({ saveAsVar: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={p.optional}
                onChange={(e) => updateParams({ optional: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300 text-blue-600"
              />
              <span>optional: true（MCP 离线或工具报错时优雅降级）</span>
            </label>
          </div>
        );
      })()}

      {node.type === 'llm_refine' && (() => {
        const p = node.params as LlmRefineParams;
        return (
          <div className="space-y-3">
            <div>
              <label htmlFor="llm-goal" className="block text-xs font-medium text-slate-700 mb-1">
                规则提炼目标 Prompt
              </label>
              <textarea
                id="llm-goal"
                rows={3}
                value={p.goal}
                onChange={(e) => updateParams({ goal: e.target.value })}
                className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="llm-fallback" className="block text-xs font-medium text-slate-700 mb-1">
                离线兜底关键词（无网络或无 MCP 时生效）
              </label>
              <input
                id="llm-fallback"
                type="text"
                value={p.fallbackKeywords.join(', ')}
                onChange={(e) =>
                  updateParams({
                    fallbackKeywords: e.target.value
                      .split(/[,，]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="llm-target-var" className="block text-xs font-medium text-slate-700 mb-1">
                  输出注入变量名 (targetVar)
                </label>
                <input
                  id="llm-target-var"
                  type="text"
                  value={p.targetVar}
                  onChange={(e) => updateParams({ targetVar: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label htmlFor="llm-timeout" className="block text-xs font-medium text-slate-700 mb-1">
                  推理超时 (ms)
                </label>
                <input
                  id="llm-timeout"
                  type="number"
                  step={500}
                  min={1000}
                  value={p.timeoutMs}
                  onChange={(e) => updateParams({ timeoutMs: Number(e.target.value) || 8000 })}
                  className="w-full px-3 py-1.5 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md"
                />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
