import React, { useEffect, useState } from 'react';
import { useAppStore } from '../lib/store';
import { X, CheckCircle2, Link2, Plus } from 'lucide-react';
import { Task, ReviewMode, Priority, TaskType, UploadedTaskFile, WorkflowDefinition } from '../lib/types';
import { CustomSelect } from './CustomSelect';
import { UserMultiSelect } from './UserMultiSelect';
import { canAssignContributors, getAssignableContributorsForTask, sanitizeHandledBy } from '../lib/handlerUtils';
import { createLinkedTaskFileWithMetadata, getLinkHostLabel, parseAssignmentLink } from '../lib/linkAttachments';
import { canManageWorkflowBuilder, canSkipWorkflowPhase, getPhaseAssignableOwnerIds, getReviewRouteTarget, getWorkflowForTaskType, isMandatoryFinalReview, RETURNED_STATUSES } from '../lib/workflowUtils';
import { canUploadWorkAssignment } from '../lib/workAssignmentUtils';
import { getTaskTypeLabel } from '../lib/taskUtils';
import { getTaskTypeConfigs, getWorkflowTaskTypeOptionLabel } from '../lib/appSettings';
import { formatDeadlineInput, getTaskDeadlineAt, parseDeadlineInput } from '../lib/deadlinePolicy';
import { canViewTask } from '../lib/taskPolicy';
import { isContentReviewPhase, normalizeReviewMode, normalizeReviewPhase } from '../lib/reviewPolicy';
import { prepareWorkflowAssignmentOwners, resolveWorkflowAssignment } from '../lib/workflowAssignment';
import { getUniqueShazaUser, getVoiceOverProvider, isVoiceOverPhase, VOICE_OVER_PROVIDER_OPTIONS } from '../lib/voiceOverPolicy';
import { canManageWorkflowOmissions } from '../lib/workflowOmissions';
import { resolveFixedArtDirector } from '../lib/finalApprovalPolicy';

const FORM_SELECT_BUTTON_CLASS = 'rounded-xl border-slate-300 px-4 py-3 text-sm font-bold text-slate-900 shadow-none hover:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';

export function CreateTask({
  assignmentTaskId,
  onAssignmentUploaded,
}: {
  assignmentTaskId?: string | null;
  onAssignmentUploaded?: (taskId: string) => void;
}) {
  const { tasks, currentUser, userList, users, environment, addTask, submitWorkAssignmentUpload, appSettings } = useAppStore();
  const [taskName, setTaskName] = useState('');
  const [createdBy, setCreatedBy] = useState('');
  const [taskType, setTaskType] = useState<TaskType>('');
  const [includeContentReview, setIncludeContentReview] = useState(false);
  const [workflowId, setWorkflowId] = useState('');
  const [assignedContributorIds, setAssignedContributorIds] = useState<string[]>([]);
  const [workflowNodeAssigneeIds, setWorkflowNodeAssigneeIds] = useState<Record<string, string[]>>({});
  const [workflowNodeVoiceOverDeliveryOwnerIds, setWorkflowNodeVoiceOverDeliveryOwnerIds] = useState<Record<string, string>>({});
  const [workflowSkippedPhaseIds, setWorkflowSkippedPhaseIds] = useState<string[]>([]);
  const [scheduledPublishAt, setScheduledPublishAt] = useState('');
  const [publishNote, setPublishNote] = useState('');
  const [linkedFiles, setLinkedFiles] = useState<UploadedTaskFile[]>([]);
  const [linkUrl, setLinkUrl] = useState('');
  const [customFileName, setCustomFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const assignmentTask = assignmentTaskId ? tasks.find(task => task.id === assignmentTaskId) : null;
  const workspaceUsers = userList.filter(user => user.id !== 'guest');
  const canViewAssignmentTask = Boolean(assignmentTask && canViewTask(assignmentTask, currentUser, appSettings, workspaceUsers));
  const assignmentActivePhaseIds = assignmentTask?.workflowActivePhaseIds ?? [assignmentTask?.workflowCurrentPhaseId].filter(Boolean) as string[];
  const assignmentOwnedWorkPhase = (assignmentTask?.workflowSnapshot?.phases || []).find(phase =>
    normalizeReviewPhase(phase).phaseKind === 'work' &&
    assignmentActivePhaseIds.includes(phase.id) &&
    assignmentTask &&
    getPhaseAssignableOwnerIds(assignmentTask, phase, appSettings, workspaceUsers, assignmentTask.workflowPhaseApprovals?.[phase.id] || []).includes(currentUser.id)
  ) || null;
  const canUploadAssignment = assignmentTask
    ? assignmentTask.workflowSnapshot
      ? Boolean(assignmentOwnedWorkPhase) &&
        !['approved_by_art_director', 'completed', 'archived', 'on_hold'].includes(assignmentTask.status) &&
        !RETURNED_STATUSES.includes(assignmentTask.status)
      : assignmentTask.status === 'assigned_work' && canUploadWorkAssignment(assignmentTask, currentUser)
    : false;
  const isAssignmentUploadMode = Boolean(assignmentTask && canUploadAssignment);
  const canChooseCreator = !isAssignmentUploadMode && (currentUser.role === 'reviewer' || currentUser.role === 'admin' || Boolean(currentUser.isAdmin));
  const selectedCreatorId = assignmentTask ? assignmentTask.createdBy : canChooseCreator ? createdBy : currentUser.id;
  const selectedWorkflowId = assignmentTask
    ? assignmentTask.workflowId || assignmentTask.workflowSnapshot?.id || workflowId
    : getWorkflowForTaskType(appSettings, taskType)?.id || '';
  const effectiveReviewMode: ReviewMode = normalizeReviewMode(assignmentTask?.reviewMode);
  const effectiveWorkflowId = selectedWorkflowId || null;
  const routeTarget = getReviewRouteTarget(effectiveReviewMode);
  const canChooseWorkflow = canManageWorkflowBuilder(currentUser, appSettings);
  const canManageStepOmissions = canManageWorkflowOmissions(currentUser, appSettings);
  const canManageAssignedContributors = !isAssignmentUploadMode && canAssignContributors(currentUser.id, appSettings);
  const creatorOptions = workspaceUsers
    .filter(user => ['team_member', 'reviewer', 'admin'].includes(user.role))
    .map(user => ({ value: user.id, label: user.name }));
  const contributorOptions = canManageAssignedContributors
    ? getAssignableContributorsForTask(workspaceUsers, taskType, selectedCreatorId, appSettings)
    : [];
  const taskTypeOptions = getTaskTypeConfigs(appSettings).map(config => {
    const id = config.id;
    const typeLabel = getTaskTypeLabel(id, appSettings);
    return {
      value: id,
      label: getWorkflowTaskTypeOptionLabel(appSettings, { ...config, label: typeLabel }),
    };
  });
  const hasSelectableTaskType = taskTypeOptions.some(option => option.value === taskType);
  const selectedWorkflow = assignmentTask?.workflowSnapshot || (appSettings.workflows || []).find(workflow => workflow.id === selectedWorkflowId) || null;
  const workflowSteps = (selectedWorkflow?.phases || []).filter(phase => (phase.nodeType || 'step') === 'step' && !phase.disabled);
  const voiceOverPhases = workflowSteps.filter(isVoiceOverPhase);
  const contentReviewPhaseIds = workflowSteps.filter(isContentReviewPhase).map(phase => phase.id);
  const shazaUser = getUniqueShazaUser(workspaceUsers);
  const workflowOptions = (appSettings.workflows || [])
    .filter(workflow => workflow.active !== false)
    .map(workflow => ({ value: workflow.id, label: workflow.name }));
  const priorityOptions = [
    { value: 'low', label: 'Low' },
    { value: 'normal', label: 'Normal' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' },
  ];

  // If reviewer, they can set priority directly on creation if they want (though mostly they handle others)
  const isReviewer = !isAssignmentUploadMode && (currentUser.role === 'reviewer' || currentUser.role === 'admin');
  const [priority, setPriority] = useState<Priority | ''>('');
  const [deadlineInput, setDeadlineInput] = useState('');
  const hasAttachments = linkedFiles.length > 0;

  useEffect(() => {
    const availableContributorIds = new Set(contributorOptions.map(user => user.id));
    setAssignedContributorIds(prev => prev.filter(userId => availableContributorIds.has(userId)));
  }, [selectedCreatorId, taskType, canManageAssignedContributors, workspaceUsers.map(user => user.id).join('|')]);

  useEffect(() => {
    if (isAssignmentUploadMode) return;
    if (taskTypeOptions.length === 0) {
      if (taskType) setTaskType('');
      return;
    }
    if (!taskTypeOptions.some(option => option.value === taskType)) {
      setTaskType(taskTypeOptions[0].value as TaskType);
    }
  }, [isAssignmentUploadMode, taskType, taskTypeOptions.map(option => option.value).join('|')]);

  useEffect(() => {
    if (!assignmentTask) return;

    setTaskName(assignmentTask.name);
    setAssignedContributorIds([]);
    setPriority(assignmentTask.priority === 'not_set' ? 'normal' : assignmentTask.priority);
    const assignmentDeadline = getTaskDeadlineAt(assignmentTask);
    setDeadlineInput(assignmentDeadline ? formatDeadlineInput(assignmentDeadline) : '');
    if (assignmentTask.taskType) {
      setTaskType(assignmentTask.taskType as TaskType);
    }
    setIncludeContentReview(Boolean(assignmentTask.needsContentRevision));
    if (assignmentTask.workflowId) {
      setWorkflowId(assignmentTask.workflowId);
    }
  }, [assignmentTask?.id]);

  useEffect(() => {
    if (isAssignmentUploadMode && assignmentTask) {
      return;
    }
    const workflow = getWorkflowForTaskType(appSettings, taskType);
    setWorkflowId(workflow?.id || '');
  }, [taskType, selectedCreatorId, isAssignmentUploadMode, assignmentTask?.id]);

  useEffect(() => {
    if (!isAssignmentUploadMode) setIncludeContentReview(false);
  }, [isAssignmentUploadMode, selectedWorkflowId]);

  useEffect(() => {
    if (isAssignmentUploadMode) return;
    const validPhaseIds = new Set(voiceOverPhases.map(phase => phase.id));
    setWorkflowNodeAssigneeIds(previous => Object.fromEntries(Object.entries(previous).filter(([phaseId]) => validPhaseIds.has(phaseId))));
    setWorkflowNodeVoiceOverDeliveryOwnerIds(previous => Object.fromEntries(Object.entries(previous).filter(([phaseId]) => validPhaseIds.has(phaseId))));
    const validStepIds = new Set(workflowSteps.map(phase => phase.id));
    setWorkflowSkippedPhaseIds(previous => previous.filter(phaseId => validStepIds.has(phaseId)));
  }, [isAssignmentUploadMode, selectedWorkflowId, voiceOverPhases.map(phase => phase.id).join('|'), workflowSteps.map(phase => phase.id).join('|')]);

  const addLinkedFile = async () => {
    if (!linkUrl.trim() || isAddingLink) return;
    setIsAddingLink(true);
    try {
      const linkedFile = await createLinkedTaskFileWithMetadata(linkUrl);
      if (taskType === 'video' && !linkedFile.type.startsWith('video/')) {
        throw new Error('This is a video task. Please provide a link to a video file.');
      }
      linkedFile.name = customFileName.trim() || linkedFile.name || 'Shared Link';
      setLinkedFiles(prev => (
        prev.some(file => file.url === linkedFile.url || (file.driveFileId && file.driveFileId === linkedFile.driveFileId))
          ? prev
          : [...prev, linkedFile]
      ));
      setLinkUrl('');
      setCustomFileName('');
      setFileError('');
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Enter a valid link.');
    } finally {
      setIsAddingLink(false);
    }
  };

  const removeLinkedFile = (id: string) => {
    setLinkedFiles(prev => prev.filter(file => file.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let workflowForCreation: WorkflowDefinition | undefined;
    if (!taskName || !selectedCreatorId || !hasAttachments) return;
    if (isAssignmentUploadMode && (!assignmentTask || !canUploadAssignment)) return;
    if (!assignmentTask && !hasSelectableTaskType) {
      setFileError('Create and activate a workflow before submitting a new task.');
      return;
    }
    if (!assignmentTask) {
      const workflowSelection = resolveWorkflowAssignment(appSettings, taskType, effectiveWorkflowId);
      if (!workflowSelection.ok || !workflowSelection.workflow) {
        setFileError(workflowSelection.message || 'This task type does not have a valid active workflow.');
        return;
      }
      workflowForCreation = workflowSelection.workflow;
    }

    const taskFiles = [...linkedFiles];
    if (taskType === 'video' && !taskFiles.some(file => file.type.startsWith('video/'))) {
      setFileError('This is a video task. Please provide a link to a video file.');
      return;
    }

    const newTaskId = assignmentTask?.id || Math.random().toString(36).substring(7);
    const newTaskCode = assignmentTask?.code || `TSK-${new Date().getFullYear()}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
    const thumbnailFile = taskFiles.find(file => file.previewUrl && file.previewStoragePath);

    if (isAssignmentUploadMode && assignmentTask) {
      const nextVersionNumber = Math.max(0, ...assignmentTask.versions.map(version => version.versionNumber)) + 1;
      const uploaded = submitWorkAssignmentUpload(assignmentTask.id, {
        phaseId: assignmentOwnedWorkPhase?.id,
        taskType,
        reviewMode: effectiveReviewMode,
        workflowId: effectiveWorkflowId,
        scheduledPublishAt: taskType === 'campaign' ? scheduledPublishAt || null : null,
        publishNote: taskType === 'campaign' ? publishNote.trim() || null : null,
        version: {
          id: Math.random().toString(36).substring(7),
          versionNumber: nextVersionNumber,
          submittedBy: currentUser.id,
          fileUrl: taskFiles[0].url,
          files: taskFiles,
          createdAt: new Date().toISOString(),
          submissionNote: 'Finished work upload',
        },
        thumbnailUrl: thumbnailFile?.previewUrl || '',
        thumbnailStoragePath: thumbnailFile?.previewStoragePath,
        driveFolderId: taskFiles.find(file => file.driveFolderId)?.driveFolderId,
      });

      if (!uploaded) {
        setFileError('This workflow step is no longer available for your upload. Refresh the task and try again.');
        return;
      }

      setIsSuccess(true);
      setTimeout(() => {
        setIsSuccess(false);
        setLinkedFiles([]);
        setLinkUrl('');
        setFileError('');
        onAssignmentUploaded?.(assignmentTask.id);
      }, 800);
      return;
    }

    const newTaskStatus = routeTarget.status;
    const handledByIds = canManageAssignedContributors ? sanitizeHandledBy(assignedContributorIds, currentUser.id, appSettings) : [];
    const parsedDeadline = isReviewer && deadlineInput ? parseDeadlineInput(deadlineInput) : null;
    if (isReviewer && deadlineInput && !parsedDeadline) {
      setFileError('Enter a valid deadline date and time for Africa/Cairo.');
      return;
    }
    const syncedSkippedPhaseIds = includeContentReview
      ? workflowSkippedPhaseIds.filter(phaseId => !contentReviewPhaseIds.includes(phaseId))
      : Array.from(new Set([...workflowSkippedPhaseIds, ...contentReviewPhaseIds]));

    const newTask: Task = {
      id: newTaskId,
      code: newTaskCode,
      name: taskName,
      taskType,
      reviewMode: effectiveReviewMode,
      needsContentRevision: includeContentReview,
      workflowId: effectiveWorkflowId,
      environment,
      createdBy: selectedCreatorId,
      handledBy: handledByIds,
      workContributorIds: handledByIds.length > 0 ? handledByIds : [selectedCreatorId],
      status: newTaskStatus,
      currentOwnerRole: routeTarget.ownerRole,
      currentOwnerUserId: null,
      currentOwnerUserIds: [],
      workflowNodeAssigneeIds,
      workflowNodeVoiceOverDeliveryOwnerIds,
      workflowSkippedPhaseIds: syncedSkippedPhaseIds,
      workflowSnapshot: null,
      workflowCurrentPhaseId: null,
      workflowCurrentPhaseIndex: null,
      workflowPhaseApprovals: {},
      workflowPhaseHistory: [],
      priority: isReviewer ? priority : 'not_set',
      deadlineText: null,
      deadlineAt: parsedDeadline?.toISOString() || null,
      scheduledPublishAt: taskType === 'campaign' ? scheduledPublishAt || null : null,
      publishNote: taskType === 'campaign' ? publishNote.trim() || null : null,
      publishedAt: null,
      publishReminderSentAt: null,
      versions: [
        {
          id: Math.random().toString(36).substring(7),
          versionNumber: 1,
          submittedBy: selectedCreatorId,
          fileUrl: taskFiles[0].url,
          files: taskFiles,
          createdAt: new Date().toISOString(),
          submissionNote: "Initial submission",
        }
      ],
      thumbnailUrl: thumbnailFile?.previewUrl || '',
      thumbnailStoragePath: thumbnailFile?.previewStoragePath,
      driveFolderId: taskFiles.find(file => file.driveFolderId)?.driveFolderId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const ownerPreparation = prepareWorkflowAssignmentOwners(
      workflowForCreation!,
      newTask,
      appSettings,
      workspaceUsers,
      handledByIds.length > 0 ? handledByIds : [selectedCreatorId],
    );
    if (!ownerPreparation.ok) {
      setFileError(ownerPreparation.message || 'Select an accountable member for every required workflow step.');
      return;
    }
    newTask.workflowNodeAssigneeIds = ownerPreparation.workflowNodeAssigneeIds || {};
    newTask.workflowNodeVoiceOverDeliveryOwnerIds = ownerPreparation.workflowNodeVoiceOverDeliveryOwnerIds || {};

    const created = addTask(newTask);
    if (!created) {
      setFileError('This task could not be created with the selected workflow. Review the workflow and try again.');
      return;
    }

    setIsSuccess(true);
    setTimeout(() => {
      setIsSuccess(false);
      setTaskName('');
      setCreatedBy('');
      setAssignedContributorIds([]);
      setWorkflowNodeAssigneeIds({});
      setWorkflowNodeVoiceOverDeliveryOwnerIds({});
      setWorkflowSkippedPhaseIds([]);
      setScheduledPublishAt('');
      setPublishNote('');
      setLinkedFiles([]);
      setLinkUrl('');
      setFileError('');
      setPriority('');
      setDeadlineInput('');
      setIncludeContentReview(false);
    }, 2000);
  };

  if (assignmentTaskId && (!assignmentTask || !canViewAssignmentTask)) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-black text-slate-900">Assigned work not found</h2>
        </div>
      </div>
    );
  }

  if (assignmentTask && !assignmentTask.workflowSnapshot && assignmentTask.status !== 'assigned_work' && !isSuccess) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-black text-slate-900">Finished work already uploaded</h2>
        </div>
      </div>
    );
  }

  if (assignmentTask && !canUploadAssignment && !isSuccess) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-black text-slate-900">This assignment is not available for upload</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h2 className="mb-2 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
          {assignmentTaskId ? 'Upload Assigned Work' : 'Create New Task'}
        </h2>
        <p className="text-slate-500 font-medium">
          {assignmentTaskId ? 'Submit a shared Drive link into the review flow.' : 'Attach a shared Drive link for review.'}
        </p>
      </div>

      {isSuccess ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-12 text-center flex flex-col items-center">
          <CheckCircle2 className="w-16 h-16 text-emerald-500 mb-4" />
          <h3 className="text-xl font-black text-emerald-900 mb-2">{assignmentTaskId ? 'Finished Work Uploaded!' : 'Task Submitted Successfully!'}</h3>
          <p className="text-emerald-700 font-medium">{assignmentTask?.status === 'completed' ? 'All workflow steps are complete.' : 'The next assigned employee has been notified.'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-6 p-4 sm:p-6 lg:p-8">
            {isAssignmentUploadMode && assignmentTask && (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-indigo-500">Original Brief</span>
                    <p className="font-semibold text-slate-800">{assignmentTask.description || 'No description'}</p>
                  </div>
                  <div>
                    <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-indigo-500">Deadline</span>
                    <p className="font-semibold text-slate-800">
                      {getTaskDeadlineAt(assignmentTask)?.toLocaleString('en-EG', { timeZone: 'Africa/Cairo' }) || 'No deadline'}
                    </p>
                  </div>
                </div>
                {(assignmentTask.assignmentLinks || []).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(assignmentTask.assignmentLinks || []).map(link => {
                      const { url, name } = parseAssignmentLink(link);
                      return (
                        <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-2 py-1 text-xs font-black text-indigo-600 hover:bg-indigo-50">
                          <Link2 className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{name}</span>
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Task Name *</label>
                <input 
                  type="text" 
                  required
                  readOnly={isAssignmentUploadMode}
                  value={taskName}
                  onChange={e => setTaskName(e.target.value)}
                  placeholder="e.g. Q3 Launch Campaign Banner" 
                  className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-400 placeholder:font-medium read-only:bg-slate-50"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {canChooseCreator && (
                  <div className="col-span-2">
                    <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Task Assigner *</label>
                    <CustomSelect
                      value={createdBy}
                      onChange={value => {
                        setCreatedBy(value);
                      }}
                      options={creatorOptions}
                      placeholder="Select who made the task"
                      buttonClassName={FORM_SELECT_BUTTON_CLASS}
                    />
                  </div>
                )}
                <div className="col-span-2">
                  <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Task Type *</label>
                  <CustomSelect
                    value={taskType}
                    onChange={value => setTaskType(value as TaskType)}
                    options={taskTypeOptions}
                    buttonClassName={FORM_SELECT_BUTTON_CLASS}
                    disabled={isAssignmentUploadMode}
                  />
                  {taskTypeOptions.length === 0 && !isAssignmentUploadMode && (
                    <p className="mt-2 text-xs font-bold text-rose-600">Create and activate a workflow before submitting a new task.</p>
                  )}
                </div>
                {canChooseWorkflow && workflowOptions.length > 0 && (
                  <div className="col-span-2">
                    <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Workflow</label>
                    <CustomSelect
                      value={selectedWorkflowId}
                      onChange={() => {}}
                      options={workflowOptions}
                      disabled
                      buttonClassName={FORM_SELECT_BUTTON_CLASS}
                    />
                    {!isAssignmentUploadMode && (
                      <p className="mt-2 text-xs font-bold text-slate-500">Workflow is determined by the task type.</p>
                    )}
                  </div>
                )}
                {canManageAssignedContributors && (
                <div className="col-span-2 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1">Assigned Contributors</label>
                    <p className="text-xs font-semibold text-slate-500">
                      Select team members to work on this task. Suggestions are based on task type and user settings.
                    </p>
                  </div>
                  <UserMultiSelect
                    users={contributorOptions}
                    selectedIds={assignedContributorIds}
                    onChange={setAssignedContributorIds}
                    emptyText="No contributors available for this task type."
                  />
                </div>
                )}
                {!isAssignmentUploadMode && workflowSteps.length > 0 && (
                  <div className="col-span-2 space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                    <div>
                      <h3 className="text-sm font-black text-slate-950">Workflow steps</h3>
                      <p className="mt-1 text-xs font-semibold text-slate-500">Omitted steps remain visible here and are bypassed only for this task.</p>
                    </div>
                    {workflowSteps.map(phase => {
                  const isContentReview = isContentReviewPhase(phase);
                  const isOmitted = isContentReview ? !includeContentReview : workflowSkippedPhaseIds.includes(phase.id);
                  const canToggleOmission = canSkipWorkflowPhase(phase) && (isContentReview || canManageStepOmissions);
                   const provider = getVoiceOverProvider({ workflowNodeAssigneeIds, workflowNodeAIAssigneeIds: {}, workflowNodeVoiceOverDeliveryOwnerIds }, phase);
                   const fixedArtDirector = isMandatoryFinalReview(phase) ? resolveFixedArtDirector(phase, appSettings, workspaceUsers) : null;
                  const deliveryOwnerId = workflowNodeVoiceOverDeliveryOwnerIds[phase.id] || '';
                  const providerLabelId = `voice-over-provider-${phase.id}`;
                  const deliveryLabelId = `voice-over-delivery-${phase.id}`;
                  return (
                    <div key={phase.id} className={`space-y-3 rounded-xl border p-3 ${isOmitted ? 'border-slate-200 bg-slate-100 opacity-70' : isVoiceOverPhase(phase) ? 'border-violet-200 bg-violet-50/60' : 'border-white bg-white'}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h4 className="text-sm font-black text-slate-950">{phase.name}</h4>
                          {phase.nodeNote && <p className="mt-1 text-xs font-semibold text-slate-500">{phase.nodeNote}</p>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {isMandatoryFinalReview(phase) && <span className="rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-violet-700">Required</span>}
                          {isOmitted && <span className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600">Omitted</span>}
                          {canToggleOmission && (
                            <button
                              type="button"
                              aria-label={`${isOmitted ? 'Include' : 'Omit'} ${phase.name}`}
                              onClick={() => {
                                if (isContentReview) setIncludeContentReview(isOmitted);
                                setWorkflowSkippedPhaseIds(previous => isOmitted
                                  ? previous.filter(phaseId => phaseId !== phase.id)
                                  : Array.from(new Set([...previous, phase.id])));
                              }}
                              className={`rounded-lg border px-2 py-1 text-[10px] font-black ${isOmitted ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}
                            >
                              {isOmitted ? 'Include step' : 'Omit step'}
                            </button>
                          )}
                        </div>
                      </div>
                       {isContentReview && <p className="text-xs font-semibold text-indigo-700">Content Review is optional for each task. When omitted, the workflow continues along its configured route.</p>}
                       {!isOmitted && fixedArtDirector && (
                         <div
                           role={fixedArtDirector.ok ? 'status' : 'alert'}
                           aria-label={`${phase.name} fixed Art Director`}
                           className={`rounded-lg border px-3 py-2 ${fixedArtDirector.ok ? 'border-violet-200 bg-violet-50 text-violet-900' : 'border-rose-200 bg-rose-50 text-rose-800'}`}
                         >
                           <div className="text-[10px] font-black uppercase tracking-wider">Fixed approver</div>
                           <div className="mt-1 text-sm font-black">
                             {fixedArtDirector.ok && fixedArtDirector.ownerId
                               ? workspaceUsers.find(user => user.id === fixedArtDirector.ownerId)?.name || fixedArtDirector.ownerId
                               : 'Art Director configuration required'}
                           </div>
                           <p className="mt-1 text-xs font-semibold">
                             {fixedArtDirector.ok
                               ? 'Final Review is assigned automatically and cannot be changed for this task.'
                               : fixedArtDirector.message}
                           </p>
                         </div>
                       )}
                       {!isOmitted && isVoiceOverPhase(phase) && <div role="group" aria-labelledby={providerLabelId} className="space-y-1.5">
                        <div id={providerLabelId} className="text-[10px] font-black uppercase tracking-wider text-violet-700">Voice Over provider</div>
                        <CustomSelect
                          value={provider || ''}
                          onChange={value => {
                            if (value === provider) return;
                            setWorkflowNodeAssigneeIds(previous => ({ ...previous, [phase.id]: value ? [value] : [] }));
                            setWorkflowNodeVoiceOverDeliveryOwnerIds(previous => ({ ...previous, [phase.id]: '' }));
                          }}
                          options={VOICE_OVER_PROVIDER_OPTIONS}
                          placeholder="Choose voice over provider"
                          buttonClassName={FORM_SELECT_BUTTON_CLASS}
                        />
                      </div>}
                      {!isOmitted && isVoiceOverPhase(phase) && (provider === 'voice_over_shaza' && shazaUser ? (
                        <div className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-800">
                          Delivery owner: {shazaUser.name} (workspace member)
                        </div>
                      ) : provider ? (
                        <div role="group" aria-labelledby={deliveryLabelId} className="space-y-1.5">
                          <div id={deliveryLabelId} className="text-[10px] font-black uppercase tracking-wider text-violet-700">
                            {provider === 'voice_over_ai' ? 'Human uploader' : 'Delivery coordinator'}
                          </div>
                          <CustomSelect
                            value={deliveryOwnerId}
                            onChange={value => setWorkflowNodeVoiceOverDeliveryOwnerIds(previous => ({ ...previous, [phase.id]: value }))}
                            options={[
                              { value: '', label: provider === 'voice_over_ai' ? 'Choose who uploads the AI audio' : 'Choose a coordinator for external Shaza' },
                              ...workspaceUsers.map(user => ({ value: user.id, label: user.name })),
                            ]}
                            buttonClassName={FORM_SELECT_BUTTON_CLASS}
                          />
                          <p className="text-xs font-semibold text-violet-700">
                            {provider === 'voice_over_ai'
                              ? 'This person is accountable for delivering and uploading the generated audio.'
                              : 'This person coordinates delivery and upload; Shaza remains the voice provider.'}
                          </p>
                        </div>
                      ) : null)}
                    </div>
                  );
                    })}
                  </div>
                )}
                {taskType === 'campaign' && !isAssignmentUploadMode && (
                  <div className="col-span-2 grid grid-cols-1 gap-4 rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-[10px] font-black text-emerald-700 uppercase tracking-wider mb-1.5">Publish Date & Time</label>
                      <input
                        type="datetime-local"
                        value={scheduledPublishAt}
                        onChange={event => setScheduledPublishAt(event.target.value)}
                        onClick={(e) => {
                          try { e.currentTarget.showPicker(); } catch (err) {}
                        }}
                        className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none transition-all focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-emerald-700 uppercase tracking-wider mb-1.5">Publish Note</label>
                      <input
                        type="text"
                        value={publishNote}
                        onChange={event => setPublishNote(event.target.value)}
                        placeholder="e.g. Facebook launch post"
                        className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none transition-all placeholder:font-medium focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {(isReviewer || isAssignmentUploadMode) && (
              <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
                 <div className="col-span-2 mb-1">
                   <h4 className="text-xs font-black text-slate-900 uppercase tracking-widest">
                     {isAssignmentUploadMode ? 'Assignment Info' : 'Moderator Setup'}
                   </h4>
                 </div>
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Priority *</label>
                    <CustomSelect
                      value={priority}
                      onChange={value => setPriority(value as Priority)}
                      options={priorityOptions}
                      placeholder="Select priority"
                      buttonClassName="rounded-lg border-slate-300 px-3 py-2 text-sm font-bold text-slate-900 shadow-none hover:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      disabled={isAssignmentUploadMode}
                    />
                 </div>
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Deadline (Africa/Cairo)</label>
                    <input
                      type="datetime-local"
                      readOnly={isAssignmentUploadMode}
                      value={deadlineInput}
                      onChange={e => setDeadlineInput(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all placeholder:font-medium read-only:bg-slate-100 read-only:text-slate-500"
                    />
                 </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">
                {isAssignmentUploadMode ? 'Finished Shared Drive Link *' : 'Shared Drive Link *'}
              </label>
              <p className="mb-3 text-xs font-semibold text-slate-500">
                Paste a shared Google Drive or Google Docs link. The task preview opens inside this tool.
              </p>

               <div className="mb-3">
                <input
                  type="text"
                  value={customFileName}
                  onChange={e => setCustomFileName(e.target.value)}
                  placeholder="File Name"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-900 outline-none transition-all placeholder:text-slate-400 placeholder:font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr,auto]">
                <div className="relative">
                  <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="url"
                    value={linkUrl}
                    onChange={event => setLinkUrl(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && linkUrl.trim()) {
                        event.preventDefault();
                        void addLinkedFile();
                      }
                    }}
                    placeholder="Paste shared Google Drive link"
                    className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-4 text-sm font-bold text-slate-900 outline-none transition-all placeholder:text-slate-400 placeholder:font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void addLinkedFile()}
                  disabled={!linkUrl.trim() || isAddingLink}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-black text-white shadow-sm transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <Plus className="h-4 w-4" />
                  {isAddingLink ? 'Reading Link...' : 'Add Drive Link'}
                </button>
              </div>

              {fileError && (
                <p role="alert" className="mt-3 text-sm font-bold text-rose-600">{fileError}</p>
              )}

              {linkedFiles.length > 0 && (
                <div className="mt-4 space-y-2">
                  {linkedFiles.map(file => (
                    <div key={file.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white">
                          <Link2 className="h-5 w-5 text-indigo-500" />
                        </div>
                        <div className="flex min-w-0 flex-col">
                          <span className="max-w-full truncate text-sm font-bold text-slate-900 sm:max-w-[260px]">{file.name}</span>
                          <span className="max-w-full truncate text-xs font-semibold text-slate-500 sm:max-w-[320px]">{getLinkHostLabel(file.url)}</span>
                        </div>
                      </div>
                      <button type="button" onClick={() => removeLinkedFile(file.id)} className="self-end p-2 text-slate-400 transition-colors hover:text-rose-500 sm:self-auto">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-slate-100 pt-4">
              <button 
                type="submit"
                disabled={!taskName || !selectedCreatorId || !hasAttachments || (isReviewer && !priority) || (isAssignmentUploadMode ? !canUploadAssignment : !hasSelectableTaskType)}
                className="w-full rounded-xl bg-indigo-600 px-8 py-3 font-black text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
              >
                {isAssignmentUploadMode ? 'Upload Finished Work' : 'Submit Task'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
