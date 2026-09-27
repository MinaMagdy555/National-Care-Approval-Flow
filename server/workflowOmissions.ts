import type { AppSettings, Task, User } from '../src/lib/types';
import { reconcileWorkflowOmissions, validateWorkflowOmissionSelection } from '../src/lib/workflowOmissions';
import { computeWorkflowAdvance } from '../src/lib/workflowRuntime';
import { getWorkflowExecutionDefinition } from '../src/lib/workflowGraph';
import { ReportAccessError } from './reportAccess';

const sorted = (ids: string[] = []) => JSON.stringify([...new Set(ids)].sort());
const approvalsShape = (task: Task) => JSON.stringify(Object.entries(task.workflowPhaseApprovals || {}).filter(([, ids]) => ids.length).sort(([a], [b]) => a.localeCompare(b)).map(([id, ids]) => [id, sorted(ids)]));
export function validateTaskWorkflowOmissions(prior: Task | undefined, task: Task, actor: User, settings: AppSettings, users: User[], now = new Date()) {
  const sameWorkflow = prior?.workflowSnapshot && task.workflowSnapshot
    && JSON.stringify(getWorkflowExecutionDefinition(prior.workflowSnapshot)) === JSON.stringify(getWorkflowExecutionDefinition(task.workflowSnapshot));
  if (!prior || !sameWorkflow) {
    const validation = validateWorkflowOmissionSelection(task, task.workflowSkippedPhaseIds || [], actor, settings, users);
    if (!validation.ok) throw new ReportAccessError(validation.message!);
    return;
  }
  const changed = sorted(prior.workflowSkippedPhaseIds) !== sorted(task.workflowSkippedPhaseIds);
  if (changed) {
    const result = reconcileWorkflowOmissions(prior, task, actor, settings, users, now);
    if (!result.ok) throw new ReportAccessError(result.message!);
    const expected = result.task!;
    const historyShape = (value: Task) => (value.workflowPhaseHistory || []).slice((prior.workflowPhaseHistory || []).length).map(entry => [entry.phaseId, entry.action, entry.actorId]);
    // Reconciliation uses the canonical pre-edit progress; incoming audit cannot turn an omission into approval.
    if (sorted(expected.workflowActivePhaseIds) !== sorted(task.workflowActivePhaseIds)
      || approvalsShape(expected) !== approvalsShape(task)
      || JSON.stringify(historyShape(expected)) !== JSON.stringify(historyShape(task))
      || (prior.status === 'on_hold' && task.status !== 'on_hold')
      || (prior.status.startsWith('changes_requested') && task.status !== prior.status)) {
      throw new ReportAccessError('Apply removed steps through the workflow routing action before saving.');
    }
    return;
  }
  const addedSkips = (task.workflowPhaseHistory || []).slice((prior.workflowPhaseHistory || []).length).filter(entry => entry.action === 'skipped');
  if (!addedSkips.length) return;
  // A normal owner may cause configured automatic skips only through their real active-step completion.
  const active = prior.workflowActivePhaseIds ?? (prior.workflowCurrentPhaseId ? [prior.workflowCurrentPhaseId] : []);
  const allowed = active.some(phaseId => {
    const advanced = computeWorkflowAdvance(prior.workflowSnapshot!, { ...prior, versions: task.versions, assignmentLinks: task.assignmentLinks }, actor.id, phaseId, settings, users);
    if (!advanced?.phaseCompleted) return false;
    const generated = advanced.history.slice((prior.workflowPhaseHistory || []).length).filter(entry => entry.action === 'skipped');
    const actualCompletion = (task.workflowPhaseHistory || []).slice((prior.workflowPhaseHistory || []).length).some(entry => entry.phaseId === phaseId && entry.action === 'completed' && entry.actorId === actor.id);
    return actualCompletion && sorted(generated.map(entry => entry.phaseId)) === sorted(addedSkips.map(entry => entry.phaseId));
  });
  if (!allowed) throw new ReportAccessError('Workflow steps cannot be manually skipped without an authorized omission change.');
}
