import { useMemo, useState } from 'react';
import {
  createDefaultJDFinanceWorkflow,
  createEcommerceSignInWorkflow,
  createJDCouponCenterWorkflow,
  createJDMiaoshaBeansWorkflow,
  validateWorkflowIR,
  type WorkflowIR,
} from './core/ir';
import { compileWorkflowToAutoJs6, type ApiContractEndpoint } from './core/codegen';
import { TopBar, type StudioTab } from './components/TopBar';
import { WorkflowWorkspace, type WorkflowTemplateId } from './components/WorkflowWorkspace';
import { McpTrafficStudio } from './components/McpTrafficStudio';
import { CodeExportView } from './components/CodeExportView';
import { NativeArchitectureView } from './components/NativeArchitectureView';

export default function App() {
  const [activeTab, setActiveTab] = useState<StudioTab>('canvas');
  const [workflow, setWorkflow] = useState<WorkflowIR>(() => createDefaultJDFinanceWorkflow());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('node_ocr_6_1');
  const [validationTrigger, setValidationTrigger] = useState(0);
  const [handledValidationTrigger, setHandledValidationTrigger] = useState(0);
  const [apiContractEndpoints, setApiContractEndpoints] = useState<ApiContractEndpoint[]>([
    {
      domain: 'ms.jr.jd.com',
      path: '/gw/generic/hy/h5/m/queryTaskList',
      method: 'POST',
      statusCode: 200,
      extractedHints: ['buttonText=去签到|去浏览15秒|领取奖励', 'browseSeconds=15'],
    },
  ]);

  const compiled = useMemo(
    () => compileWorkflowToAutoJs6(workflow, apiContractEndpoints),
    [workflow, apiContractEndpoints],
  );

  const handleLoadTemplate = (templateId: WorkflowTemplateId) => {
    const next =
      templateId === 'jd'
        ? createDefaultJDFinanceWorkflow()
        : templateId === 'miaosha'
          ? createJDMiaoshaBeansWorkflow()
          : templateId === 'coupon'
            ? createJDCouponCenterWorkflow()
            : createEcommerceSignInWorkflow();
    setWorkflow(next);
    setSelectedNodeId(next.nodes[0]?.id ?? null);
  };

  const handleDownloadFile = (filename: string, content: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportPrimaryScript = () => {
    const check = validateWorkflowIR(workflow);
    if (!check.valid) {
      setActiveTab('canvas');
      setValidationTrigger((c) => c + 1);
      const firstErrNode = check.issues.find((i) => i.level === 'error' && i.nodeId)?.nodeId;
      if (firstErrNode) {
        setSelectedNodeId(firstErrNode);
      }
      return;
    }
    handleDownloadFile(
      `${workflow.meta.id}.autojs6.js`,
      compiled.script,
      'application/javascript;charset=utf-8',
    );
  };

  const handleInjectRefinedVariables = (
    keywords: string[],
    browseWaitMs: number,
    endpoints: ApiContractEndpoint[],
  ) => {
    setWorkflow((prev) => ({
      ...prev,
      meta: { ...prev.meta, updatedAt: new Date().toISOString() },
      variables: {
        ...prev.variables,
        refinedKeywords: {
          key: 'refinedKeywords',
          value: keywords,
          fallbackValue: prev.variables.refinedKeywords?.fallbackValue ?? ['去完成', '去浏览', '立即签到'],
          source: 'mcp_llm_compiled',
          description: '经 MCP + 规则/LLM 提炼注入的高命中按钮词（含离线兜底）',
        },
        browseWaitMs: {
          key: 'browseWaitMs',
          value: browseWaitMs,
          fallbackValue: prev.variables.browseWaitMs?.fallbackValue ?? 15500,
          source: 'mcp_llm_compiled',
          description: '经 ProxyPin 流量提炼的建议浏览等待毫秒数',
        },
      },
    }));
    if (endpoints.length > 0) {
      setApiContractEndpoints(endpoints);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-slate-50 text-slate-900">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onExportScript={handleExportPrimaryScript}
      />

      {activeTab === 'canvas' && (
        <WorkflowWorkspace
          workflow={workflow}
          compiled={compiled}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          onChangeWorkflow={setWorkflow}
          onLoadTemplate={handleLoadTemplate}
          validationTrigger={validationTrigger}
          handledValidationTrigger={handledValidationTrigger}
          onValidationHandled={setHandledValidationTrigger}
        />
      )}

      {activeTab === 'mcp' && (
        <McpTrafficStudio
          workflow={workflow}
          onInjectRefinedVariables={handleInjectRefinedVariables}
        />
      )}

      {activeTab === 'export' && (
        <CodeExportView
          workflow={workflow}
          compiled={compiled}
          onDownloadFile={handleDownloadFile}
        />
      )}

      {activeTab === 'architecture' && <NativeArchitectureView />}
    </div>
  );
}
