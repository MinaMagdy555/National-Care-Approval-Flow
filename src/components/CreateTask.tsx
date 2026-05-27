import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../lib/store';
import { Upload, X, File, Image as ImageIcon, FileVideo, CheckCircle2, Link2, Plus } from 'lucide-react';
import { Task, ReviewMode, Priority, TaskType, UploadedTaskFile } from '../lib/types';
import { CustomSelect } from './CustomSelect';
import { UserMultiSelect } from './UserMultiSelect';
import { uploadTaskFiles } from '../lib/driveDb';
import { sanitizeHandledBy } from '../lib/handlerUtils';
import { ALLOWED_UPLOAD_EXTENSIONS, MAX_UPLOAD_SIZE_BYTES, uploadLimitHelpText, uploadLimitLabel } from '../lib/uploadLimits';
import { addLowResPreviewsToFiles } from '../lib/previewUtils';
import { createLinkedTaskFile, getLinkHostLabel } from '../lib/linkAttachments';
import { getReviewRouteTarget, uniqueIds } from '../lib/workflowUtils';

const FORM_SELECT_BUTTON_CLASS = 'rounded-xl border-slate-300 px-4 py-3 text-sm font-bold text-slate-900 shadow-none hover:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';

export function CreateTask() {
  const { currentUser, userList, users, environment, addTask, addNotification } = useAppStore();
  const [taskName, setTaskName] = useState('');
  const [createdBy, setCreatedBy] = useState('');
  const [taskType, setTaskType] = useState<TaskType>('video');
  const [reviewMode, setReviewMode] = useState<ReviewMode>('full_review');
  const [assignedContributorIds, setAssignedContributorIds] = useState<string[]>([]);
  const [currentOwnerUserIds, setCurrentOwnerUserIds] = useState<string[]>([]);
  const [scheduledPublishAt, setScheduledPublishAt] = useState('');
  const [publishNote, setPublishNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [linkedFiles, setLinkedFiles] = useState<UploadedTaskFile[]>([]);
  const [linkUrl, setLinkUrl] = useState('');
  const [fileError, setFileError] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workspaceUsers = userList.filter(user => user.id !== 'guest');
  const canChooseCreator = currentUser.role === 'reviewer' || currentUser.role === 'admin' || Boolean(currentUser.isAdmin);
  const selectedCreatorId = canChooseCreator ? createdBy : currentUser.id;
  const selectedCreatorRole = users[selectedCreatorId]?.role || currentUser.role;
  const isReviewerCreatedTask = selectedCreatorRole === 'reviewer' || selectedCreatorRole === 'admin';
  const effectiveReviewMode = isReviewerCreatedTask ? 'direct_to_ad' : reviewMode;
  const routeTarget = getReviewRouteTarget(effectiveReviewMode);
  const creatorOptions = workspaceUsers
    .filter(user => ['team_member', 'reviewer', 'admin'].includes(user.role))
    .map(user => ({ value: user.id, label: user.name }));
  const contributorOptions = workspaceUsers.filter(user => user.role !== 'art_director' && user.id !== selectedCreatorId);
  const ownerOptions = useMemo(() => {
    if (routeTarget.ownerRole === 'reviewer') return workspaceUsers.filter(user => user.role === 'reviewer' || user.role === 'admin');
    if (routeTarget.ownerRole === 'art_director') return workspaceUsers.filter(user => user.role === 'art_director');
    return workspaceUsers;
  }, [routeTarget.ownerRole, userList]);
  const taskTypeOptions = [
    { value: 'video', label: 'Video' },
    { value: 'ai_packet', label: 'AI Packets' },
    { value: 'sales_material', label: 'Sales Material' },
    { value: 'website_material', label: 'Website Material' },
    { value: 'campaign', label: 'Campaign' },
    { value: 'others', label: 'Others' },
  ];
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
  const isReviewer = currentUser.role === 'reviewer' || currentUser.role === 'admin';
  const [priority, setPriority] = useState<Priority | ''>('');
  const [deadline, setDeadline] = useState('');
  const hasAttachments = files.length > 0 || linkedFiles.length > 0;

  useEffect(() => {
    setAssignedContributorIds(prev => prev.filter(userId => userId !== selectedCreatorId));
  }, [selectedCreatorId]);

  useEffect(() => {
    const ownerOptionIds = ownerOptions.map(user => user.id);
    setCurrentOwnerUserIds(prev => {
      const validSelection = prev.filter(userId => ownerOptionIds.includes(userId));
      return validSelection.length > 0 ? validSelection : ownerOptionIds;
    });
  }, [ownerOptions]);

  const appendValidFiles = (incomingFiles: File[]) => {
    const validFiles = incomingFiles.filter(file => {
      const extension = file.name.split('.').pop()?.toLowerCase() || '';
      return ALLOWED_UPLOAD_EXTENSIONS.includes(extension) && file.size <= MAX_UPLOAD_SIZE_BYTES;
    });

    const rejectedCount = incomingFiles.length - validFiles.length;
    setFileError(rejectedCount > 0 ? uploadLimitHelpText() : '');

    if (validFiles.length > 0) {
      setFiles(prev => [...prev, ...validFiles]);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      appendValidFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      appendValidFiles(Array.from(e.target.files));
    }
    e.target.value = '';
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const addLinkedFile = () => {
    try {
      const linkedFile = createLinkedTaskFile(linkUrl);
      setLinkedFiles(prev => (
        prev.some(file => file.url === linkedFile.url)
          ? prev
          : [...prev, linkedFile]
      ));
      setLinkUrl('');
      setFileError('');
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Enter a valid link.');
    }
  };

  const removeLinkedFile = (id: string) => {
    setLinkedFiles(prev => prev.filter(file => file.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskName || !selectedCreatorId || !hasAttachments) return;

    const creator = users[selectedCreatorId] || (selectedCreatorId === currentUser.id ? currentUser : undefined);
    const newTaskId = Math.random().toString(36).substring(7);
    const newTaskCode = `TSK-2026-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
    const localFiles: UploadedTaskFile[] = files.map(file => ({
      id: Math.random().toString(36).substring(7),
      name: file.name,
      type: file.type,
      size: file.size,
      blob: file,
      url: URL.createObjectURL(file),
      storageProvider: 'local',
    }));
    let uploadedFiles: UploadedTaskFile[] = [];
    try {
      if (localFiles.length > 0) {
        uploadedFiles = await uploadTaskFiles(newTaskId, localFiles, {
          taskCode: newTaskCode,
          taskName,
        });
        uploadedFiles = await addLowResPreviewsToFiles(newTaskId, uploadedFiles, localFiles);
      }
    } catch (error) {
      console.error('Failed to upload task files', error);
      setFileError(error instanceof Error ? error.message : 'Could not upload files. Please try again.');
      return;
    }
    const taskFiles = [...uploadedFiles, ...linkedFiles];
    const thumbnailFile = taskFiles.find(file => file.previewUrl && file.previewStoragePath);

    const newTaskStatus = routeTarget.status;
    const selectedOwnerIds = currentOwnerUserIds;
    const handledByIds = sanitizeHandledBy([selectedCreatorId, ...assignedContributorIds]);

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
      currentOwnerUserId: selectedOwnerIds[0] || null,
      currentOwnerUserIds: selectedOwnerIds,
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
      ...selectedOwnerIds,
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
      setCurrentOwnerUserIds([]);
      setScheduledPublishAt('');
      setPublishNote('');
      setFiles([]);
      setLinkedFiles([]);
      setLinkUrl('');
      setFileError('');
      setPriority('');
      setDeadline('');
    }, 2000);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h2 className="mb-2 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">Create New Task</h2>
        <p className="text-slate-500 font-medium">Upload files or attach review links.</p>
      </div>

      {isSuccess ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-12 text-center flex flex-col items-center">
          <CheckCircle2 className="w-16 h-16 text-emerald-500 mb-4" />
          <h3 className="text-xl font-black text-emerald-900 mb-2">Task Submitted Successfully!</h3>
          <p className="text-emerald-700 font-medium">The reviewer has been notified.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-6 p-4 sm:p-6 lg:p-8">
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Task Name *</label>
                <input 
                  type="text" 
                  required
                  value={taskName}
                  onChange={e => setTaskName(e.target.value)}
                  placeholder="e.g. Q3 Launch Campaign Banner" 
                  className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-400 placeholder:font-medium"
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
                <div className="col-span-2 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1">Assigned Contributors</label>
                    <p className="text-xs font-semibold text-slate-500">Assigned contributors can view this task and resubmit edits when it is returned.</p>
                  </div>
                  <UserMultiSelect
                    users={contributorOptions}
                    selectedIds={assignedContributorIds}
                    onChange={setAssignedContributorIds}
                    emptyText="Select a creator first."
                  />
                </div>
                <div className="col-span-2 space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
                  <div>
                    <label className="block text-[11px] font-black text-indigo-500 uppercase tracking-wider mb-1">Current Owners</label>
                    <p className="text-xs font-semibold text-indigo-900/70">These people own the first workflow stage. Leave the defaults selected for the normal role queue.</p>
                  </div>
                  <UserMultiSelect
                    users={ownerOptions}
                    selectedIds={currentOwnerUserIds}
                    onChange={setCurrentOwnerUserIds}
                    emptyText="No owners are available for this route."
                  />
                </div>
                {taskType === 'campaign' && (
                  <div className="col-span-2 grid grid-cols-1 gap-4 rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-[10px] font-black text-emerald-700 uppercase tracking-wider mb-1.5">Publish Date & Time</label>
                      <input
                        type="datetime-local"
                        value={scheduledPublishAt}
                        onChange={event => setScheduledPublishAt(event.target.value)}
                        className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none transition-all focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500"
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

            {isReviewer && (
              <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
                 <div className="col-span-2 mb-1">
                   <h4 className="text-xs font-black text-slate-900 uppercase tracking-widest">Moderator Setup</h4>
                 </div>
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Priority *</label>
                    <CustomSelect
                      value={priority}
                      onChange={value => setPriority(value as Priority)}
                      options={priorityOptions}
                      placeholder="Select priority"
                      buttonClassName="rounded-lg border-slate-300 px-3 py-2 text-sm font-bold text-slate-900 shadow-none hover:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                 </div>
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Deadline</label>
                    <input 
                      type="text" 
                      value={deadline}
                      onChange={e => setDeadline(e.target.value)}
                      placeholder="e.g. End of day tomorrow" 
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all placeholder:font-medium"
                    />
                 </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Files or Links *</label>
              
              <div 
                className="cursor-pointer rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center transition-colors group hover:border-indigo-500 hover:bg-indigo-50/50 sm:p-10 lg:p-12"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={handleFileDrop}
              >
                <div className="w-16 h-16 bg-white rounded-full shadow-sm flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                  <Upload className="w-6 h-6 text-indigo-500" />
                </div>
                <p className="text-sm font-bold text-slate-900 mb-1">Click to upload or drag and drop</p>
                <p className="text-xs font-semibold text-slate-500">PNG, JPG, MP4 or PDF (max. {uploadLimitLabel()})</p>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  multiple 
                  accept=".png,.jpg,.jpeg,.mp4,.pdf,image/png,image/jpeg,video/mp4,application/pdf"
                  onChange={handleFileSelect}
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
                        addLinkedFile();
                      }
                    }}
                    placeholder="Paste a Drive, image, video, or PDF link"
                    className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-4 text-sm font-bold text-slate-900 outline-none transition-all placeholder:text-slate-400 placeholder:font-medium focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={addLinkedFile}
                  disabled={!linkUrl.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-black text-white shadow-sm transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <Plus className="h-4 w-4" />
                  Add Link
                </button>
              </div>

              {fileError && (
                <p className="mt-3 text-sm font-bold text-rose-600">{fileError}</p>
              )}

              {files.length > 0 && (
                <div className="mt-4 space-y-2">
                  {files.map((file, i) => (
                    <div key={i} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center">
                          {file.type.includes('image') ? <ImageIcon className="w-5 h-5 text-indigo-500"/> : 
                           file.type.includes('video') ? <FileVideo className="w-5 h-5 text-purple-500"/> :
                           <File className="w-5 h-5 text-slate-500"/>}
                        </div>
                        <div className="flex min-w-0 flex-col">
                          <span className="max-w-full truncate text-sm font-bold text-slate-900 sm:max-w-[220px]">{file.name}</span>
                          <span className="text-xs font-semibold text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                        </div>
                      </div>
                      <button type="button" onClick={() => removeFile(i)} className="self-end p-2 text-slate-400 transition-colors hover:text-rose-500 sm:self-auto">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
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
                disabled={!taskName || !selectedCreatorId || !hasAttachments || (isReviewer && !priority)}
                className="w-full rounded-xl bg-indigo-600 px-8 py-3 font-black text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
              >
                Submit Task
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
