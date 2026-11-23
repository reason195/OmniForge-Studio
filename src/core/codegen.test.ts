import test from 'node:test';
import assert from 'node:assert/strict';
import { compileWorkflowToAutoJs6 } from './codegen';
import { createDefaultJDFinanceWorkflow, validateWorkflowIR } from './ir';

test('default JD Finance workflow passes IR validation and compiles self-contained AutoJs6 script', () => {
  const wf = createDefaultJDFinanceWorkflow();
  const validation = validateWorkflowIR(wf);
  assert.equal(validation.valid, true);

  const result = compileWorkflowToAutoJs6(wf);
  assert.equal(result.stats.secretScanPassed, true);
  assert.equal(result.stats.disabledNodes, 0);
  assert.match(result.script, /GLOBAL_TIMEOUT_MS: 180000/);
  assert.match(result.script, /function __safeSleep\(/);
  assert.match(result.script, /function __normRegion\(/);
  assert.match(result.script, /function __checkRoundTimeout\(/);
  assert.match(result.script, /__missStreak_node_loop_6 >= 3/);
  assert.match(result.script, /"refinedKeywords"/);
  assert.match(result.script, /"fallback": \[/);
});

test('disabled nodes are commented out instead of compiled into active execution', () => {
  const wf = createDefaultJDFinanceWorkflow();
  wf.nodes[1].enabled = false; // disable scheme_jump

  const result = compileWorkflowToAutoJs6(wf);
  assert.equal(result.stats.disabledNodes, 1);
  assert.match(result.script, /\[已禁用积木\] Scheme 跳转日常任务页/);
  assert.doesNotMatch(result.script, /__jumpScheme\("jdmobile:\/\/share/);
});

test('validateWorkflowIR rejects invalid normalized region and suspicious secret variable', () => {
  const wf = createDefaultJDFinanceWorkflow();
  wf.variables.mcpToken = {
    key: 'mcpToken',
    value: 'sk-1234567890abcdef123456',
    fallbackValue: '',
    source: 'user',
  };
  const loopNode = wf.nodes.find((n) => n.type === 'loop_block');
  if (loopNode && loopNode.type === 'loop_block') {
    const ocrNode = loopNode.params.children.find((c) => c.type === 'ocr_find');
    if (ocrNode && ocrNode.type === 'ocr_find') {
      ocrNode.params.region = { x0: 0.9, y0: 0.2, x1: 0.4, y1: 0.8 };
    }
  }

  const validation = validateWorkflowIR(wf);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((i) => i.field === 'variables.mcpToken'));
  assert.ok(validation.issues.some((i) => i.field === 'region'));
});

test('loop_block emits real appPackage in __recoverRound and breaks early when non-optional OCR misses', () => {
  const wf = createDefaultJDFinanceWorkflow();
  const loopNode = wf.nodes.find((n) => n.type === 'loop_block');
  assert.ok(loopNode && loopNode.type === 'loop_block');
  loopNode.params.roundRecoveryAction = 'relaunch';
  const ocrChild = loopNode.params.children.find((c) => c.id === 'node_ocr_6_1');
  assert.ok(ocrChild && ocrChild.type === 'ocr_find');
  ocrChild.params.optional = false;

  const result = compileWorkflowToAutoJs6(wf);
  assert.equal(result.validation.valid, true);
  assert.doesNotMatch(result.script, /__APP_PKG__/);
  assert.match(result.script, /__recoverRound\("relaunch", "com\.jd\.jrapp"\);/);
  assert.match(result.script, /__missStreak_node_loop_6 \+= 1;[\s\S]*if \(__missStreak_node_loop_6 >= 3\)[\s\S]*break;[\s\S]*continue;/);
});

test('escaping and comment sanitization prevent syntax breakouts while invalid IR halts codegen', () => {
  const wf = createDefaultJDFinanceWorkflow();
  wf.meta.name = '恶意见证 */\nconsole.log("pwned"); /*';
  wf.nodes[0].label = '启动 "App" \\ */ \n alert(1)';

  const validRes = compileWorkflowToAutoJs6(wf);
  assert.equal(validRes.validation.valid, true);
  assert.doesNotMatch(validRes.script, /^\s*console\.log\("pwned"\)/m);
  assert.doesNotMatch(validRes.script, /^\s*alert\(1\)/m);
  assert.match(validRes.script, /\* 工作流: 恶意见证 \* \/ console\.log\("pwned"\);/);
  // Ensure generated JS parses with zero syntax errors
  assert.doesNotThrow(() => new Function(validRes.script));

  // Dangling reference must halt active code generation (not only circular dependencies)
  const loopNode = wf.nodes.find((n) => n.type === 'loop_block');
  assert.ok(loopNode && loopNode.type === 'loop_block');
  loopNode.params.children[0].enabled = false;
  const invalidRes = compileWorkflowToAutoJs6(wf);
  assert.equal(invalidRes.validation.valid, false);
  assert.match(invalidRes.script, /Compilation Halted/);
  assert.doesNotMatch(invalidRes.script, /__launchApp\("com\.jd\.jrapp"/);
});

