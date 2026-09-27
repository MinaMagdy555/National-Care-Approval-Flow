import test from 'node:test';
import assert from 'node:assert/strict';
import type { Task, User, WorkflowDefinition, WorkflowPhaseDefinition } from '../src/lib/types';
import { VOICE_OVER_PROVIDER_OPTIONS, getUniqueShazaUser, getVoiceOverDeliveryOwnerId, isVoiceOverPhase, validateVoiceOverAssignment } from '../src/lib/voiceOverPolicy';
import { mergeAppSettings } from '../src/lib/appSettings';
import { prepareWorkflowAssignmentOwners } from '../src/lib/workflowAssignment';
import { computePhaseHandoffs, computeWorkflowAdvance, resolveWorkflowPhaseOwnerIds } from '../src/lib/workflowRuntime';
import { canViewTask } from '../src/lib/taskPolicy';
import { findMemberDeletionBlockers } from '../src/lib/memberDeletion';
import { validateTaskWorkflowAssignment } from '../server/workflowAssignment';

const designer: User = { id: 'designer', name: 'Designer', role: 'team_member', jobTitle: 'Graphic Designer' };
const coordinator: User = { id: 'coordinator', name: 'Content', role: 'team_member', jobTitle: 'Content Creator' };
const shaza: User = { id: 'shaza', name: 'Shaza QA12', role: 'team_member', jobTitle: 'Voice Over' };
const senior: User = { id: 'senior', name: 'Reviewer', role: 'reviewer' };
const ad: User = { id: 'ad', name: 'Art Director', role: 'art_director' };
const users = [designer, coordinator, shaza, senior, ad];
const phase = (id: string, extra: Partial<WorkflowPhaseDefinition> = {}): WorkflowPhaseDefinition => ({ id, name: id, phaseKind: 'work', reviewStyle: 'first_review', mode: 'sequential', roleIds: [], responsibilityIds: [], userIds: [], ...extra });
const vo = phase('vo', { name: 'Record Voice Over', responsibilityIds: ['voice_over'], skipRule: 'manual', parentPhaseIds: ['work'] });
const workflow: WorkflowDefinition = { id: 'voice-flow', name: 'Voice Flow', active: true, taskTypeIds: ['voice flow'], phases: [
  phase('work', { parentPhaseIds: ['workflow-root'] }), vo,
  phase('first', { phaseKind: 'first_review', userIds: [senior.id], parentPhaseIds: ['vo'] }),
  phase('final', { phaseKind: 'final_review', roleIds: ['art_director'], userIds: [ad.id], parentPhaseIds: ['first'] }),
] };
const settings = mergeAppSettings({ workflows: [workflow], manualUsers: users });
const makeTask = (extra: Partial<Task> = {}): Task => ({ id: 'task', name: 'Voice task', code: 'VO-1', taskType: 'voice flow', status: 'assigned_work', createdBy: designer.id,
  workflowId: workflow.id, workflowSnapshot: workflow, workflowCurrentPhaseId: 'work', workflowActivePhaseIds: ['work'], workflowPhaseHistory: [], workflowPhaseApprovals: {},
  handledBy: [designer.id, coordinator.id], workContributorIds: [designer.id], versions: [], assignmentLinks: [], workflowNodeAssigneeIds: { vo: ['voice_over_ai'] },
  workflowNodeVoiceOverDeliveryOwnerIds: { vo: coordinator.id }, ...extra } as Task);

test('VO aliases cover English and Arabic while provider options remain exactly Shaza and AI', () => {
  assert.deepEqual(VOICE_OVER_PROVIDER_OPTIONS.map(option => option.label), ['Shaza', 'AI']);
  for (const name of ['Voice-over', 'Record Voice Over', 'Voiceover recording', 'فويس أوفر', 'تسجيل التعليق الصوتي', 'أداء صوتي']) assert.equal(isVoiceOverPhase(phase('custom', { name })), true, name);
  assert.equal(isVoiceOverPhase(phase('voice_over_optional')), true);
  assert.equal(isVoiceOverPhase(phase('custom', { responsibilityIds: ['voice_over'] })), true);
  assert.equal(isVoiceOverPhase(phase('design', { name: 'Video production', instructions: 'May include voice over.' })), false);
  assert.equal(isVoiceOverPhase({ ...vo, nodeType: 'note' }), false);
  for (const name of ['Shaza QA12', 'شذا أحمد', 'شذى أحمد', 'شذي أحمد']) assert.equal(getUniqueShazaUser([{ ...shaza, name }])?.id, shaza.id);
  assert.equal(getUniqueShazaUser([shaza, { ...shaza, id: 'duplicate' }]), null);
});

test('Shaza resolves a real account or explicit external coordinator; AI always has an explicit real delivery person', () => {
  const real = makeTask({ workflowNodeAssigneeIds: { vo: ['voice_over_shaza'] }, workflowNodeVoiceOverDeliveryOwnerIds: {} });
  assert.equal(getVoiceOverDeliveryOwnerId(real, vo, users), shaza.id);
  assert.equal(validateVoiceOverAssignment(real, vo, users).ok, true);
  const externalUsers = users.filter(user => user.id !== shaza.id);
  assert.equal(validateVoiceOverAssignment(real, vo, externalUsers).ok, false);
  assert.equal(getVoiceOverDeliveryOwnerId({ ...real, workflowNodeVoiceOverDeliveryOwnerIds: { vo: coordinator.id } }, vo, externalUsers), coordinator.id);
  const ai = makeTask({ workflowNodeVoiceOverDeliveryOwnerIds: {} });
  assert.equal(validateVoiceOverAssignment(ai, vo, users).ok, false);
  assert.equal(getVoiceOverDeliveryOwnerId({ ...ai, workflowNodeAIAssigneeIds: { vo: coordinator.id } }, vo, users), coordinator.id, 'legacy explicit AI owner remains readable');
  assert.equal(getVoiceOverDeliveryOwnerId({ ...ai, workflowNodeVoiceOverDeliveryOwnerIds: { vo: '' }, workflowNodeAIAssigneeIds: { vo: coordinator.id } }, vo, users), null, 'explicit empty new choice cannot revive stale AI owner');
  for (const selection of [['third-provider'], [designer.id], ['voice_over_ai', designer.id], ['voice_over_ai', 'voice_over_shaza']]) {
    assert.equal(validateVoiceOverAssignment({ ...real, workflowNodeAssigneeIds: { vo: selection } }, vo, users).ok, false);
  }
  assert.equal(validateVoiceOverAssignment({ ...ai, workflowNodeVoiceOverDeliveryOwnerIds: { vo: 'unknown' } }, vo, users).ok, false);
});

test('future delivery coordinator never inherits root work and only the real VO owner receives the handoff and can deliver', () => {
  for (const [provider, owner] of [['voice_over_ai', coordinator], ['voice_over_shaza', shaza]] as const) {
    const original = makeTask({ workflowNodeAssigneeIds: { vo: [provider] }, workflowNodeVoiceOverDeliveryOwnerIds: provider === 'voice_over_ai' ? { vo: coordinator.id } : {} });
    const prepared = prepareWorkflowAssignmentOwners(workflow, original, settings, users, original.workContributorIds);
    assert.equal(prepared.ok, true);
    let current = { ...original, workflowNodeAssigneeIds: prepared.workflowNodeAssigneeIds, workflowNodeVoiceOverDeliveryOwnerIds: prepared.workflowNodeVoiceOverDeliveryOwnerIds };
    assert.deepEqual(current.workflowNodeAssigneeIds?.work, [designer.id]);
    assert.equal(canViewTask(current, owner, settings, users), false);
    assert.equal(computeWorkflowAdvance(workflow, current, owner.id, 'vo', settings, users), null);
    const next = computeWorkflowAdvance(workflow, current, designer.id, 'work', settings, users)!;
    current = { ...current, workflowActivePhaseIds: next.nextActivePhaseIds, workflowCurrentPhaseId: 'vo', workflowPhaseApprovals: next.approvals, workflowPhaseHistory: next.history };
    assert.deepEqual(computePhaseHandoffs(workflow, current, ['vo'], settings, users).map(group => group.ownerIds), [[owner.id]]);
    assert.equal(canViewTask(current, owner, settings, users), true);
    assert.equal(computeWorkflowAdvance(workflow, current, designer.id, 'vo', settings, users), null);
    const delivered = computeWorkflowAdvance(workflow, { ...current, versions: [{ id: 'audio', submittedBy: owner.id, fileUrl: 'https://example.test/audio.mp3' } as never] }, owner.id, 'vo', settings, users)!;
    assert.deepEqual(delivered.nextActivePhaseIds, ['first']);
    assert.ok(delivered.history.some(entry => entry.phaseId === 'vo' && entry.action === 'completed' && entry.actorId === owner.id));
  }
});

test('deletion blockers track the real human on future VO work and preserve completed history', () => {
  const task = makeTask({ workflowNodeAssigneeIds: { work: [designer.id], vo: ['voice_over_ai'] } });
  const removed = [{ id: coordinator.id, name: coordinator.name, deletedAt: '2026-09-14T00:00:00Z', deletedBy: ad.id }];
  assert.equal(findMemberDeletionBlockers([task], removed, settings, users)[0]?.phaseName, vo.name);
  const finished = { ...task, workflowActivePhaseIds: ['first'], workflowPhaseHistory: [{ phaseId: 'vo', phaseName: vo.name, action: 'completed' as const, actorId: coordinator.id, createdAt: '2026-09-14T00:00:00Z' }] };
  assert.deepEqual(findMemberDeletionBlockers([finished], removed, settings, users), []);
});

test('server validates changed providers on existing snapshots but accepts untouched legacy uploads and omitted incomplete AI', () => {
  const existing = makeTask({ workflowNodeAssigneeIds: { work: [designer.id], vo: [coordinator.id] }, workflowNodeVoiceOverDeliveryOwnerIds: {} });
  assert.deepEqual(resolveWorkflowPhaseOwnerIds(vo, existing, settings, users), [coordinator.id]);
  assert.doesNotThrow(() => validateTaskWorkflowAssignment({ ...existing, description: 'Ordinary old-task edit' }, existing, settings, designer, users));
  for (const extra of [{ workflowNodeAssigneeIds: { work: [designer.id], vo: ['third-provider'] } },
    { workflowNodeAssigneeIds: { work: [designer.id], vo: ['voice_over_ai'] }, workflowNodeVoiceOverDeliveryOwnerIds: { vo: 'unknown' } }]) {
    assert.throws(() => validateTaskWorkflowAssignment({ ...existing, ...extra }, existing, settings, designer, users), /Shaza or AI|delivering/);
  }
  const omitted = makeTask({ workflowNodeAssigneeIds: { work: [designer.id], vo: ['voice_over_ai'] }, workflowNodeVoiceOverDeliveryOwnerIds: {}, workflowSkippedPhaseIds: ['vo'] });
  assert.equal(prepareWorkflowAssignmentOwners(workflow, omitted, settings, users).ok, true);
  assert.doesNotThrow(() => validateTaskWorkflowAssignment(omitted, undefined, settings, designer, users));
  assert.throws(() => validateTaskWorkflowAssignment({ ...omitted, workflowSkippedPhaseIds: [] }, omitted, settings, designer, users), /delivering/);
  assert.throws(() => validateTaskWorkflowAssignment({ ...omitted, workflowNodeAssigneeIds: { work: [designer.id], vo: ['third-provider'] } }, omitted, settings, designer, users), /Shaza or AI/);
});

test('replacing a VO workflow validates only replacement steps and allows cleared former provider IDs', () => {
  const existing = makeTask({ workflowNodeAssigneeIds: { work: [designer.id], vo: ['voice_over_ai'] } });
  const replacement: WorkflowDefinition = { ...workflow, id: 'design-flow', name: 'Design Flow', taskTypeIds: ['design flow'],
    phases: workflow.phases.filter(item => item.id !== 'vo').map(item => item.id === 'first' ? { ...item, parentPhaseIds: ['work'] } : item) };
  const nextSettings = mergeAppSettings({ workflows: [workflow, replacement], manualUsers: users });
  const updated: Task = { ...existing, taskType: 'design flow', workflowId: replacement.id, workflowSnapshot: replacement,
    workflowNodeAssigneeIds: { work: [designer.id] }, workflowNodeVoiceOverDeliveryOwnerIds: {}, workflowNodeAIAssigneeIds: {} };
  assert.equal(prepareWorkflowAssignmentOwners(replacement, updated, nextSettings, users, [designer.id]).ok, true);
  assert.doesNotThrow(() => validateTaskWorkflowAssignment(updated, existing, nextSettings, ad, users));
  assert.equal(resolveWorkflowPhaseOwnerIds(replacement.phases[0], updated, nextSettings, users)[0], designer.id);
});
