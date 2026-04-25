import React, { useState, useRef } from 'react';
import { useAppStore } from '../lib/store';
import { Upload, X, File, Image as ImageIcon, FileVideo, CheckCircle2 } from 'lucide-react';
import { Task, ReviewMode, Priority, TaskType } from '../lib/types';
import { initialUsers } from '../lib/mockData';
import { CustomSelect } from './CustomSelect';

const MAX_FILE_SIZE_MB = 200;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ALLOWED_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'mp4', 'pdf'];
const FORM_SELECT_BUTTON_CLASS = 'rounded-xl border-slate-300 px-4 py-3 text-sm font-bold text-slate-900 shadow-none hover:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';

export function CreateTask() {
  const { currentUser, environment, addTask, addNotification } = useAppStore();
  const [taskName, setTaskName] = useState('');
  const [createdBy, setCreatedBy] = useState('');
  const [taskType, setTaskType] = useState<TaskType>('video');
  const [reviewMode, setReviewMode] = useState<ReviewMode>('full_review');
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canChooseCreator = currentUser.id === 'user_1';
  const selectedCreatorId = canChooseCreator ? createdBy : currentUser.id;
  const creatorOptions = [
    { value: 'user_1', label: 'Mina' },
    { value: 'user_4', label: 'Mariam' },
    { value: 'user_5', label: 'Noreen' },
    { value: 'user_6', label: 'Yomna' },
  ];
  const taskTypeOptions = [
    { value: 'video', label: 'Video' },
    { value: 'sales_material', label: 'Sales Material' },
    { value: 'website_material', label: 'Website Material' },
    { value: 'campaign', label: 'Campaign' },
    { value: 'others', label: 'Others' },
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

  const appendValidFiles = (incomingFiles: File[]) => {
    const validFiles = incomingFiles.filter(file => {
      const extension = file.name.split('.').pop()?.toLowerCase() || '';
      return ALLOWED_FILE_EXTENSIONS.includes(extension) && file.size <= MAX_FILE_SIZE_BYTES;
    });

    const rejectedCount = incomingFiles.length - validFiles.length;
    setFileError(rejectedCount > 0 ? `Only PNG, JPG, MP4, or PDF files up to ${MAX_FILE_SIZE_MB}MB are allowed.` : '');

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskName || !selectedCreatorId || files.length === 0) return;

    const creator = initialUsers.find(u => u.id === selectedCreatorId);
    const newTaskId = Math.random().toString(36).substring(7);

    const newTask: Task = {
      id: newTaskId,
      code: `TSK-2026-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`,
      name: taskName,
      taskType,
      reviewMode,
      environment,
      createdBy: selectedCreatorId,
      handledBy: [selectedCreatorId],
      status: 'submitted',
      currentOwnerRole: 'reviewer',
      currentOwnerUserId: null,
      priority: isReviewer ? priority : 'not_set',
      deadlineText: isReviewer ? deadline : null,
      versions: [
        {
          id: Math.random().toString(36).substring(7),
          versionNumber: 1,
          submittedBy: selectedCreatorId,
          fileUrl: URL.createObjectURL(files[0]),
          createdAt: new Date().toISOString(),
          submissionNote: "Initial submission",
        }
      ],
      thumbnailUrl: '', // Could be generated from image file
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    addTask(newTask);

    const notificationRecipients = selectedCreatorId === 'user_1'
      ? ['user_3', 'user_2']
      : ['user_1', 'user_3'];

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
      setFiles([]);
      setFileError('');
      setPriority('');
      setDeadline('');
    }, 2000);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h2 className="mb-2 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">Create New Task</h2>
        <p className="text-slate-500 font-medium">Upload files and submit task for review.</p>
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
                      onChange={setCreatedBy}
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
              <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Upload Files *</label>
              
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
                <p className="text-xs font-semibold text-slate-500">PNG, JPG, MP4 or PDF (max. 200MB)</p>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  multiple 
                  accept=".png,.jpg,.jpeg,.mp4,.pdf,image/png,image/jpeg,video/mp4,application/pdf"
                  onChange={handleFileSelect}
                />
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
            </div>

            <div className="flex justify-end border-t border-slate-100 pt-4">
              <button 
                type="submit"
                disabled={!taskName || !selectedCreatorId || files.length === 0 || (isReviewer && !priority)}
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
