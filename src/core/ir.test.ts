import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultJDFinanceWorkflow,
  createEcommerceSignInWorkflow,
  validateWorkflowIR,
  type LoopBlockParams,
} from './ir';
import { compileWorkflowToAutoJs6 } from './codegen';

test('default workflow templates pass validateWorkflowIR with zero errors', () => {
  for (const wf of [createDefaultJDFinanceWorkflow(), createEcommerceSignInWorkflow()]) {
    const res = validateWorkflowIR(wf);
    assert.equal(res.valid, true);
    assert.equal(res.summary.errors, 0);
    assert.equal(res.summary.circularDependencies, 0);
    assert.equal(res.summary.danglingReferences, 0);
    assert.equal(res.summary.missingVariables, 0);
  }
});

test('detects circular dependencies in dependsOn, variable templates, duplicate IDs, and nested loop children without crashing codegen', () => {
  // 1. dependsOn cycle: A -> B -> A
  const wfDependsCycle = createDefaultJDFinanceWorkflow();
  wfDependsCycle.nodes[0].dependsOn = [wfDependsCycle.nodes[1].id];
  wfDependsCycle.nodes[1].dependsOn = [wfDependsCycle.nodes[0].id];

  const dependsRes = validateWorkflowIR(wfDependsCycle);
  assert.equal(dependsRes.valid, false);
  assert.ok(dependsRes.summary.circularDependencies >= 1);
  assert.ok(
    dependsRes.issues.some(
      (i) => i.category === 'circular_dependency' && i.field === 'dependsOn',
    ),
  );

  // 2. Variable template interpolation cycle
  const wfVarCycle = createDefaultJDFinanceWorkflow();
  wfVarCycle.variables.alpha = {
    key: 'alpha',
    value: '${beta}',
    fallbackValue: '',
    source: 'user',
  };
  wfVarCycle.variables.beta = {
    key: 'beta',
    value: '${alpha}',
    fallbackValue: '',
    source: 'user',
  };

  const varRes = validateWorkflowIR(wfVarCycle);
  assert.equal(varRes.valid, false);
  assert.ok(
    varRes.issues.some(
      (i) => i.category === 'circular_dependency' && i.field.startsWith('variables.'),
    ),
  );

  // 3. Self-nesting loop_block object cycle must be caught AND safely handled by compileWorkflowToAutoJs6
  const wfLoopCycle = createDefaultJDFinanceWorkflow();
  const loopNode = wfLoopCycle.nodes.find((n) => n.type === 'loop_block');
  assert.ok(loopNode && loopNode.type === 'loop_block');
  (loopNode.params as LoopBlockParams).children.push(loopNode);

  const loopRes = validateWorkflowIR(wfLoopCycle);
  assert.equal(loopRes.valid, false);
  assert.ok(
    loopRes.issues.some(
      (i) => i.category === 'circular_dependency' && i.field === 'children',
    ),
  );

  const compiledCyclic = compileWorkflowToAutoJs6(wfLoopCycle);
  assert.equal(compiledCyclic.validation.valid, false);
  assert.match(compiledCyclic.script, /Compilation Halted/);
  assert.match(compiledCyclic.irJson, /CircularNodeRef/);
});

test('detects dangling node references when upstream producers are disabled, missing, or dependsOn targets are invalid', () => {
  const wf = createDefaultJDFinanceWorkflow();
  const loopNode = wf.nodes.find((n) => n.type === 'loop_block');
  assert.ok(loopNode && loopNode.type === 'loop_block');

  // Disable OCR node inside loop -> click_target.targetVar & loop_block.missVar become dangling
  const ocrChild = loopNode.params.children.find((c) => c.id === 'node_ocr_6_1');
  assert.ok(ocrChild);
  ocrChild.enabled = false;

  // Add dangling dependsOn node reference
  wf.nodes[0].dependsOn = ['node_does_not_exist'];

  // Make an enabled non-optional MCP call point to a disabled binding
  const mcpNode = wf.nodes.find((n) => n.id === 'node_mcp_proxypin_4');
  assert.ok(mcpNode && mcpNode.type === 'mcp_call');
  mcpNode.params.optional = false;
  const ppBinding = wf.mcpBindings.find((b) => b.serverId === 'proxypin');
  assert.ok(ppBinding);
  ppBinding.enabled = false;

  const res = validateWorkflowIR(wf);
  assert.equal(res.valid, false);
  assert.ok(res.summary.danglingReferences >= 4);
  assert.ok(
    res.issues.some(
      (i) => i.category === 'dangling_reference' && i.nodeId === 'node_click_6_2' && i.field === 'targetVar',
    ),
  );
  assert.ok(
    res.issues.some(
      (i) => i.category === 'dangling_reference' && i.nodeId === 'node_loop_6' && i.field === 'missVar',
    ),
  );
  assert.ok(
    res.issues.some(
      (i) => i.category === 'dangling_reference' && i.nodeId === wf.nodes[0].id && i.field === 'dependsOn',
    ),
  );
  assert.ok(
    res.issues.some(
      (i) => i.category === 'dangling_reference' && i.nodeId === 'node_mcp_proxypin_4' && i.field === 'serverId',
    ),
  );
});

test('detects missing mandatory variables across metadata, templates, and required node fields', () => {
  const wf = createDefaultJDFinanceWorkflow();
  wf.meta.appPackage = '   ';

  const launchNode = wf.nodes.find((n) => n.type === 'launch_app');
  assert.ok(launchNode && launchNode.type === 'launch_app');
  launchNode.params.packageName = '';

  const schemeNode = wf.nodes.find((n) => n.type === 'scheme_jump');
  assert.ok(schemeNode && schemeNode.type === 'scheme_jump');
  schemeNode.params.schemeTemplate = 'jdmobile://share?url=${unregisteredVar}';

  const mcpNode = wf.nodes.find((n) => n.type === 'mcp_call');
  assert.ok(mcpNode && mcpNode.type === 'mcp_call');
  mcpNode.params.toolName = '';
  mcpNode.params.saveAsVar = '';

  const res = validateWorkflowIR(wf);
  assert.equal(res.valid, false);
  assert.ok(res.summary.missingVariables >= 5);
  assert.ok(res.issues.some((i) => i.category === 'missing_variable' && i.field === 'meta.appPackage'));
  assert.ok(res.issues.some((i) => i.category === 'missing_variable' && i.field === 'packageName'));
  assert.ok(res.issues.some((i) => i.category === 'missing_variable' && i.field === 'schemeTemplate'));
  assert.ok(res.issues.some((i) => i.category === 'missing_variable' && i.field === 'toolName'));
  assert.ok(res.issues.some((i) => i.category === 'missing_variable' && i.field === 'saveAsVar'));
});

test('isWorkflowIRShape validates malformed payloads and validateWorkflowIR handles circular variable values, invalid regex, and normalized_point bounds', async () => {
  const { isWorkflowIRShape } = await import('./ir');
  assert.equal(isWorkflowIRShape(null), false);
  assert.equal(isWorkflowIRShape({ nodes: [] }), false);

  const wf = createDefaultJDFinanceWorkflow();
  assert.equal(isWorkflowIRShape(wf), true);

  // Circular object in variable.value must not throw TypeError
  const cyclicObj: Record<string, unknown> = { note: 'loop' };
  cyclicObj.self = cyclicObj;
  wf.variables.cyclicMeta = {
    key: 'cyclicMeta',
    value: cyclicObj as unknown as string,
    fallbackValue: '',
    source: 'user',
  };

  const loopNode = wf.nodes.find((n) => n.type === 'loop_block');
  assert.ok(loopNode && loopNode.type === 'loop_block');
  const ocrChild = loopNode.params.children.find((c) => c.type === 'ocr_find');
  assert.ok(ocrChild && ocrChild.type === 'ocr_find');
  ocrChild.params.matchMode = 'regex';
  ocrChild.params.candidates = ['[unclosed-regex'];

  const clickChild = loopNode.params.children.find((c) => c.type === 'click_target');
  assert.ok(clickChild && clickChild.type === 'click_target');
  clickChild.params.mode = 'normalized_point';
  clickChild.params.xRatio = 1.4;
  clickChild.params.yRatio = -0.1;

  const res = validateWorkflowIR(wf);
  assert.equal(res.valid, false);
  assert.ok(res.issues.some((i) => i.field === 'candidates' && i.category === 'schema_policy'));
  assert.ok(res.issues.some((i) => i.field === 'xRatio' && i.category === 'schema_policy'));
});

