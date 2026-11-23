export type BlockCategory = 'navigation' | 'ocr_screen' | 'flow_watchdog' | 'mcp_llm';

export type NodeType =
  | 'launch_app'
  | 'scheme_jump'
  | 'back_check'
  | 'ocr_find'
  | 'click_target'
  | 'swipe_wait'
  | 'loop_block'
  | 'mcp_call'
  | 'llm_refine';

export interface NormalizedRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface LaunchAppParams {
  packageName: string;
  waitMs: number;
  verifyForeground: boolean;
}

export interface SchemeJumpParams {
  schemeTemplate: string;
  encodeParams: boolean;
  waitMs: number;
  fallbackPackage: string;
}

export interface BackCheckParams {
  times: number;
  intervalMs: number;
  expectKeyword: string;
  ocrEngine: 'paddle' | 'mlkit' | 'tesseract';
}

export interface OcrFindParams {
  engine: 'paddle' | 'mlkit' | 'tesseract';
  matchMode: 'exact' | 'contains' | 'regex';
  candidates: string[];
  variableRef: string;
  region: NormalizedRegion;
  saveMatchVar: string;
  optional: boolean;
}

export interface ClickTargetParams {
  mode: 'ocr_result' | 'normalized_point';
  targetVar: string;
  xRatio: number;
  yRatio: number;
  offsetXRatio: number;
  offsetYRatio: number;
  waitAfterMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

export interface SwipeWaitParams {
  x0Ratio: number;
  y0Ratio: number;
  x1Ratio: number;
  y1Ratio: number;
  durationMs: number;
  waitAfterMs: number;
  interruptible: boolean;
}

export interface LoopBlockParams {
  loopType: 'count' | 'while';
  maxIterations: number;
  conditionExpr: string;
  breakWhenMissStreak: number;
  missVar: string;
  perRoundTimeoutMs: number;
  roundRecoveryAction: 'back' | 'relaunch' | 'skip';
  children: WorkflowNode[];
}

export interface McpCallParams {
  serverId: 'autojs6' | 'proxypin';
  toolName: string;
  args: Record<string, unknown>;
  timeoutMs: number;
  optional: boolean;
  saveAsVar: string;
}

export interface LlmRefineParams {
  goal: string;
  targetVar: string;
  fallbackKeywords: string[];
  includeAutoJsState: boolean;
  includeRedactedTraffic: boolean;
  timeoutMs: number;
}

export type NodeParamsMap = {
  launch_app: LaunchAppParams;
  scheme_jump: SchemeJumpParams;
  back_check: BackCheckParams;
  ocr_find: OcrFindParams;
  click_target: ClickTargetParams;
  swipe_wait: SwipeWaitParams;
  loop_block: LoopBlockParams;
  mcp_call: McpCallParams;
  llm_refine: LlmRefineParams;
};

export type WorkflowNode = {
  [K in NodeType]: {
    id: string;
    type: K;
    label: string;
    enabled: boolean;
    note?: string;
    dependsOn?: string[];
    params: NodeParamsMap[K];
  };
}[NodeType];

export interface McpBindingConfig {
  serverId: 'autojs6' | 'proxypin';
  name: string;
  endpointUrl: string;
  transport: 'http-jsonrpc' | 'local-bridge';
  timeoutMs: number;
  enabled: boolean;
}

export interface WatchdogPolicy {
  globalTimeoutMs: number;
  defaultRoundTimeoutMs: number;
  globalRecoveryAction: 'home_and_exit' | 'back_to_app' | 'exit_only';
  ocrDefaultEngine: 'paddle' | 'mlkit' | 'tesseract';
  safeSleepSliceMs: number;
}

export interface WorkflowVariable {
  key: string;
  value: string | string[] | number | boolean;
  fallbackValue: string | string[] | number | boolean;
  source: 'user' | 'mcp_llm_compiled';
  description?: string;
}

export interface WorkflowIR {
  schemaVersion: '1.0.0';
  meta: {
    id: string;
    name: string;
    description: string;
    targetPlatform: 'android-autojs6';
    appPackage: string;
    updatedAt: string;
  };
  variables: Record<string, WorkflowVariable>;
  mcpBindings: McpBindingConfig[];
  policy: WatchdogPolicy;
  nodes: WorkflowNode[];
}

export type ValidationCategory =
  | 'circular_dependency'
  | 'dangling_reference'
  | 'missing_variable'
  | 'schema_policy'
  | 'security';

export interface ValidationIssue {
  level: 'error' | 'warning';
  category: ValidationCategory;
  nodeId?: string;
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  checkedAt: string;
  summary: {
    errors: number;
    warnings: number;
    circularDependencies: number;
    danglingReferences: number;
    missingVariables: number;
  };
  issues: ValidationIssue[];
}

export interface BlockCatalogItem {
  type: NodeType;
  category: BlockCategory;
  title: string;
  summary: string;
  defaultLabel: string;
}

export const BLOCK_CATALOG: BlockCatalogItem[] = [
  {
    type: 'launch_app',
    category: 'navigation',
    title: '启动应用',
    summary: '按包名启动目标 App 并校验前台状态',
    defaultLabel: '启动目标应用',
  },
  {
    type: 'scheme_jump',
    category: 'navigation',
    title: 'Scheme 跳转',
    summary: '构造带 encodeURI 参数的深度链接直达任务页',
    defaultLabel: 'Scheme 跳转活动页',
  },
  {
    type: 'back_check',
    category: 'navigation',
    title: '返回与页面校验',
    summary: '执行次数可控的返回并检查基准页关键词',
    defaultLabel: '返回并校验任务列表',
  },
  {
    type: 'ocr_find',
    category: 'ocr_screen',
    title: 'OCR 识字查找',
    summary: '基于归一化区域与多候选词优先级识字',
    defaultLabel: 'OCR 识别任务按钮',
  },
  {
    type: 'click_target',
    category: 'ocr_screen',
    title: '识字/比例点击',
    summary: '支持 offsetXRatio/offsetYRatio 偏移与失败重试',
    defaultLabel: '点击目标控件',
  },
  {
    type: 'swipe_wait',
    category: 'ocr_screen',
    title: '滑动与安全等待',
    summary: '归一化坐标滑动并执行可中断 __safeSleep',
    defaultLabel: '浏览滑动并等待',
  },
  {
    type: 'loop_block',
    category: 'flow_watchdog',
    title: '保护循环块',
    summary: '含连续无命中退出与单轮超时熔断恢复',
    defaultLabel: '任务执行保护循环',
  },
  {
    type: 'mcp_call',
    category: 'mcp_llm',
    title: 'MCP 工具调用',
    summary: '连接 AutoJs6 / ProxyPin MCP 读取状态或抓包',
    defaultLabel: '调用 MCP 读取上下文',
  },
  {
    type: 'llm_refine',
    category: 'mcp_llm',
    title: '大模型规则提炼',
    summary: '融合设备态与脱敏抓包数据生成关键词与分支',
    defaultLabel: 'LLM 提炼精准规则',
  },
];

export function createDefaultNode(type: NodeType, idSuffix: string): WorkflowNode {
  const id = `node_${type}_${idSuffix}`;
  switch (type) {
    case 'launch_app':
      return {
        id,
        type,
        label: '启动目标应用',
        enabled: true,
        params: {
          packageName: 'com.jd.jrapp',
          waitMs: 3500,
          verifyForeground: true,
        },
      };
    case 'scheme_jump':
      return {
        id,
        type,
        label: 'Scheme 跳转任务中心',
        enabled: true,
        params: {
          schemeTemplate:
            'jdmobile://share?jumpType=8&jumpUrl=https://u.jd.com/task-center?channel=daily',
          encodeParams: true,
          waitMs: 3000,
          fallbackPackage: 'com.jd.jrapp',
        },
      };
    case 'back_check':
      return {
        id,
        type,
        label: '返回任务主列表',
        enabled: true,
        params: {
          times: 1,
          intervalMs: 800,
          expectKeyword: '每日任务',
          ocrEngine: 'paddle',
        },
      };
    case 'ocr_find':
      return {
        id,
        type,
        label: 'OCR 查找可执行按钮',
        enabled: true,
        params: {
          engine: 'paddle',
          matchMode: 'contains',
          candidates: ['去完成', '去浏览', '立即签到', '领取奖励'],
          variableRef: 'refinedKeywords',
          region: { x0: 0.58, y0: 0.22, x1: 0.96, y1: 0.88 },
          saveMatchVar: 'matchedTaskBtn',
          optional: false,
        },
      };
    case 'click_target':
      return {
        id,
        type,
        label: '点击识别按钮中心',
        enabled: true,
        params: {
          mode: 'ocr_result',
          targetVar: 'matchedTaskBtn',
          xRatio: 0.5,
          yRatio: 0.5,
          offsetXRatio: 0.0,
          offsetYRatio: 0.0,
          waitAfterMs: 2200,
          maxRetries: 2,
          retryDelayMs: 600,
        },
      };
    case 'swipe_wait':
      return {
        id,
        type,
        label: '模拟浏览滑动并等待',
        enabled: true,
        params: {
          x0Ratio: 0.5,
          y0Ratio: 0.78,
          x1Ratio: 0.5,
          y1Ratio: 0.26,
          durationMs: 650,
          waitAfterMs: 8500,
          interruptible: true,
        },
      };
    case 'loop_block':
      return {
        id,
        type,
        label: '循环执行日常任务',
        enabled: true,
        params: {
          loopType: 'count',
          maxIterations: 12,
          conditionExpr: 'missStreak < 3',
          breakWhenMissStreak: 3,
          missVar: 'matchedTaskBtn',
          perRoundTimeoutMs: 25000,
          roundRecoveryAction: 'back',
          children: [],
        },
      };
    case 'mcp_call':
      return {
        id,
        type,
        label: 'MCP 读取页面与抓包上下文',
        enabled: true,
        params: {
          serverId: 'proxypin',
          toolName: 'list_http_flows',
          args: { domain: 'api.m.jd.com', limit: 10 },
          timeoutMs: 4000,
          optional: true,
          saveAsVar: 'proxypinFlows',
        },
      };
    case 'llm_refine':
      return {
        id,
        type,
        label: 'LLM 提炼精准动作关键词',
        enabled: true,
        params: {
          goal: '从设备当前控件树与脱敏后的任务接口响应中提炼高命中率按钮词与等待时长',
          targetVar: 'refinedKeywords',
          fallbackKeywords: ['去完成', '去浏览', '立即签到', '领金币'],
          includeAutoJsState: true,
          includeRedactedTraffic: true,
          timeoutMs: 8000,
        },
      };
  }
}

export function createDefaultJDFinanceWorkflow(): WorkflowIR {
  return {
    schemaVersion: '1.0.0',
    meta: {
      id: 'wf_jd_jr_daily_01',
      name: '京东金融日常任务自动化（双 MCP 增强）',
      description:
        '启动京东金融 -> Scheme 直达活动页 -> 双 MCP 采集与 LLM 规则注入 -> 带全局/单轮超时看门狗与连续无命中退出的任务循环。',
      targetPlatform: 'android-autojs6',
      appPackage: 'com.jd.jrapp',
      updatedAt: '2026-11-23T08:00:00.000Z',
    },
    variables: {
      refinedKeywords: {
        key: 'refinedKeywords',
        value: ['去签到', '去浏览15秒', '去完成', '领取奖励'],
        fallbackValue: ['去完成', '去浏览', '立即签到', '领金币'],
        source: 'mcp_llm_compiled',
        description: '编排期经 AutoJs6 + 脱敏 ProxyPin + LLM 提炼的按钮候选词（离线保留兜底）',
      },
      browseWaitMs: {
        key: 'browseWaitMs',
        value: 16000,
        fallbackValue: 15500,
        source: 'mcp_llm_compiled',
        description: '依据接口 browseSeconds=15 提炼的安全停留毫秒数',
      },
      targetJumpUrl: {
        key: 'targetJumpUrl',
        value: 'https://m.jr.jd.com/spe/qyy/main/index.html?channel=task',
        fallbackValue: 'https://m.jr.jd.com/spe/qyy/main/index.html',
        source: 'user',
        description: 'Scheme 跳转目标活动页 URL',
      },
    },
    mcpBindings: [
      {
        serverId: 'autojs6',
        name: 'AutoJs6 Device MCP',
        endpointUrl: 'http://127.0.0.1:9317/mcp',
        transport: 'local-bridge',
        timeoutMs: 4000,
        enabled: true,
      },
      {
        serverId: 'proxypin',
        name: 'ProxyPin Traffic MCP',
        endpointUrl: 'http://127.0.0.1:9318/mcp',
        transport: 'local-bridge',
        timeoutMs: 4000,
        enabled: true,
      },
    ],
    policy: {
      globalTimeoutMs: 180000,
      defaultRoundTimeoutMs: 28000,
      globalRecoveryAction: 'home_and_exit',
      ocrDefaultEngine: 'paddle',
      safeSleepSliceMs: 250,
    },
    nodes: [
      {
        id: 'node_launch_1',
        type: 'launch_app',
        label: '启动京东金融 App',
        enabled: true,
        params: {
          packageName: 'com.jd.jrapp',
          waitMs: 3500,
          verifyForeground: true,
        },
      },
      {
        id: 'node_scheme_2',
        type: 'scheme_jump',
        label: 'Scheme 跳转日常任务页',
        enabled: true,
        params: {
          schemeTemplate: 'jdmobile://share?jumpType=8&jumpUrl=${targetJumpUrl}',
          encodeParams: true,
          waitMs: 3200,
          fallbackPackage: 'com.jd.jrapp',
        },
      },
      {
        id: 'node_mcp_autojs_3',
        type: 'mcp_call',
        label: 'AutoJs6 MCP 读取屏幕状态',
        enabled: true,
        params: {
          serverId: 'autojs6',
          toolName: 'get_device_state',
          args: { includeUiTree: true, includeScreenMetrics: true },
          timeoutMs: 3500,
          optional: true,
          saveAsVar: 'deviceState',
        },
      },
      {
        id: 'node_mcp_proxypin_4',
        type: 'mcp_call',
        label: 'ProxyPin MCP 检索任务接口流量',
        enabled: true,
        params: {
          serverId: 'proxypin',
          toolName: 'list_http_flows',
          args: { domain: 'ms.jr.jd.com', statusCode: 200, limit: 12 },
          timeoutMs: 4000,
          optional: true,
          saveAsVar: 'proxypinFlows',
        },
      },
      {
        id: 'node_llm_refine_5',
        type: 'llm_refine',
        label: 'LLM 提炼高命中按钮词与等待策略',
        enabled: true,
        params: {
          goal: '结合 AutoJs6 页面控件与脱敏 ProxyPin 任务列表 JSON，提炼按钮文案优先级与最小浏览等待时间',
          targetVar: 'refinedKeywords',
          fallbackKeywords: ['去完成', '去浏览', '立即签到', '领金币'],
          includeAutoJsState: true,
          includeRedactedTraffic: true,
          timeoutMs: 8000,
        },
      },
      {
        id: 'node_loop_6',
        type: 'loop_block',
        label: '任务循环（连续 3 次无命中退出）',
        enabled: true,
        params: {
          loopType: 'count',
          maxIterations: 15,
          conditionExpr: 'missStreak < 3',
          breakWhenMissStreak: 3,
          missVar: 'matchedTaskBtn',
          perRoundTimeoutMs: 28000,
          roundRecoveryAction: 'back',
          children: [
            {
              id: 'node_ocr_6_1',
              type: 'ocr_find',
              label: 'PaddleOCR 右侧任务栏识字',
              enabled: true,
              params: {
                engine: 'paddle',
                matchMode: 'contains',
                candidates: ['去完成', '去浏览', '立即签到', '领取奖励'],
                variableRef: 'refinedKeywords',
                region: { x0: 0.62, y0: 0.24, x1: 0.96, y1: 0.88 },
                saveMatchVar: 'matchedTaskBtn',
                optional: true,
              },
            },
            {
              id: 'node_click_6_2',
              type: 'click_target',
              label: '点击命中的任务按钮',
              enabled: true,
              params: {
                mode: 'ocr_result',
                targetVar: 'matchedTaskBtn',
                xRatio: 0.5,
                yRatio: 0.5,
                offsetXRatio: 0.0,
                offsetYRatio: 0.0,
                waitAfterMs: 2500,
                maxRetries: 2,
                retryDelayMs: 500,
              },
            },
            {
              id: 'node_swipe_6_3',
              type: 'swipe_wait',
              label: '浏览页上滑并安全等待',
              enabled: true,
              params: {
                x0Ratio: 0.5,
                y0Ratio: 0.78,
                x1Ratio: 0.5,
                y1Ratio: 0.28,
                durationMs: 650,
                waitAfterMs: 16000,
                interruptible: true,
              },
            },
            {
              id: 'node_back_6_4',
              type: 'back_check',
              label: '返回并校验是否回到任务页',
              enabled: true,
              params: {
                times: 1,
                intervalMs: 900,
                expectKeyword: '做任务',
                ocrEngine: 'paddle',
              },
            },
          ],
        },
      },
    ],
  };
}

export function createEcommerceSignInWorkflow(): WorkflowIR {
  return {
    schemaVersion: '1.0.0',
    meta: {
      id: 'wf_signin_coupon_02',
      name: '电商会员签到领券（OCR + 偏移点击模板）',
      description: '单端离线可运行脚本模板，展示 PaddleOCR 多候选匹配与归一化区域偏移点击。',
      targetPlatform: 'android-autojs6',
      appPackage: 'com.achievo.vipshop',
      updatedAt: '2026-11-23T08:00:00.000Z',
    },
    variables: {
      refinedKeywords: {
        key: 'refinedKeywords',
        value: ['立即签到', '翻倍领取', '收下奖励'],
        fallbackValue: ['立即签到', '领取'],
        source: 'mcp_llm_compiled',
        description: '签到弹窗按钮候选词',
      },
    },
    mcpBindings: [
      {
        serverId: 'autojs6',
        name: 'AutoJs6 Device MCP',
        endpointUrl: 'http://127.0.0.1:9317/mcp',
        transport: 'local-bridge',
        timeoutMs: 4000,
        enabled: true,
      },
      {
        serverId: 'proxypin',
        name: 'ProxyPin Traffic MCP',
        endpointUrl: 'http://127.0.0.1:9318/mcp',
        transport: 'local-bridge',
        timeoutMs: 4000,
        enabled: false,
      },
    ],
    policy: {
      globalTimeoutMs: 90000,
      defaultRoundTimeoutMs: 20000,
      globalRecoveryAction: 'back_to_app',
      ocrDefaultEngine: 'paddle',
      safeSleepSliceMs: 250,
    },
    nodes: [
      {
        id: 'node_launch_s1',
        type: 'launch_app',
        label: '启动电商客户端',
        enabled: true,
        params: {
          packageName: 'com.achievo.vipshop',
          waitMs: 3200,
          verifyForeground: true,
        },
      },
      {
        id: 'node_ocr_s2',
        type: 'ocr_find',
        label: '中部弹窗识别签到按钮',
        enabled: true,
        params: {
          engine: 'paddle',
          matchMode: 'contains',
          candidates: ['立即签到', '翻倍领取'],
          variableRef: 'refinedKeywords',
          region: { x0: 0.15, y0: 0.35, x1: 0.85, y1: 0.82 },
          saveMatchVar: 'signInTarget',
          optional: false,
        },
      },
      {
        id: 'node_click_s3',
        type: 'click_target',
        label: '偏移点击签到按钮',
        enabled: true,
        params: {
          mode: 'ocr_result',
          targetVar: 'signInTarget',
          xRatio: 0.5,
          yRatio: 0.5,
          offsetXRatio: 0.0,
          offsetYRatio: 0.02,
          waitAfterMs: 1800,
          maxRetries: 3,
          retryDelayMs: 600,
        },
      },
    ],
  };
}

const SUSPICIOUS_SECRET_VALUE = /(AIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z]{16,}|ghp_[0-9A-Za-z]{20,}|Bearer\s+[A-Za-z0-9._-]{16,})/i;
const TEMPLATE_VAR_REGEX = /\$\{([a-zA-Z0-9_]+)\}/g;

function isVariablePopulated(variable: WorkflowVariable | undefined): boolean {
  if (!variable) return false;
  const hasVal = (v: unknown) => {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  };
  return hasVal(variable.value) || hasVal(variable.fallbackValue);
}

function extractTemplateVars(str: string): string[] {
  const vars: string[] = [];
  TEMPLATE_VAR_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TEMPLATE_VAR_REGEX.exec(str)) !== null) {
    if (match[1]) vars.push(match[1]);
  }
  return vars;
}

function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return (
      JSON.stringify(value, (_key, val) => {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[CircularRef]';
          seen.add(val);
        }
        return val;
      }) ?? ''
    );
  } catch {
    return String(value);
  }
}

export function isWorkflowIRShape(value: unknown): value is WorkflowIR {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (!obj.meta || typeof obj.meta !== 'object') return false;
  const meta = obj.meta as Record<string, unknown>;
  if (
    typeof meta.id !== 'string' ||
    typeof meta.name !== 'string' ||
    typeof meta.appPackage !== 'string'
  ) {
    return false;
  }
  if (!obj.policy || typeof obj.policy !== 'object') return false;
  const policy = obj.policy as Record<string, unknown>;
  if (typeof policy.globalTimeoutMs !== 'number' || !Number.isFinite(policy.globalTimeoutMs)) {
    return false;
  }
  if (!obj.variables || typeof obj.variables !== 'object' || Array.isArray(obj.variables)) {
    return false;
  }
  if (!Array.isArray(obj.mcpBindings) || !Array.isArray(obj.nodes)) {
    return false;
  }
  return true;
}

export function validateWorkflowIR(ir: WorkflowIR): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (ir.schemaVersion !== '1.0.0') {
    issues.push({
      level: 'error',
      category: 'schema_policy',
      field: 'schemaVersion',
      message: `不支持的 schemaVersion: ${ir.schemaVersion}`,
    });
  }

  if (!ir.meta.appPackage.trim()) {
    issues.push({
      level: 'error',
      category: 'missing_variable',
      field: 'meta.appPackage',
      message: '缺少必填元数据：目标应用包名（appPackage）不能为空。',
    });
  }

  if (ir.policy.globalTimeoutMs < 5000) {
    issues.push({
      level: 'error',
      category: 'schema_policy',
      field: 'policy.globalTimeoutMs',
      message: '全局超时看门狗必须至少为 5000ms。',
    });
  }

  if (ir.policy.defaultRoundTimeoutMs > ir.policy.globalTimeoutMs) {
    issues.push({
      level: 'warning',
      category: 'schema_policy',
      field: 'policy.defaultRoundTimeoutMs',
      message: '单轮默认超时不应超过全局运行超时阈值。',
    });
  }

  // 1. Security scan & variable template circular dependency detection
  const varGraph = new Map<string, string[]>();
  for (const [key, variable] of Object.entries(ir.variables)) {
    const serialized = safeJsonStringify(variable.value);
    if (SUSPICIOUS_SECRET_VALUE.test(serialized) || /token|secret|password|apikey/i.test(key)) {
      issues.push({
        level: 'error',
        category: 'security',
        field: `variables.${key}`,
        message: `变量 "${key}" 疑似包含敏感凭据或密钥，禁止写入工作流变量与导出脚本。`,
      });
    }
    const deps = new Set<string>();
    if (typeof variable.value === 'string') {
      extractTemplateVars(variable.value).forEach((d) => deps.add(d));
    }
    if (typeof variable.fallbackValue === 'string') {
      extractTemplateVars(variable.fallbackValue).forEach((d) => deps.add(d));
    }
    varGraph.set(key, Array.from(deps));
  }

  // DFS 3-color cycle detection for variable template references
  const varColor = new Map<string, 0 | 1 | 2>();
  const detectVarCycle = (vKey: string, stack: string[]) => {
    varColor.set(vKey, 1);
    for (const dep of varGraph.get(vKey) || []) {
      const c = varColor.get(dep) ?? 0;
      if (c === 1) {
        const cycleStart = stack.indexOf(dep);
        const cyclePath = [...stack.slice(cycleStart), dep].join(' -> ');
        issues.push({
          level: 'error',
          category: 'circular_dependency',
          field: `variables.${vKey}`,
          message: `检测到工作流变量模板循环依赖: ${cyclePath}`,
        });
      } else if (c === 0 && varGraph.has(dep)) {
        detectVarCycle(dep, [...stack, dep]);
      }
    }
    varColor.set(vKey, 2);
  };
  for (const vKey of varGraph.keys()) {
    if ((varColor.get(vKey) ?? 0) === 0) {
      detectVarCycle(vKey, [vKey]);
    }
  }

  // 2. Collect all node definitions (safe against cyclic object/ID loop nesting)
  const allNodesMap = new Map<string, WorkflowNode>();
  const activeNodesMap = new Map<string, WorkflowNode>();
  const ancestorObjects = new Set<object>();
  const ancestorIds = new Set<string>();

  const indexTree = (nodes: WorkflowNode[]) => {
    for (const node of nodes) {
      if (ancestorObjects.has(node) || ancestorIds.has(node.id)) {
        issues.push({
          level: 'error',
          category: 'circular_dependency',
          nodeId: node.id,
          field: 'children',
          message: `检测到积木节点嵌套循环引用：节点 "${node.label}" (${node.id}) 指向了自身或祖先节点。`,
        });
        continue;
      }

      if (allNodesMap.has(node.id)) {
        issues.push({
          level: 'error',
          category: 'circular_dependency',
          nodeId: node.id,
          field: 'id',
          message: `检测到重复的节点 ID "${node.id}"，可能导致执行图引用冲突。`,
        });
      } else {
        allNodesMap.set(node.id, node);
        if (node.enabled) activeNodesMap.set(node.id, node);
      }

      if (node.type === 'loop_block') {
        ancestorObjects.add(node);
        ancestorIds.add(node.id);
        indexTree((node.params as LoopBlockParams).children);
        ancestorIds.delete(node.id);
        ancestorObjects.delete(node);
      }
    }
  };
  indexTree(ir.nodes);

  // 3. Check explicit node.dependsOn for dangling references & directed cycles
  const nodeColor = new Map<string, 0 | 1 | 2>();
  const checkNodeDependsCycle = (nodeId: string, stack: string[]) => {
    nodeColor.set(nodeId, 1);
    const node = activeNodesMap.get(nodeId);
    for (const depId of node?.dependsOn || []) {
      if (!allNodesMap.has(depId)) {
        issues.push({
          level: 'error',
          category: 'dangling_reference',
          nodeId,
          field: 'dependsOn',
          message: `节点「${node?.label || nodeId}」存在悬空节点引用：前置依赖节点 "${depId}" 不存在。`,
        });
        continue;
      }
      if (!activeNodesMap.has(depId)) {
        issues.push({
          level: 'error',
          category: 'dangling_reference',
          nodeId,
          field: 'dependsOn',
          message: `节点「${node?.label || nodeId}」引用了已禁用的前置节点 "${depId}"。`,
        });
        continue;
      }
      const c = nodeColor.get(depId) ?? 0;
      if (c === 1) {
        const cycleStart = stack.indexOf(depId);
        const cyclePath = [...stack.slice(cycleStart), depId].join(' -> ');
        issues.push({
          level: 'error',
          category: 'circular_dependency',
          nodeId,
          field: 'dependsOn',
          message: `检测到积木节点依赖闭环 (Circular Dependency): ${cyclePath}`,
        });
      } else if (c === 0) {
        checkNodeDependsCycle(depId, [...stack, depId]);
      }
    }
    nodeColor.set(nodeId, 2);
  };
  for (const nodeId of activeNodesMap.keys()) {
    if ((nodeColor.get(nodeId) ?? 0) === 0) {
      checkNodeDependsCycle(nodeId, [nodeId]);
    }
  }

  // 4. Walk active execution flow to check dangling variable/MCP references & missing mandatory variables
  const visitedWalkObjects = new Set<object>();
  const availableRuntimeVars = new Set<string>();
  const producerGraph = new Map<string, string[]>(); // producedVar -> consumedVars (for data-flow cycle check)

  const walkNodes = (nodes: WorkflowNode[]) => {
    const producedInCurrentScope = new Set<string>();

    for (const node of nodes) {
      if (!node.enabled) continue;
      if (visitedWalkObjects.has(node)) continue;
      visitedWalkObjects.add(node);

      if (node.type === 'launch_app') {
        const p = node.params as LaunchAppParams;
        if (!p.packageName.trim()) {
          issues.push({
            level: 'error',
            category: 'missing_variable',
            nodeId: node.id,
            field: 'packageName',
            message: `节点「${node.label}」缺少必填参数：应用包名 (packageName)。`,
          });
        }
      }

      if (node.type === 'scheme_jump') {
        const p = node.params as SchemeJumpParams;
        if (!p.schemeTemplate.includes('://')) {
          issues.push({
            level: 'error',
            category: 'schema_policy',
            nodeId: node.id,
            field: 'schemeTemplate',
            message: `节点「${node.label}」Scheme 模板格式无效，需包含 "://"。`,
          });
        }
        for (const tplVar of extractTemplateVars(p.schemeTemplate)) {
          const irVar = ir.variables[tplVar];
          const isProduced = availableRuntimeVars.has(tplVar);
          if (!isProduced && !isVariablePopulated(irVar)) {
            issues.push({
              level: 'error',
              category: 'missing_variable',
              nodeId: node.id,
              field: 'schemeTemplate',
              message: `节点「${node.label}」引用了未定义或为空的必填模板变量 "\${${tplVar}}"。`,
            });
          }
        }
      }

      if (node.type === 'mcp_call') {
        const p = node.params as McpCallParams;
        if (!p.toolName.trim()) {
          issues.push({
            level: 'error',
            category: 'missing_variable',
            nodeId: node.id,
            field: 'toolName',
            message: `MCP 节点「${node.label}」缺少必填参数：toolName。`,
          });
        }
        if (!p.saveAsVar.trim()) {
          issues.push({
            level: 'error',
            category: 'missing_variable',
            nodeId: node.id,
            field: 'saveAsVar',
            message: `MCP 节点「${node.label}」缺少输出变量名 (saveAsVar)。`,
          });
        } else {
          availableRuntimeVars.add(p.saveAsVar.trim());
          producedInCurrentScope.add(p.saveAsVar.trim());
        }
        const binding = ir.mcpBindings.find((b) => b.serverId === p.serverId);
        if (!binding || !binding.enabled) {
          issues.push({
            level: p.optional ? 'warning' : 'error',
            category: 'dangling_reference',
            nodeId: node.id,
            field: 'serverId',
            message: `MCP 节点「${node.label}」引用的服务端 "${p.serverId}" 在 mcpBindings 中未启用或不存在。`,
          });
        }
      }

      if (node.type === 'llm_refine') {
        const p = node.params as LlmRefineParams;
        if (!p.goal.trim()) {
          issues.push({
            level: 'error',
            category: 'missing_variable',
            nodeId: node.id,
            field: 'goal',
            message: `节点「${node.label}」缺少必填的规则提炼目标 (goal)。`,
          });
        }
        if (!p.targetVar.trim()) {
          issues.push({
            level: 'error',
            category: 'missing_variable',
            nodeId: node.id,
            field: 'targetVar',
            message: `节点「${node.label}」缺少必填的输出变量名 (targetVar)。`,
          });
        } else {
          const target = p.targetVar.trim();
          availableRuntimeVars.add(target);
          producedInCurrentScope.add(target);
          if (!isVariablePopulated(ir.variables[target]) && p.fallbackKeywords.length === 0) {
            issues.push({
              level: 'error',
              category: 'missing_variable',
              nodeId: node.id,
              field: 'fallbackKeywords',
              message: `节点「${node.label}」的目标变量 "${target}" 尚未注入且未配置离线兜底关键词。`,
            });
          }
        }
      }

      if (node.type === 'ocr_find') {
        const p = node.params as OcrFindParams;
        const { x0, y0, x1, y1 } = p.region;
        if (x0 < 0 || y0 < 0 || x1 > 1 || y1 > 1 || x0 >= x1 || y0 >= y1) {
          issues.push({
            level: 'error',
            category: 'schema_policy',
            nodeId: node.id,
            field: 'region',
            message: `节点「${node.label}」归一化区域越界或无效（需满足 0 <= x0 < x1 <= 1 且 0 <= y0 < y1 <= 1）。`,
          });
        }
        const varRef = p.variableRef.trim();
        if (varRef) {
          const existsInIr = isVariablePopulated(ir.variables[varRef]);
          const existsUpstream = availableRuntimeVars.has(varRef);
          if (!existsInIr && !existsUpstream) {
            issues.push({
              level: p.candidates.length > 0 ? 'warning' : 'error',
              category: 'dangling_reference',
              nodeId: node.id,
              field: 'variableRef',
              message: `OCR 节点「${node.label}」引用的增强变量 "${varRef}" 未在工作流变量或上游节点中定义（悬空变量引用）。`,
            });
          }
          if (p.saveMatchVar.trim()) {
            const deps = producerGraph.get(p.saveMatchVar.trim()) || [];
            deps.push(varRef);
            producerGraph.set(p.saveMatchVar.trim(), deps);
          }
        }
        if (p.candidates.length === 0 && !varRef) {
          issues.push({
            level: 'error',
            category: 'missing_variable',
            nodeId: node.id,
            field: 'candidates',
            message: `节点「${node.label}」需至少配置一个候选词或引用增强变量。`,
          });
        }
        if (p.matchMode === 'regex') {
          for (const cand of p.candidates) {
            if (!cand) continue;
            try {
              new RegExp(cand);
            } catch {
              issues.push({
                level: 'error',
                category: 'schema_policy',
                nodeId: node.id,
                field: 'candidates',
                message: `OCR 节点「${node.label}」包含无效的正则表达式候选词: "${cand}"。`,
              });
            }
          }
        }
        if (!p.saveMatchVar.trim()) {
          issues.push({
            level: 'error',
            category: 'missing_variable',
            nodeId: node.id,
            field: 'saveMatchVar',
            message: `OCR 节点「${node.label}」缺少保存结果的变量名 (saveMatchVar)。`,
          });
        } else {
          availableRuntimeVars.add(p.saveMatchVar.trim());
          producedInCurrentScope.add(p.saveMatchVar.trim());
        }
      }

      if (node.type === 'click_target') {
        const p = node.params as ClickTargetParams;
        if (p.mode === 'ocr_result') {
          const targetVar = p.targetVar.trim();
          if (!targetVar) {
            issues.push({
              level: 'error',
              category: 'missing_variable',
              nodeId: node.id,
              field: 'targetVar',
              message: `点击节点「${node.label}」处于 OCR 模式但未指定目标变量 (targetVar)。`,
            });
          } else if (!availableRuntimeVars.has(targetVar) && !isVariablePopulated(ir.variables[targetVar])) {
            issues.push({
              level: 'error',
              category: 'dangling_reference',
              nodeId: node.id,
              field: 'targetVar',
              message: `点击节点「${node.label}」存在悬空引用：目标变量 "${targetVar}" 没有已启用的上游 OCR/MCP 产出节点。`,
            });
          }
        } else {
          if (
            !Number.isFinite(p.xRatio) ||
            !Number.isFinite(p.yRatio) ||
            p.xRatio < 0 ||
            p.xRatio > 1 ||
            p.yRatio < 0 ||
            p.yRatio > 1
          ) {
            issues.push({
              level: 'error',
              category: 'schema_policy',
              nodeId: node.id,
              field: 'xRatio',
              message: `点击节点「${node.label}」固定归一化坐标越界（需满足 0 <= xRatio, yRatio <= 1）。`,
            });
          }
        }
      }

      if (node.type === 'loop_block') {
        const p = node.params as LoopBlockParams;
        if (p.maxIterations < 1 || p.maxIterations > 500) {
          issues.push({
            level: 'warning',
            category: 'schema_policy',
            nodeId: node.id,
            field: 'maxIterations',
            message: `节点「${node.label}」最大循环次数建议在 1~500 之间。`,
          });
        }
        if (p.perRoundTimeoutMs > ir.policy.globalTimeoutMs) {
          issues.push({
            level: 'warning',
            category: 'schema_policy',
            nodeId: node.id,
            field: 'perRoundTimeoutMs',
            message: `节点「${node.label}」单轮超时 (${p.perRoundTimeoutMs}ms) 大于全局超时。`,
          });
        }
        if (p.children.length === 0) {
          issues.push({
            level: 'warning',
            category: 'schema_policy',
            nodeId: node.id,
            field: 'children',
            message: `循环节点「${node.label}」内部尚未编排子积木。`,
          });
        }

        const childProduced = walkNodes(p.children);
        const missVar = p.missVar.trim();
        if (p.breakWhenMissStreak > 0 && !missVar) {
          issues.push({
            level: 'error',
            category: 'missing_variable',
            nodeId: node.id,
            field: 'missVar',
            message: `循环节点「${node.label}」启用了连续无命中退出，但未指定检测变量 (missVar)。`,
          });
        } else if (missVar && p.children.length > 0 && !childProduced.has(missVar)) {
          issues.push({
            level: 'error',
            category: 'dangling_reference',
            nodeId: node.id,
            field: 'missVar',
            message: `循环节点「${node.label}」存在悬空引用：连续无命中检测变量 "${missVar}" 在循环内部没有任何已启用子积木产出。`,
          });
        }
      }
    }

    return producedInCurrentScope;
  };

  walkNodes(ir.nodes);

  // Check data-flow producer-consumer cycles
  const dataColor = new Map<string, 0 | 1 | 2>();
  const detectDataCycle = (v: string, stack: string[]) => {
    dataColor.set(v, 1);
    for (const dep of producerGraph.get(v) || []) {
      const c = dataColor.get(dep) ?? 0;
      if (c === 1) {
        const cycleStart = stack.indexOf(dep);
        issues.push({
          level: 'error',
          category: 'circular_dependency',
          field: `dataFlow.${v}`,
          message: `检测到变量读写循环依赖: ${[...stack.slice(cycleStart), dep].join(' -> ')}`,
        });
      } else if (c === 0 && producerGraph.has(dep)) {
        detectDataCycle(dep, [...stack, dep]);
      }
    }
    dataColor.set(v, 2);
  };
  for (const v of producerGraph.keys()) {
    if ((dataColor.get(v) ?? 0) === 0) {
      detectDataCycle(v, [v]);
    }
  }

  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.filter((i) => i.level === 'warning').length;

  return {
    valid: errors === 0,
    checkedAt: new Date().toISOString(),
    summary: {
      errors,
      warnings,
      circularDependencies: issues.filter((i) => i.category === 'circular_dependency').length,
      danglingReferences: issues.filter((i) => i.category === 'dangling_reference').length,
      missingVariables: issues.filter((i) => i.category === 'missing_variable').length,
    },
    issues,
  };
}
