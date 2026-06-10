import React, { useEffect, useState } from 'react';
import { useAppStore } from '../lib/store';
import { X, CheckCircle2, Link2, Plus } from 'lucide-react';
import { Task, ReviewMode, Priority, TaskType, UploadedTaskFile } from '../lib/types';
import { CustomSelect } from './CustomSelect';
import { UserMultiSelect } from './UserMultiSelect';
import { canAssignContributors, getAssignableContributorsForTask, sanitizeHandledBy } from '../lib/handlerUtils';
import { createLinkedTaskFileWithMetadata, getLinkHostLabel } from '../lib/linkAttachments';
import { getReviewRouteTarget, uniqueIds } from '../lib/workflowUtils';
import { canUploadWorkAssignment } from '../lib/workAssignmentUtils';
import { getTaskTypeLabel } from '../lib/taskUtils';

const FORM_SELECT_BUTTON_CLASS = 'rounded-xl border-slate-300 px-4 py-3 text-sm font-bold text-slate-900 shadow-none hover:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';

export function CreateTask({
  assignmentTaskId,
  onAssignmentUploaded,
}: {
  assignmentTaskId?: string | null;
  onAssignmentUploaded?: (taskId: string) => void;
}) {
  const { tasks, currentUser, userList, users, environment, addTask, addNotification, submitWorkAssignmentUpload, appSettings } = useAppStore();
  const [taskName, setTaskName] = useState('');
  const [createdBy, setCreatedBy] = useState('');
  const [taskType, setTaskType] = useState<TaskType>('video');
  const [reviewMode, setReviewMode] = useState<ReviewMode>('full_review');
  const [assignedContributorIds, setAssignedContributorIds] = useState<string[]>([]);
  const [scheduledPublishAt, setScheduledPublishAt] = useState('');
  const [publishNote, setPublishNote] = useState('');
  const [linkedFiles, setLinkedFiles] = useState<UploadedTaskFile[]>([]);
  const [linkUrl, setLinkUrl] = useState('');
  const [customFileName, setCustomFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const assignmentTask = assignmentTaskId ? tasks.find(task => task.id === assignmentTaskId && task.assignmentPeriod) : null;
  const isAssignmentUploadMode = Boolean(assignmentTask && assignmentTask.status === 'assigned_work');
  const canUploadAssignment = assignmentTask && assignmentTask.status === 'assigned_work' ? canUploadWorkAssignment(assignmentTask, currentUser) : false;
  const workspaceUsers = userList.filter(user => user.id !== 'guest');
  const canChooseCreator = !isAssignmentUploadMode && (currentUser.role === 'reviewer' || currentUser.role === 'admin' || Boolean(currentUser.isAdmin));
  const selectedCreatorId = assignmentTask ? assignmentTask.createdBy : canChooseCreator ? createdBy : currentUser.id;
  const selectedCreatorRole = users[selectedCreatorId]?.role || currentUser.role;
  const isReviewerCreatedTask = selectedCreatorRole === 'reviewer' || selectedCreatorRole === 'admin';
  const effectiveReviewMode = isReviewerCreatedTask ? 'direct_to_ad' : reviewMode;
  const routeTarget = getReviewRouteTarget(effectiveReviewMode);
  const canManageAssignedContributors = !isAssignmentUploadMode && canAssignContributors(currentUser.id, appSettings);
  const creatorOptions = workspaceUsers
    .filter(user => ['team_member', 'reviewer', 'admin'].includes(user.role))
    .map(user => ({ value: user.id, label: user.name }));
  const contributorOptions = canManageAssignedContributors
    ? getAssignableContributorsForTask(workspaceUsers, taskType, selectedCreatorId, appSettings)
    : [];
  const taskTypeOptions = (appSettings?.taskTypes || ['video', 'ai_packet', 'sales_material', 'website_material', 'campaign', 'others']).map(t => ({
    value: t,
    label: getTaskTypeLabel(t)
  }));
  const reviewModeOptions = [
    { value: 'full_review', label: 'Full Review' },
    { value: 'quick_look', label: 'Quick Look' },
    { value: 'direct_to_ad', label: 'Direct to Art Director' },
  ];
  const priorityOptions = [
    { value: 'low', label: 'Low' },
    { value: 'normal', label: 'Normal' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' },
  ];

  // If reviewer, they can set priority directly on creation if they want (though mostly they handle others)
  const isReviewer = !isAssignmentUploadMode && (currentUser.role === 'reviewer' || currentUser.role === 'admin');
  const [priority, setPriority] = useState<Priority | ''>('');
  const [deadline, setDeadline] = useState('');
  const hasAttachments = linkedFiles.length > 0;

  useEffect(() => {
    const availableContributorIds = new Set(contributorOptions.map(user => user.id));
    setAssignedContributorIds(prev => prev.filter(userId => availableContributorIds.has(userId)));
  }, [selectedCreatorId, taskType, canManageAssignedContributors, workspaceUsers.map(user => user.id).join('|')]);

  useEffect(() => {
    if (!assignmentTask) return;

    setTaskName(assignmentTask.name);
    setAssignedContributorIds([]);
    setPriority(assignmentTask.priority === 'not_set' ? 'normal' : assignmentTask.priority);
    setDeadline(assignmentTask.deadlineText || '');
    if (assignmentTask.taskType) {
      setTaskType(assignmentTask.taskType as TaskType);
    }
  }, [assignmentTask?.id]);

  const addLinkedFile = async () => {
    if (!linkUrl.trim() || isAddingLink) return;
    setIsAddingLink(true);
    try {
      const linkedFile = await createLinkedTaskFileWithMetadata(linkUrl);
      if (taskType === 'video' && !linkedFile.type.startsWith('video/')) {
        throw new Error('This is a video task. Please provide a link to a video file.');
      }
      if (customFileName.trim()) {
        linkedFile.name = customFileName.trim();
      } else if (!linkedFile.name || linkedFile.name === 'Google Drive file' || linkedFile.name === 'Google Docs file' || linkedFile.name === 'Google Drive folder' || linkedFile.name === 'Uploaded file') {
        const nextIndex = linkedFiles.length + 1;
        linkedFile.name = taskName ? (linkedFiles.length > 0 ? `${taskName} (${nextIndex})` : taskName) : 'Attachment';
      }
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
    if (!taskName || !selectedCreatorId || !hasAttachments) return;
    if (isAssignmentUploadMode && (!assignmentTask || !canUploadAssignment)) return;

    const taskFiles = [...linkedFiles];
    if (taskType === 'video' && !taskFiles.some(file => file.type.startsWith('video/'))) {
      setFileError('This is a video task. Please provide a link to a video file.');
      return;
    }

    const creator = users[selectedCreatorId] || (selectedCreatorId === currentUser.id ? currentUser : undefined);
    const newTaskId = assignmentTask?.id || Math.random().toString(36).substring(7);
    const newTaskCode = assignmentTask?.code || `TSK-${new Date().getFullYear()}-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
    const thumbnailFile = taskFiles.find(file => file.previewUrl && file.previewStoragePath);

    if (isAssignmentUploadMode && assignmentTask) {
      const nextVersionNumber = Math.max(0, ...assignmentTask.versions.map(version => version.versionNumber)) + 1;
      submitWorkAssignmentUpload(assignmentTask.id, {
        taskType,
        reviewMode: effectiveReviewMode,
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
    const defaultOwnerIds = routeTarget.ownerRole === 'reviewer'
      ? workspaceUsers.filter(user => user.role === 'reviewer' || user.role === 'admin').map(user => user.id)
      : routeTarget.ownerRole === 'art_director'
        ? workspaceUsers.filter(user => user.role === 'art_director').map(user => user.id)
        : [];
    const handledByIds = canManageAssignedContributors ? sanitizeHandledBy(assignedContributorIds, currentUser.id, appSettings) : [];

    const newTask: Task = {
      id: newTaskId,
      code: newTaskCode,
      name: taskName,
      taskType,
      reviewMode: effectiveReviewMode,
      environment,
      createdBy: selectedCreatorId,
      handledBy: handledByIds,
      status: newTaskStatus,
      currentOwnerRole: routeTarget.ownerRole,
      currentOwnerUserId: null,
      currentOwnerUserIds: [],
      priority: isReviewer ? priority : 'not_set',
      deadlineText: isReviewer ? deadline : null,
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

    addTask(newTask);

    const notificationRecipients = uniqueIds([
      ...defaultOwnerIds,
      ...handledByIds,
      ...workspaceUsers.filter(user => user.role === 'team_leader').map(user => user.id),
    ]).filter(userId => userId !== selectedCreatorId);

    Array.from(new Set(notificationRecipients)).forEach(userId => {
      addNotification({
        userId,
        taskId: newTaskId,
        message: `${creator?.name || 'Someone'} uploaded a new task: ${taskName}`,
      });
    });

    setIsSuccess(true);
    setTimeout(() => {
      setIsSuccess(false);
      setTaskName('');
      setCreatedBy('');
      setAssignedContributorIds([]);
      setScheduledPublishAt('');
      setPublishNote('');
      setLinkedFiles([]);
      setLinkUrl('');
      setFileError('');
      setPriority('');
      setDeadline('');
    }, 2000);
  };

  if (assignmentTaskId && !assignmentTask) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-black text-slate-900">Assigned work not found</h2>
        </div>
      </div>
    );
  }

  if (assignmentTask && assignmentTask.status === 'assigned_work' && !canUploadAssignment) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-black text-slate-900">This assignment is not available for upload</h2>
        </div>
      </div>
    );
  }

  if (assignmentTask && assignmentTask.status !== 'assigned_work' && !isSuccess) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-black text-slate-900">Finished work already uploaded</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h2 className="mb-2 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
          {isAssignmentUploadMode ? 'Upload Assigned Work' : 'Create New Task'}
        </h2>
        <p className="text-slate-500 font-medium">
          {isAssignmentUploadMode ? 'Submit a shared Drive link into the review flow.' : 'Attach a shared Drive link for review.'}
        </p>
      </div>

      {isSuccess ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-12 text-center flex flex-col items-center">
          <CheckCircle2 className="w-16 h-16 text-emerald-500 mb-4" />
          <h3 className="text-xl font-black text-emerald-900 mb-2">{isAssignmentUploadMode ? 'Finished Work Uploaded!' : 'Task Submitted Successfully!'}</h3>
          <p className="text-emerald-700 font-medium">The reviewer has been notified.</p>
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
                    <p className="font-semibold text-slate-800">{assignmentTask.deadlineAt ? new Date(assignmentTask.deadlineAt).toLocaleString() : assignmentTask.deadlineText || 'No deadline'}</p>
                  </div>
                </div>
                {(assignmentTask.assignmentLinks || []).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(assignmentTask.assignmentLinks || []).map(link => (
                      <a key={link} href={link} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-indigo-100 bg-white px-2 py-1 text-xs font-black text-indigo-600 hover:bg-indigo-50">
                        <Link2 className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{link}</span>
                      </a>
                    ))}
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
                    <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Task Creator *</label>
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
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Review Route *</label>
                  <CustomSelect
                    value={effectiveReviewMode}
                    onChange={value => setReviewMode(value as ReviewMode)}
                    options={reviewModeOptions}
                    buttonClassName={FORM_SELECT_BUTTON_CLASS}
                  />
                  {isReviewerCreatedTask && (
                    <p className="mt-2 text-xs font-bold text-slate-500">Reviewer-created tasks go directly to the art director.</p>
                  )}
                </div>
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
                {taskType === 'campaign' && (
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
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Deadline</label>
                    <input 
                      type="text" 
                      readOnly={isAssignmentUploadMode}
                      value={deadline}
                      onChange={e => setDeadline(e.target.value)}
                      placeholder="e.g. End of day tomorrow" 
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
                  placeholder="File Name (Optional)"
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
                <p className="mt-3 text-sm font-bold text-rose-600">{fileError}</p>
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
                disabled={!taskName || !selectedCreatorId || !hasAttachments || (isReviewer && !priority) || (isAssignmentUploadMode && !canUploadAssignment)}
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
