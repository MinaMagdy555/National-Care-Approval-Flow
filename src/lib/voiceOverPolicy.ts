import type { Task, User, VoiceOverProvider, WorkflowPhaseDefinition } from './types.js';

export const VOICE_OVER_PROVIDER_OPTIONS: Array<{ value: VoiceOverProvider; label: string }> = [
  { value: 'voice_over_shaza', label: 'Shaza' },
  { value: 'voice_over_ai', label: 'AI' },
];
type VoiceOverTaskFields = Pick<Task, 'workflowNodeAssigneeIds' | 'workflowNodeAIAssigneeIds' | 'workflowNodeVoiceOverDeliveryOwnerIds'>;
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\u064b-\u065f\u0670]/g, '')
  .replace(/[أإآ]/g, 'ا').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function isVoiceOverPhase(phase: WorkflowPhaseDefinition | null | undefined): boolean {
  if (!phase || (phase.nodeType || 'step') !== 'step') return false;
  return [phase.name, phase.id, ...(phase.responsibilityIds || [])].some(value => {
    const key = normalize(value || '');
    return /(?:^| )(?:voice over|voiceover|vo|فويس اوفر|فويس اوڤر|تعليق صوتي|التعليق الصوتي|اداء صوتي)(?: |$)/u.test(key);
  });
}

export function getUniqueShazaUser(users: User[]): User | null {
  const matches = users.filter(user => user.id !== 'guest' && /^(?:shaza|شذا|شذى|شذي)(?: |$)/u.test(normalize(user.name || '')));
  return matches.length === 1 ? matches[0] : null;
}

export function getVoiceOverProviderSelection(task: VoiceOverTaskFields, phase: WorkflowPhaseDefinition): string[] {
  return Object.prototype.hasOwnProperty.call(task.workflowNodeAssigneeIds || {}, phase.id)
    ? task.workflowNodeAssigneeIds?.[phase.id] || [] : phase.userIds || [];
}

export function getVoiceOverProvider(task: VoiceOverTaskFields, phase: WorkflowPhaseDefinition): VoiceOverProvider | null {
  const selected = getVoiceOverProviderSelection(task, phase);
  return selected.length === 1 && VOICE_OVER_PROVIDER_OPTIONS.some(option => option.value === selected[0]) ? selected[0] as VoiceOverProvider : null;
}

export function hasVoiceOverProviderSelection(task: VoiceOverTaskFields, phase: WorkflowPhaseDefinition): boolean {
  return getVoiceOverProviderSelection(task, phase).some(id => id.startsWith('voice_over_'));
}

function getConfiguredDeliveryOwner(task: VoiceOverTaskFields, phaseId: string, provider: VoiceOverProvider): string | undefined {
  if (Object.prototype.hasOwnProperty.call(task.workflowNodeVoiceOverDeliveryOwnerIds || {}, phaseId)) return task.workflowNodeVoiceOverDeliveryOwnerIds?.[phaseId];
  return provider === 'voice_over_ai' ? task.workflowNodeAIAssigneeIds?.[phaseId] : undefined;
}

export function getVoiceOverDeliveryOwnerId(task: VoiceOverTaskFields, phase: WorkflowPhaseDefinition, users: User[]): string | null {
  const provider = getVoiceOverProvider(task, phase);
  if (!provider) return null;
  const configured = getConfiguredDeliveryOwner(task, phase.id, provider);
  if (configured) return users.some(user => user.id === configured && user.id !== 'guest') ? configured : null;
  if (provider === 'voice_over_shaza') {
    const shaza = getUniqueShazaUser(users);
    if (shaza) return shaza.id;
  }
  return null;
}

export function validateVoiceOverAssignment(task: VoiceOverTaskFields, phase: WorkflowPhaseDefinition, users: User[]): { ok: boolean; message?: string } {
  const provider = getVoiceOverProvider(task, phase);
  if (!provider) return { ok: false, message: `Choose Shaza or AI for "${phase.name}".` };
  const configured = getConfiguredDeliveryOwner(task, phase.id, provider);
  const shaza = provider === 'voice_over_shaza' ? getUniqueShazaUser(users) : null;
  if (shaza && configured && configured !== shaza.id) return { ok: false, message: `"${phase.name}" is assigned to Shaza's account. Clear the different delivery owner.` };
  if (!getVoiceOverDeliveryOwnerId(task, phase, users)) return { ok: false, message: provider === 'voice_over_ai'
    ? `Select the person responsible for delivering the AI audio in "${phase.name}".`
    : `Select a delivery coordinator for external Shaza in "${phase.name}"; no unique Shaza account is available.` };
  return { ok: true };
}

type VoiceOverWorkflowTask = VoiceOverTaskFields & Pick<Task, 'workflowSnapshot' | 'workflowSkippedPhaseIds'>;

/** An unrelated edit/upload does not rewrite or invalidate an old provider assignment. */
export function validateVoiceOverTaskChanges(prior: VoiceOverWorkflowTask | undefined, next: VoiceOverWorkflowTask, users: User[]): { ok: boolean; message?: string } {
  for (const phase of next.workflowSnapshot?.phases || []) {
    if (!isVoiceOverPhase(phase) && !hasVoiceOverProviderSelection(next, phase)) continue;
    const oldPhase = prior?.workflowSnapshot?.phases.find(item => item.id === phase.id);
    const selection = getVoiceOverProviderSelection(next, phase);
    const changed = !prior || !oldPhase || JSON.stringify(selection) !== JSON.stringify(getVoiceOverProviderSelection(prior, oldPhase))
      || next.workflowNodeVoiceOverDeliveryOwnerIds?.[phase.id] !== prior.workflowNodeVoiceOverDeliveryOwnerIds?.[phase.id]
      || next.workflowNodeAIAssigneeIds?.[phase.id] !== prior.workflowNodeAIAssigneeIds?.[phase.id]
      || Boolean(prior.workflowSkippedPhaseIds?.includes(phase.id)) !== Boolean(next.workflowSkippedPhaseIds?.includes(phase.id));
    if (!changed) continue;
    const omitted = phase.disabled || next.workflowSkippedPhaseIds?.includes(phase.id);
    if (omitted) {
      if (selection.length && !getVoiceOverProvider(next, phase)) return { ok: false, message: `Choose Shaza or AI for "${phase.name}".` };
      const delivery = next.workflowNodeVoiceOverDeliveryOwnerIds?.[phase.id] || next.workflowNodeAIAssigneeIds?.[phase.id];
      if (delivery && !users.some(user => user.id === delivery && user.id !== 'guest')) return { ok: false, message: `Select a current member as delivery owner for "${phase.name}".` };
      continue;
    }
    const validation = validateVoiceOverAssignment(next, phase, users);
    if (!validation.ok) return validation;
  }
  return { ok: true };
}
