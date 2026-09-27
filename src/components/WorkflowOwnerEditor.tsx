import { getVoiceOverProvider, getUniqueShazaUser, isVoiceOverPhase } from '../lib/voiceOverPolicy';
import React, { useEffect, useState } from 'react';
import type { Task } from '../lib/types';
import { useAppStore } from '../lib/store';
import { getCompletedPhaseIdsFromHistory } from '../lib/workflowRuntime';
import { isMandatoryFinalReview, resolveWorkflowPhaseOwnerIds } from '../lib/workflowUtils';
import { UserMultiSelect } from './UserMultiSelect';

export function WorkflowOwnerEditor({ task }: { task: Task }) {
  const { appSettings, userList, updateWorkflowPhaseAssignees } = useAppStore();
  const completed = getCompletedPhaseIdsFromHistory(task.workflowPhaseHistory || []);
  const phases = task.workflowSnapshot?.phases.filter(phase => (phase.nodeType || 'step') === 'step' && !completed.has(phase.id)) || [];
  const [selectedId, setSelectedId] = useState(task.workflowCurrentPhaseId || phases[0]?.id || '');
  const phase = phases.find(phase => phase.id === selectedId) || phases[0];
  const owners = phase ? resolveWorkflowPhaseOwnerIds(phase, task, appSettings, userList) : [];
  const [selectedOwners, setSelectedOwners] = useState(owners);
  const ownerKey = owners.join('|');
  useEffect(() => setSelectedOwners(owners), [task.id, phase?.id, ownerKey]);
  if (!phase) return null;
  const fixed = isMandatoryFinalReview(phase);
  const voice = isVoiceOverPhase(phase);
  const shaza = voice && getVoiceOverProvider(task, phase) === 'voice_over_shaza' ? getUniqueShazaUser(userList) : null;
  return <div className="space-y-2 border-t border-slate-100 pt-3">
    <label className="block text-xs font-bold text-slate-600" htmlFor="workflow-owner-step">Workflow step to reassign</label>
    <select id="workflow-owner-step" value={phase.id} onChange={event => setSelectedId(event.target.value)} className="w-full rounded-lg border border-slate-200 p-2 text-xs">
      {phases.map(item => <option key={item.id} value={item.id}>{item.name} · {(task.workflowActivePhaseIds || [task.workflowCurrentPhaseId]).includes(item.id) ? 'Active' : 'Future'}</option>)}
    </select>
    {shaza ? <p className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs">Shaza delivers this provider selection. To change between Shaza and AI, edit the task assignment.</p> : fixed ? <p role="status" aria-label={`${phase.name} fixed Art Director`} className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs">Fixed approver: {owners.map(id => userList.find(user => user.id === id)?.name || 'Unavailable member').join(', ') || 'Art Director configuration required'}. Final Review cannot be reassigned.</p> : <>
      <UserMultiSelect users={userList.filter(user => user.id !== 'guest')} selectedIds={selectedOwners} onChange={ids => setSelectedOwners(voice ? ids.slice(-1) : ids)} layout="single" />
      <button type="button" onClick={() => updateWorkflowPhaseAssignees(task.id, phase.id, selectedOwners)} disabled={selectedOwners.length < (phase.requiredApprovals || 1) || selectedOwners.join('|') === ownerKey} className="w-full rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 disabled:opacity-40">Save Step Owners</button>
    </>}
  </div>;
}
