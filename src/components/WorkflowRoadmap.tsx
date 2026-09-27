import React from 'react';
import { Task } from '../lib/types';
import { useAppStore } from '../lib/store';
import { canSeeWorkflowRoadmap, getWorkflowRoadmap, formatUserLabel } from '../lib/workflowRoadmap';
import { CLOSED_STATUSES } from '../lib/workflowUtils';

export function WorkflowRoadmap({ task }: { task: Task }) {
  const { currentUser, userList, users, appSettings } = useAppStore();
  if (!canSeeWorkflowRoadmap(task, currentUser, appSettings, userList)) return null;
  const roadmap = getWorkflowRoadmap(task, appSettings, userList);

  if (roadmap.length === 0) return null;

  const totalSteps = roadmap.filter(s => s.state !== 'Disabled' && s.state !== 'Skipped').length;
  const completedSteps = roadmap.filter(s => s.state === 'Finished').length;

  const displaySteps = roadmap.map((step, i) => ({ step, index: i + 1 })).filter(({ step }) => step.isActive);
  const closed = CLOSED_STATUSES.includes(task.status) || Boolean(task.archivedAt);

  return (
    <span role="group" className="my-3 block min-w-0" aria-label={`Workflow roadmap for ${task.name}`}>
      <span className="mb-1.5 flex justify-between gap-2 text-[10px] font-bold text-slate-500"><span>Workflow progress</span><span>{completedSteps}/{totalSteps} completed</span></span>
      <span
        role="progressbar"
        aria-valuenow={completedSteps}
        aria-valuemin={0}
        aria-valuemax={Math.max(totalSteps, 1)}
        aria-valuetext={`${completedSteps} of ${totalSteps} steps completed`}
        aria-label={`Workflow progress: ${completedSteps} of ${totalSteps} steps completed`}
        className="flex h-2 w-full gap-1"
      >
        {roadmap.map((step, index) => {
          const isFinished = step.state === 'Finished';
          const isCurrent = step.state === 'Current' || step.state === 'Returned for revisions' || step.state === 'On hold';
          const isSkippedOrDisabled = step.state === 'Skipped' || step.state === 'Disabled';

          let bgColor = 'bg-white border border-slate-200';
          if (isFinished) bgColor = 'bg-indigo-600';
          else if (isCurrent) bgColor = 'bg-white border-2 border-indigo-600';
          else if (isSkippedOrDisabled) bgColor = 'bg-white border border-dashed border-slate-300 opacity-60';

          return (
            <span
              key={`${step.id}-${index}`}
              className={`flex-1 rounded-full ${bgColor}`}
              title={`Step ${index + 1}: ${step.name} (${step.state})${step.ownerIds.length ? ' · ' + step.ownerIds.map(id => formatUserLabel(users[id])).join(', ') : ''}`}
            />
          );
        })}
      </span>

      <span className="mt-2 flex flex-col gap-1 text-[12px] leading-snug text-slate-700">
        {displaySteps.map(({ step, index }) => {
          const ownersStr = step.ownerIds.length > 0
            ? step.ownerIds.map(id => formatUserLabel(users[id])).join(', ')
            : 'No member assigned';

          let stateLabel = '';
          if (step.state === 'On hold') stateLabel = ' (On hold)';
          if (step.state === 'Returned for revisions') stateLabel = ' (Revisions requested)';
          if (step.state === 'Scheduled') stateLabel = ' (Scheduled)';

          return (
            <span key={step.id} className="break-words">
              <span className="font-medium">Step {index} &middot; {ownersStr}</span>
              <span className="block text-[11px] text-slate-500">
                {step.name}{stateLabel}
              </span>
            </span>
          );
        })}
        {displaySteps.length === 0 && (
          <span className="text-slate-500">{closed ? task.status === 'archived' || task.archivedAt ? 'Archived' : 'Workflow completed' : 'Waiting for a workflow step'}</span>
        )}
      </span>
    </span>
  );
}
