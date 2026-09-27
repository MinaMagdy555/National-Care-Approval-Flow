import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultWorkflows, mergeAppSettings } from '../src/lib/appSettings';
import { getWorkflowExecutionDefinition } from '../src/lib/workflowGraph';

test('stock approval outcome is explanatory only; legacy decisions and custom copy retain execution', () => {
  const seeded = defaultWorkflows[0];
  const outcome = seeded.phases.find(p => p.id === 'approved')!;
  assert.equal(outcome.nodeType, 'note');
  assert.equal(outcome.name, 'Art Director Review Outcome');
  assert.match(outcome.nodeNote!, /no extra approval action/);
  const legacy = structuredClone(seeded);
  const node = legacy.phases.find(p => p.id === 'approved')!;
  Object.assign(node, { name: 'Approved?', nodeType: 'step', phaseKind: 'final_review', isReviewDecision: true,
    parentPhaseIds: ['art_director_review'], passToPhaseId: 'ready_for_posting', failToPhaseId: 'final_creative', instructions: '', nodeNote: '' });
  const savedTaskSnapshot = structuredClone(legacy);
  const before = JSON.stringify(savedTaskSnapshot);
  const normalized = mergeAppSettings({ workflows: [legacy] }).workflows![0];
  const decision = normalized.phases.find(p => p.id === 'approved')!;
  assert.equal(decision.name, 'Art Director Decision');
  assert.match(decision.instructions!, /explicit Art Director decision/);
  assert.equal(decision.nodeType, 'step');
  assert.equal(decision.isReviewDecision, true);
  assert.equal(decision.passToPhaseId, node.passToPhaseId);
  assert.equal(decision.failToPhaseId, node.failToPhaseId);
  assert.equal(JSON.stringify(savedTaskSnapshot), before);
  assert.deepEqual(mergeAppSettings({ workflows: [normalized] }).workflows, [normalized]);
  node.name = 'Custom Approval Decision'; node.instructions = 'Keep my exact review contract'; node.nodeNote = 'Custom note';
  const custom = mergeAppSettings({ workflows: [legacy] }).workflows![0];
  const customNode = custom.phases.find(p => p.id === 'approved')!;
  assert.equal(customNode.name, node.name); assert.equal(customNode.instructions, node.instructions); assert.equal(customNode.nodeNote, node.nodeNote);
  assert.deepEqual(getWorkflowExecutionDefinition(custom).phases.find(p => p.id === 'approved')?.parentIds, ['art_director_review']);
});
