import type { AppSettings, Task, User, WorkflowDefinition, WorkflowPhaseHistoryEntry } from '../src/lib/types.js';
import { resolveTaskFinalArtDirector } from '../src/lib/finalApprovalPolicy.js';
import { getValidatedFinalApproverMap } from './workflowAssignment.js';
import { canManageWorkflowBuilder, CLOSED_STATUSES, RETURNED_STATUSES, getCurrentOwnerUserIds, getStatusForWorkflowPhase, isMandatoryFinalReview, isPhaseAvailable } from '../src/lib/workflowUtils.js';
import { computeWorkflowAdvance, computeWorkflowInitialization, computeWorkflowReturn, getCompletedPhaseIdsFromHistory } from '../src/lib/workflowRuntime.js';
import { getWorkflowExecutionDefinition, getWorkflowSuccessors } from '../src/lib/workflowGraph.js';
import { reconcileWorkflowOmissions } from '../src/lib/workflowOmissions.js';
import { ReportAccessError } from './reportAccess.js';
import { normalizeReviewPhase } from '../src/lib/reviewPolicy.js';

const ids = (value: string[] = []) => JSON.stringify([...new Set(value)].sort());
const active = (task: Task) => task.workflowActivePhaseIds ?? (task.workflowCurrentPhaseId ? [task.workflowCurrentPhaseId] : []);
const approvals = (task: Task) => JSON.stringify(Object.entries(task.workflowPhaseApprovals || {}).filter(([, value]) => value.length).sort(([a], [b]) => a.localeCompare(b)).map(([id, value]) => [id, ids(value)]));
const history = (value: WorkflowPhaseHistoryEntry[] = []) => JSON.stringify(value.filter(entry => entry.action !== 'started').map(entry => [entry.phaseId, entry.action, entry.actorId]));
const sameProgress = (left: Task, right: Task) => ids(active(left)) === ids(active(right)) && approvals(left) === approvals(right) && history(left.workflowPhaseHistory) === history(right.workflowPhaseHistory);
const times = (task: Task) => JSON.stringify(Object.entries(task.workflowPhaseAvailableAtByPhaseId || {}).sort(([a], [b]) => a.localeCompare(b))) + '|' + (task.workflowPhaseAvailableAt || '');
const terminal = (task: Task) => CLOSED_STATUSES.includes(task.status);
const error = (message = 'This workflow change does not match an authorized active-step action. Final Rev. can only be completed by its fixed Art Director.') => { throw new ReportAccessError(message); };
const graphShape = (workflow?: WorkflowDefinition | null) => workflow ? JSON.stringify(getWorkflowExecutionDefinition(workflow)) : '';

function validCurrentPhase(task: Task) {
  return !task.workflowCurrentPhaseId || active(task).includes(task.workflowCurrentPhaseId);
}

function statusMatchesActive(task: Task): boolean {
  if (!task.workflowSnapshot || !active(task).length || !validCurrentPhase(task)) return false;
  const phase = task.workflowSnapshot.phases.find(phase => phase.id === (task.workflowCurrentPhaseId || active(task)[0]));
  if (!phase) return false;
  const expected = getStatusForWorkflowPhase(phase);
  if (expected === task.status) return true;
  return expected === 'sent_to_art_director' && ['waiting_art_director_approval', 'reviewer_approved'].includes(task.status)
    || expected === 'waiting_reviewer_full_review' && ['submitted', 'waiting_reviewer_quick_look'].includes(task.status);
}

function validEntryReset(task: Task, prior: Task | undefined, actor: User): boolean {
  const workflow = task.workflowSnapshot!;
  const initialized = computeWorkflowInitialization(workflow, task, prior ? actor.id : task.createdBy);
  const oldHistory = prior?.workflowPhaseHistory || [];
  const additions = (task.workflowPhaseHistory || []).slice(oldHistory.length);
  const invalidations = additions.filter(entry => entry.action === 'invalidated');
  if (prior && (invalidations.length !== workflow.phases.filter(phase => (phase.nodeType || 'step') === 'step').length
    || workflow.phases.filter(phase => (phase.nodeType || 'step') === 'step').some(phase => !invalidations.some(entry => entry.phaseId === phase.id && entry.actorId === actor.id)))) return false;
  const routeHistory = additions.filter(entry => entry.action !== 'invalidated');
  return ids(active(task)) === ids(initialized.nextActivePhaseIds) && approvals(task) === '[]'
    && history(routeHistory) === history(initialized.history)
    && routeHistory.filter(entry => entry.action === 'started').every(entry => active(task).includes(entry.phaseId))
    && !terminal(task) && statusMatchesActive(task);
}

/** Only transitions computed from the canonical prestate can advance or finish a saved workflow. */
export function validateWorkflowTransition(prior: Task | undefined, task: Task, actor: User, settings: AppSettings, users: User[], now = new Date()): void {
  if (!task.workflowSnapshot && !prior?.workflowSnapshot) return;
  if (!task.workflowSnapshot) error('A saved workflow cannot be removed to bypass Final Rev.');
  const workflow = task.workflowSnapshot!;
  const replaced = prior && (prior.workflowId !== task.workflowId || graphShape(prior.workflowSnapshot) !== graphShape(workflow));
  getValidatedFinalApproverMap(task, prior, settings, users);
  if (!prior || replaced || !prior.workflowSnapshot) {
    if (prior && !canManageWorkflowBuilder(actor, settings)) error('Only a workflow manager can replace the saved workflow.');
    if (!workflow.phases.some(isMandatoryFinalReview) || !validEntryReset(task, prior, actor)) error('A workflow must start at its configured entry steps and retain mandatory Final Rev.');
    return;
  }
  const unchanged = sameProgress(prior, task);
  const additions = (task.workflowPhaseHistory || []).slice((prior.workflowPhaseHistory || []).length);
  if (additions.some(entry => entry.action === 'started' && !active(task).includes(entry.phaseId))) error();
  const sameSkips = ids(prior.workflowSkippedPhaseIds) === ids(task.workflowSkippedPhaseIds);
  if (unchanged && sameSkips) {
    if (terminal(prior)) {
      if (task.status !== prior.status || task.workflowCurrentPhaseId !== prior.workflowCurrentPhaseId) error('Completed workflow history cannot be reopened by editing its state.');
      return; // Existing historical approval is not retroactively rewritten or re-attributed.
    }
    if (terminal(task)) error();
    if (times(prior) !== times(task)) error('Workflow availability is set by routing and cannot be edited to bypass a delayed approval.');
    if (task.status === prior.status && (task.workflowCurrentPhaseId === prior.workflowCurrentPhaseId || statusMatchesActive(task))) return;
    if (task.status === 'on_hold' && task.previousStatusBeforeHold === prior.status) return;
    if (prior.status === 'on_hold' && task.status === prior.previousStatusBeforeHold) return;
    if (RETURNED_STATUSES.includes(prior.status)) {
      const newUpload = task.versions?.some(version => !prior.versions?.some(old => old.id === version.id) && version.submittedBy === actor.id
        && (version.fileUrl || version.files?.some(file => file.url || file.driveFileId || file.blob)));
      if (getCurrentOwnerUserIds(prior).includes(actor.id) && newUpload && statusMatchesActive(task)) return;
      error('The assigned uploader must submit a revised file before review resumes.');
    }
    // Delay release can change the primary visible phase/status, never completion or approvals.
    if (statusMatchesActive(task) && active(task).some(id => isPhaseAvailable(prior, now, id))) return;
    error();
  }
  if (!sameSkips) {
    const omitted = reconcileWorkflowOmissions(prior, task, actor, settings, users, now);
    if (omitted.ok && omitted.task && sameProgress(omitted.task, task) && task.status === omitted.task.status && !terminal(task)) return;
    error(omitted.message);
  }
  if (terminal(prior) || prior.archivedAt || prior.status === 'on_hold') error();
  // An explicit manager reset may reapply the same saved/canonical workflow.
  if (canManageWorkflowBuilder(actor, settings) && additions.some(entry => entry.action === 'invalidated') && validEntryReset(task, prior, actor)) return;
  const sourceWorkflow = prior.workflowSnapshot;
  for (const phaseId of active(prior)) {
    const source = sourceWorkflow.phases.find(phase => phase.id === phaseId);
    if (!source) continue;
    const advanced = computeWorkflowAdvance(sourceWorkflow, { ...prior, versions: task.versions, assignmentLinks: task.assignmentLinks }, actor.id, phaseId, settings, users);
    if (advanced) {
      const expected = { ...prior, workflowActivePhaseIds: advanced.nextActivePhaseIds, workflowPhaseHistory: advanced.history, workflowPhaseApprovals: advanced.approvals };
      if (sameProgress(expected, task)) {
        if (advanced.blockedReason) error(advanced.blockedReason);
        if (normalizeReviewPhase(source).phaseKind === 'work' && !task.versions?.some(version =>
          !prior.versions?.some(old => old.id === version.id) && version.submittedBy === actor.id
          && (version.fileUrl || version.files?.some(file => file.url || file.driveFileId || file.blob)))) {
          error('Completing a Work step requires a new file submitted by its current owner.');
        }
        if (terminal(task)) {
          const fixed = resolveTaskFinalArtDirector(source, prior, settings, users);
          const completed = getCompletedPhaseIdsFromHistory(prior.workflowPhaseHistory || []);
          const finalIsReachable = sourceWorkflow.phases.filter(phase => getWorkflowSuccessors(sourceWorkflow, phase.id).some(next => next.id === source.id)).every(phase => completed.has(phase.id));
          if (!advanced.finished || !isMandatoryFinalReview(source) || !fixed.ok || actor.id !== fixed.ownerId || !finalIsReachable || active(task).length) error();
        } else if (advanced.finished || !statusMatchesActive(task)) error();
        return;
      }
    }
    const targets = [undefined, ...sourceWorkflow.phases.map(phase => phase.id)];
    for (const target of targets) {
      const returned = computeWorkflowReturn(sourceWorkflow, prior, actor.id, phaseId, target, settings, users);
      if (!returned) continue;
      const expected = { ...prior, workflowActivePhaseIds: returned.nextActivePhaseIds, workflowPhaseHistory: returned.history, workflowPhaseApprovals: returned.approvals };
      if (!sameProgress(expected, task)) continue;
      if (returned.targetPhaseId === phaseId) {
        const uploaderId = prior.versions?.[0]?.submittedBy || prior.createdBy;
        if (!RETURNED_STATUSES.includes(task.status) || ids(getCurrentOwnerUserIds(task)) !== ids([uploaderId])) error('A same-step return must wait for the actual uploader’s revision.');
      } else if (!statusMatchesActive(task)) error();
      return;
    }
  }
  error();
}
