import React, { useRef, useState } from 'react';
import { useAppStore } from '../lib/store';
import { Priority, TaskCommentSection, UploadedTaskFile } from '../lib/types';
import { initialUsers } from '../lib/mockData';
import { getStatusInfo, getNextActionLabel, getTaskTypeLabel, getReviewModeLabel } from '../lib/taskUtils';
import { cn } from '../lib/utils';
import { ArrowLeft, Check, X, AlertCircle, Clock, Upload, Plus, File as FileIcon } from 'lucide-react';
import { FilePreview, getFileKind, getPdfPreviewUrl, getTaskFiles, isLocalOnlyFileUrl } from './FilePreview';
import { uploadTaskFiles } from '../lib/supabaseDb';
import { isTaskArchived } from '../lib/archiveUtils';

type ReviewNoteSection = {
  id: string;
  note: string;
  imageName?: string;
  imageUrl?: string;
};

const MAX_FILE_SIZE_MB = 200;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ALLOWED_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'mp4', 'pdf'];
const MINA_ID = 'user_1';
const MARWA_ID = 'user_2';
const DINA_ID = 'user_3';
const INTERNAL_REVIEW_VIEWERS = [MINA_ID, MARWA_ID, DINA_ID];

export function TaskDetail({ taskId, onBack }: { taskId: string; onBack: () => void }) {
  const { tasks, currentUser, updateTaskStatus, updateTaskPriority, addTaskComment, addTaskVersion, replaceTaskVersionFiles, archiveTask, unarchiveTask } = useAppStore();
  const task = tasks.find(t => t.id === taskId);
  
  const [modal, setModal] = useState<'send_to_ad' | 'quick_look_done' | 'ad_reject' | null>(null);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<ReviewNoteSection[]>([{ id: 'note_1', note: '' }]);
  const [adRejectComment, setAdRejectComment] = useState('');
  const [adRejectNotes, setAdRejectNotes] = useState<ReviewNoteSection[]>([{ id: 'ad_note_1', note: '' }]);
  const [selectedMinaFeedbackIds, setSelectedMinaFeedbackIds] = useState<string[]>([]);
  const [resubmitFiles, setResubmitFiles] = useState<File[]>([]);
  const [resubmitNote, setResubmitNote] = useState('');
  const [resubmitError, setResubmitError] = useState('');
  const [isResubmitting, setIsResubmitting] = useState(false);
  const [repairError, setRepairError] = useState('');
  const [isRepairingFiles, setIsRepairingFiles] = useState(false);
  const resubmitInputRef = useRef<HTMLInputElement>(null);
  const repairInputRef = useRef<HTMLInputElement>(null);

  const canViewFullWorkspace = INTERNAL_REVIEW_VIEWERS.includes(currentUser.id);

  if (!task || (!canViewFullWorkspace && task.createdBy !== currentUser.id)) return <div>Task not found</div>;

  const statusInfo = getStatusInfo(task, currentUser.role);
  const nextAction = getNextActionLabel(task, currentUser.role);
  const creator = initialUsers.find(u => u.id === task.createdBy)?.name || 'Unknown';
  const handledByNames = task.handledBy.map(id => initialUsers.find(u => u.id === id)?.name).filter(Boolean).join(' + ');

  const currentVersion = task.versions[0];
  const files = getTaskFiles(currentVersion);
  const selectedFile = files[selectedFileIndex] || files[0];
  const currentVersionHasLocalOnlyFiles = files.some(file => isLocalOnlyFileUrl(file.url));
  const isArchived = isTaskArchived(task);
  const isDetailedReviewType = task.taskType === 'ai_packet' || task.taskType === 'video';
  const isSelfCreatedTask = task.createdBy === currentUser.id;
  const isReviewerActionable = !isSelfCreatedTask && ['submitted', 'waiting_reviewer_full_review', 'waiting_reviewer_quick_look', 'draft'].includes(task.status);
  const canResubmitVersion = isSelfCreatedTask && ['changes_requested_by_reviewer', 'changes_requested_by_art_director'].includes(task.status);
  const isInternalReviewTask = !isDetailedReviewType;
  const canViewInternalReviewNotes = INTERNAL_REVIEW_VIEWERS.includes(currentUser.id);
  const isInternalMinaComment = (comment: { authorId: string; action: string }) => (
    isInternalReviewTask && comment.authorId === MINA_ID && comment.action === 'sent_to_marwa'
  );
  const visibleComments = (task.comments || []).filter(comment => !isInternalMinaComment(comment) || canViewInternalReviewNotes);
  const minaForwardableComments = (task.comments || []).filter(comment => isInternalMinaComment(comment));
  const minaForwardableFeedback = minaForwardableComments.flatMap(comment => {
    const items: Array<{
      id: string;
      label: string;
      note: string;
      imageName?: string;
      imageUrl?: string;
    }> = [];

    if (comment.message?.trim()) {
      items.push({
        id: `${comment.id}:message`,
        label: 'Main note',
        note: comment.message.trim(),
      });
    }

    comment.sections.forEach((section, index) => {
      if (section.note || section.imageUrl) {
        items.push({
          id: `${comment.id}:section:${section.id}`,
          label: `Screen note ${index + 1}`,
          note: section.note,
          imageName: section.imageName,
          imageUrl: section.imageUrl,
        });
      }
    });

    return items;
  });
  const selectedMinaFeedback = minaForwardableFeedback.filter(item => selectedMinaFeedbackIds.includes(item.id));
  const canSubmitADReject = adRejectComment.trim() || selectedMinaFeedback.length > 0 || adRejectNotes.some(section => section.note.trim() || section.imageUrl);

  const appendResubmitFiles = (incomingFiles: File[]) => {
    const validFiles = incomingFiles.filter(file => {
      const extension = file.name.split('.').pop()?.toLowerCase() || '';
      return ALLOWED_FILE_EXTENSIONS.includes(extension) && file.size <= MAX_FILE_SIZE_BYTES;
    });

    const rejectedCount = incomingFiles.length - validFiles.length;
    setResubmitError(rejectedCount > 0 ? `Only PNG, JPG, MP4, or PDF files up to ${MAX_FILE_SIZE_MB}MB are allowed.` : '');

    if (validFiles.length > 0) {
      setResubmitFiles(prev => [...prev, ...validFiles]);
    }
  };

  const handleResubmitVersion = async (event: React.FormEvent) => {
    event.preventDefault();
    if (resubmitFiles.length === 0 || isResubmitting) return;

    setIsResubmitting(true);
    setResubmitError('');

    const nextVersionNumber = Math.max(0, ...task.versions.map(version => version.versionNumber)) + 1;
    const localFiles: UploadedTaskFile[] = resubmitFiles.map(file => ({
      id: Math.random().toString(36).substring(7),
      name: file.name,
      type: file.type,
      size: file.size,
      blob: file,
      url: URL.createObjectURL(file),
    }));

    try {
      const uploadedFiles = await uploadTaskFiles(task.id, localFiles);
      addTaskVersion(task.id, {
        id: Math.random().toString(36).substring(7),
        versionNumber: nextVersionNumber,
        submittedBy: currentUser.id,
        submissionNote: resubmitNote.trim() || `Resubmitted as V${nextVersionNumber}`,
        fileUrl: uploadedFiles[0].url,
        files: uploadedFiles,
        createdAt: new Date().toISOString(),
      });
      setSelectedFileIndex(0);
      setResubmitFiles([]);
      setResubmitNote('');
    } catch (error) {
      console.error('Failed to upload revised task files', error);
      setResubmitError('Could not upload the revised files. Please try again.');
    } finally {
      setIsResubmitting(false);
    }
  };

  const handleRepairFiles = async (incomingFiles: File[]) => {
    if (incomingFiles.length === 0 || isRepairingFiles) return;

    const validFiles = incomingFiles.filter(file => {
      const extension = file.name.split('.').pop()?.toLowerCase() || '';
      return ALLOWED_FILE_EXTENSIONS.includes(extension) && file.size <= MAX_FILE_SIZE_BYTES;
    });

    if (validFiles.length !== incomingFiles.length) {
      setRepairError(`Only PNG, JPG, MP4, or PDF files up to ${MAX_FILE_SIZE_MB}MB are allowed.`);
      return;
    }

    setIsRepairingFiles(true);
    setRepairError('');

    const localFiles: UploadedTaskFile[] = validFiles.map(file => ({
      id: Math.random().toString(36).substring(7),
      name: file.name,
      type: file.type,
      size: file.size,
      blob: file,
      url: URL.createObjectURL(file),
    }));

    try {
      const uploadedFiles = await uploadTaskFiles(task.id, localFiles);
      replaceTaskVersionFiles(task.id, currentVersion.id, uploadedFiles);
      setSelectedFileIndex(0);
    } catch (error) {
      console.error('Failed to repair task files', error);
      setRepairError(error instanceof Error ? error.message : 'Could not upload replacement files. Please try again.');
    } finally {
      setIsRepairingFiles(false);
    }
  };

  const addReviewNoteSection = () => {
    setReviewNotes(prev => [...prev, { id: Math.random().toString(36).substring(7), note: '' }]);
  };

  const updateReviewNote = (id: string, note: string) => {
    setReviewNotes(prev => prev.map(section => section.id === id ? { ...section, note } : section));
  };

  const updateReviewNoteImage = (id: string, file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setReviewNotes(prev => prev.map(section => section.id === id ? {
        ...section,
        imageName: file.name,
        imageUrl: typeof reader.result === 'string' ? reader.result : undefined,
      } : section));
    };
    reader.readAsDataURL(file);
  };

  const addADRejectNoteSection = () => {
    setAdRejectNotes(prev => [...prev, { id: Math.random().toString(36).substring(7), note: '' }]);
  };

  const updateADRejectNote = (id: string, note: string) => {
    setAdRejectNotes(prev => prev.map(section => section.id === id ? { ...section, note } : section));
  };

  const updateADRejectNoteImage = (id: string, file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setAdRejectNotes(prev => prev.map(section => section.id === id ? {
        ...section,
        imageName: file.name,
        imageUrl: typeof reader.result === 'string' ? reader.result : undefined,
      } : section));
    };
    reader.readAsDataURL(file);
  };

  const getFilledReviewSections = () => reviewNotes
    .filter(section => section.note.trim() || section.imageUrl)
    .map(section => ({ ...section, note: section.note.trim() }));

  const getFilledADRejectSections = () => adRejectNotes
    .filter(section => section.note.trim() || section.imageUrl)
    .map(section => ({ ...section, note: section.note.trim() }));

  const resetReviewNotes = () => {
    setReviewNotes([{ id: Math.random().toString(36).substring(7), note: '' }]);
  };

  const resetADRejectNotes = () => {
    setAdRejectNotes([{ id: Math.random().toString(36).substring(7), note: '' }]);
  };

  const handleSendToAD = (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const priority = formData.get('priority') as Priority;
    const deadline = formData.get('deadline') as string;
    const note = (formData.get('note') as string)?.trim();
    const sections = getFilledReviewSections();

    if (note || sections.length > 0) {
      addTaskComment(task.id, {
        authorId: currentUser.id,
        action: 'sent_to_marwa',
        message: note,
        sections,
      });
    }
    
    updateTaskPriority(task.id, priority, deadline);
    updateTaskStatus(task.id, 'sent_to_art_director', 'art_director');
    resetReviewNotes();
    setModal(null);
  };

  const handleRequestChanges = (e: React.FormEvent) => {
    e.preventDefault();
    const sections = getFilledReviewSections();
    if (sections.length === 0) return;
    addTaskComment(task.id, {
      authorId: currentUser.id,
      action: 'request_edits',
      sections,
    });
    updateTaskStatus(task.id, 'changes_requested_by_reviewer', 'team_member');
    resetReviewNotes();
  };

  const handleADReject = (e: React.FormEvent) => {
    e.preventDefault();
    const message = adRejectComment.trim();
    const marwaSections = getFilledADRejectSections();
    if (!message && selectedMinaFeedback.length === 0 && marwaSections.length === 0) return;

    const forwardedSections: TaskCommentSection[] = selectedMinaFeedback.map(item => ({
      id: Math.random().toString(36).substring(7),
      note: item.note ? `Mina note: ${item.note}` : 'Mina attached this screen for edits.',
      imageName: item.imageName,
      imageUrl: item.imageUrl,
    }));

    addTaskComment(task.id, {
      authorId: currentUser.id,
      action: 'marwa_rejection',
      message: message || 'Forwarded selected notes from Mina.',
      sections: [...forwardedSections, ...marwaSections],
    });
    updateTaskStatus(task.id, 'changes_requested_by_art_director', 'team_member');
    setAdRejectComment('');
    resetADRejectNotes();
    setSelectedMinaFeedbackIds([]);
    setModal(null);
  };

  const handleADApprove = () => {
    updateTaskStatus(task.id, 'approved_by_art_director', null);
  };

  const renderReviewNotes = () => (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-500">Notes and Screens</h4>
        <button type="button" onClick={addReviewNoteSection} className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-black text-indigo-600 shadow-sm ring-1 ring-slate-200 hover:bg-indigo-50">
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>

      {reviewNotes.map((section, index) => (
        <div key={section.id} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-[96px,1fr]">
          <label className="flex h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-500 hover:border-indigo-400 hover:bg-indigo-50">
            {section.imageUrl ? (
              <button type="button" onClick={(event) => { event.preventDefault(); setLightboxUrl(section.imageUrl || null); }} className="h-full w-full overflow-hidden rounded-lg">
                <img src={section.imageUrl} alt={section.imageName || `Screen ${index + 1}`} className="h-full w-full object-cover" />
              </button>
            ) : (
              <>
                <Upload className="h-5 w-5" />
                <span className="text-[10px] font-black uppercase">Screen</span>
              </>
            )}
            <input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" className="hidden" onChange={event => updateReviewNoteImage(section.id, event.target.files?.[0])} />
          </label>

          <textarea
            rows={3}
            value={section.note}
            onChange={event => updateReviewNote(section.id, event.target.value)}
            placeholder={`Note ${index + 1}`}
            className="min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      ))}
    </div>
  );

  const renderADRejectNotes = () => (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-500">Notes and Screens</h4>
        <button type="button" onClick={addADRejectNoteSection} className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-black text-indigo-600 shadow-sm ring-1 ring-slate-200 hover:bg-indigo-50">
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>

      {adRejectNotes.map((section, index) => (
        <div key={section.id} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-[96px,1fr]">
          <label className="flex h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-500 hover:border-indigo-400 hover:bg-indigo-50">
            {section.imageUrl ? (
              <button type="button" onClick={(event) => { event.preventDefault(); setLightboxUrl(section.imageUrl || null); }} className="h-full w-full overflow-hidden rounded-lg">
                <img src={section.imageUrl} alt={section.imageName || `Screen ${index + 1}`} className="h-full w-full object-cover" />
              </button>
            ) : (
              <>
                <Upload className="h-5 w-5" />
                <span className="text-[10px] font-black uppercase">Screen</span>
              </>
            )}
            <input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" className="hidden" onChange={event => updateADRejectNoteImage(section.id, event.target.files?.[0])} />
          </label>

          <textarea
            rows={3}
            value={section.note}
            onChange={event => updateADRejectNote(section.id, event.target.value)}
            placeholder={`Note ${index + 1}`}
            className="min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      ))}
    </div>
  );

  const colorStyles = {
    amber: "bg-amber-50 border-amber-200 text-amber-800",
    blue: "bg-blue-50 border-blue-200 text-blue-800",
    green: "bg-emerald-50 border-emerald-200 text-emerald-800",
    red: "bg-rose-50 border-rose-200 text-rose-800",
    gray: "bg-slate-50 border-slate-200 text-slate-800",
    purple: "bg-indigo-50 border-indigo-200 text-indigo-800",
  };

  return (
    <div className="relative flex min-h-full flex-col bg-[#f8fafc] text-slate-900 md:h-[100dvh] md:flex-row md:border-l md:border-slate-200">
      {/* Left Side: Media Preview */}
      <div className="relative flex min-h-[42dvh] flex-col bg-slate-100 md:min-h-0 md:flex-1 md:overflow-hidden md:border-r md:border-slate-200">
        <div className="absolute top-4 left-4 z-10 hidden md:block">
          <button 
            onClick={onBack}
            className="flex items-center gap-2 bg-white/90 backdrop-blur text-sm font-bold px-4 py-2 rounded-lg shadow-sm hover:bg-white text-slate-700 hover:text-indigo-600 border border-slate-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Dashboard
          </button>
        </div>
        
        {task.environment === 'demo' && (
          <div className="absolute top-0 inset-x-0 bg-purple-100 text-purple-700 text-xs font-bold py-1.5 text-center border-b border-purple-200 z-10">
            DEMO TASK — This task is safe to test. Actions here will not notify production users.
          </div>
        )}

        <div className="mt-0 flex flex-1 flex-col gap-4 overflow-auto p-4 pt-16 sm:p-6 sm:pt-16 md:mt-10 md:min-h-0 md:p-8">
          <div className="flex h-[calc(100dvh-9rem)] min-h-[48vh] flex-none items-center justify-center overflow-hidden rounded-xl bg-slate-100 md:min-h-0">
            <FilePreview file={selectedFile} onImageClick={setLightboxUrl} />
          </div>

          {currentVersionHasLocalOnlyFiles && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-black">This file is local-only</p>
                  <p className="mt-1 text-xs font-semibold text-amber-700">
                    Re-upload the original file here to make it visible on every device.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => repairInputRef.current?.click()}
                  disabled={isRepairingFiles}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-black uppercase tracking-wide text-white shadow-sm transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-300"
                >
                  {isRepairingFiles ? 'Uploading...' : 'Re-upload File'}
                </button>
              </div>
              <input
                ref={repairInputRef}
                type="file"
                multiple
                accept=".png,.jpg,.jpeg,.mp4,.pdf,image/png,image/jpeg,video/mp4,application/pdf"
                className="hidden"
                onChange={event => {
                  handleRepairFiles(Array.from(event.target.files || []));
                  event.target.value = '';
                }}
              />
              {repairError && <p className="mt-3 text-sm font-bold text-rose-600">{repairError}</p>}
            </div>
          )}

          {files.length > 1 && (
            <div className="flex gap-3 overflow-x-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              {files.map((file, index) => {
                const kind = getFileKind(file);
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => setSelectedFileIndex(index)}
                    className={cn(
                      "flex min-w-32 max-w-40 items-center gap-2 rounded-lg border p-2 text-left transition-colors",
                      selectedFileIndex === index ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"
                    )}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100 text-slate-500">
                      {kind === 'image' && <img src={file.url} alt={file.name} className="h-full w-full object-cover" />}
                      {kind === 'pdf' && (
                        <iframe
                          src={getPdfPreviewUrl(file.url)}
                          title={`${file.name} preview`}
                          className="pointer-events-none h-[240%] w-[240%] origin-top-left scale-[0.42] border-0 bg-white"
                        />
                      )}
                      {!['image', 'pdf'].includes(kind) && <span className="text-[10px] font-black uppercase">{kind}</span>}
                    </div>
                    <span className="truncate text-xs font-bold text-slate-700">{file.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Side: Info & Actions */}
      <div className="w-full shrink-0 overflow-y-auto bg-white md:w-[420px] lg:w-[450px] md:border-l md:border-slate-200">
        <div className="border-b border-slate-200 p-4 sm:p-6">
          <button onClick={onBack} className="flex items-center gap-1 text-slate-400 hover:text-indigo-600 mb-4 md:hidden text-sm font-bold">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>

          <h2 className="text-2xl font-black text-slate-900 leading-tight mb-2">{task.name}</h2>
          <p className="text-sm font-mono text-slate-500 mb-6 font-bold">{task.code} · Version {currentVersion?.versionNumber || 1}</p>

          <div className="mb-6 grid grid-cols-1 gap-y-4 text-sm sm:grid-cols-2">
            <div>
              <span className="block text-[11px] font-black uppercase text-slate-400 tracking-wider mb-1">Created by</span>
              <span className="font-semibold text-slate-900">{creator}</span>
            </div>
            <div>
              <span className="block text-[11px] font-black uppercase text-slate-400 tracking-wider mb-1">Handled by</span>
              <span className="font-semibold text-slate-900">{handledByNames}</span>
            </div>
            <div>
              <span className="block text-[11px] font-black uppercase text-slate-400 tracking-wider mb-1">Task type</span>
              <span className="font-semibold text-slate-900">{getTaskTypeLabel(task.taskType)}</span>
            </div>
            <div>
              <span className="block text-[11px] font-black uppercase text-slate-400 tracking-wider mb-1">Review mode</span>
              <span className="font-semibold text-slate-900">{getReviewModeLabel(task.reviewMode)}</span>
            </div>
            <div>
              <span className="block text-[11px] font-black uppercase text-slate-400 tracking-wider mb-1">Environment</span>
              <span className="font-semibold text-slate-900 capitalize">{task.environment}</span>
            </div>
          </div>
          
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex flex-col gap-3">
            <div>
              <span className="block text-[11px] uppercase tracking-wider text-slate-400 font-black mb-2">Current Status</span>
              <span className={cn(
                "inline-block px-3 py-1.5 text-[11px] font-black uppercase tracking-wider rounded-lg border",
                colorStyles[statusInfo.color] || colorStyles.gray
              )}>
                {statusInfo.label}
              </span>
            </div>
            <div className="pt-2 mt-1 border-t border-slate-200">
              <span className="block text-[11px] uppercase tracking-wider text-slate-400 font-black mb-1">Next Action</span>
              <span className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
                {nextAction}
              </span>
            </div>
          </div>
        </div>

        {/* Actions Section */}
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-white p-4 sm:p-6">
          {canResubmitVersion && (
            <form onSubmit={handleResubmitVersion} className="space-y-4 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4">
              <div>
                <h3 className="text-sm font-black text-indigo-950">Upload New Version</h3>
                <p className="mt-1 text-xs font-semibold text-indigo-800/70">
                  Add the edited files here. This keeps the same task and creates V{Math.max(0, ...task.versions.map(version => version.versionNumber)) + 1}.
                </p>
              </div>

              <div
                role="button"
                tabIndex={0}
                onClick={() => resubmitInputRef.current?.click()}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') resubmitInputRef.current?.click();
                }}
                onDragOver={event => event.preventDefault()}
                onDrop={event => {
                  event.preventDefault();
                  appendResubmitFiles(Array.from(event.dataTransfer.files || []));
                }}
                className="cursor-pointer rounded-xl border-2 border-dashed border-indigo-200 bg-white p-5 text-center transition-colors hover:border-indigo-500 hover:bg-indigo-50"
              >
                <Upload className="mx-auto mb-2 h-6 w-6 text-indigo-500" />
                <p className="text-sm font-black text-slate-900">Upload revised files</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">PNG, JPG, MP4 or PDF (max. 200MB)</p>
                <input
                  ref={resubmitInputRef}
                  type="file"
                  multiple
                  accept=".png,.jpg,.jpeg,.mp4,.pdf,image/png,image/jpeg,video/mp4,application/pdf"
                  className="hidden"
                  onChange={event => {
                    appendResubmitFiles(Array.from(event.target.files || []));
                    event.target.value = '';
                  }}
                />
              </div>

              {resubmitFiles.length > 0 && (
                <div className="space-y-2">
                  {resubmitFiles.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <FileIcon className="h-4 w-4 shrink-0 text-indigo-500" />
                        <span className="truncate text-xs font-bold text-slate-800">{file.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setResubmitFiles(prev => prev.filter((_, fileIndex) => fileIndex !== index))}
                        className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        aria-label={`Remove ${file.name}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <textarea
                rows={3}
                value={resubmitNote}
                onChange={event => setResubmitNote(event.target.value)}
                placeholder="Optional note for this version"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
              />

              {resubmitError && <p className="text-sm font-bold text-rose-600">{resubmitError}</p>}

              <button
                type="submit"
                disabled={resubmitFiles.length === 0 || isResubmitting}
                className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-black text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isResubmitting ? 'Uploading...' : `Submit V${Math.max(0, ...task.versions.map(version => version.versionNumber)) + 1}`}
              </button>
            </form>
          )}
          
          {currentUser.role === 'reviewer' && isReviewerActionable && (
            <>
              <button 
                onClick={() => setModal('send_to_ad')}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-xl shadow-sm transition-all focus:ring-4 focus:ring-indigo-100"
              >
                {task.status === 'waiting_reviewer_full_review' ? 'Approve & Send to Marwa' : 
                 task.status === 'waiting_reviewer_quick_look' ? 'Quick Look Done & Send to Marwa' : 'Send to Marwa'}
              </button>
              {isDetailedReviewType && task.status !== 'draft' && (
                <form onSubmit={handleRequestChanges} className="space-y-3 rounded-2xl border border-rose-100 bg-rose-50/40 p-3">
                  <div>
                    <h3 className="text-sm font-black text-rose-900">Request Edits</h3>
                    <p className="mt-1 text-xs font-semibold text-rose-700/70">Add notes and optional screens for what needs editing.</p>
                  </div>
                  {renderReviewNotes()}
                  <button 
                    type="submit"
                    disabled={getFilledReviewSections().length === 0}
                    className="w-full rounded-xl bg-slate-900 px-4 py-3 font-black text-white shadow-sm transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    Request Edits
                  </button>
                </form>
              )}
            </>
          )}

          {currentUser.role === 'reviewer' && task.status === 'sent_to_art_director' && (
            <div className="text-sm font-medium text-gray-500 flex items-center gap-2 justify-center py-2">
              <Check className="w-4 h-4" /> Sent to Marwa
            </div>
          )}

          {currentUser.role === 'art_director' && ['sent_to_art_director', 'waiting_art_director_approval', 'reviewer_approved'].includes(task.status) && (
            <>
              <button 
                onClick={handleADApprove}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-4 rounded-xl shadow-sm transition-all focus:ring-4 focus:ring-emerald-100 flex items-center justify-center gap-2"
              >
                <Check className="w-5 h-5" /> Approve
              </button>
              <button 
                onClick={() => {
                  setSelectedMinaFeedbackIds([]);
                  resetADRejectNotes();
                  setModal('ad_reject');
                }}
                className="w-full bg-white hover:bg-rose-50 text-rose-600 font-bold py-3 px-4 rounded-xl border border-rose-200 shadow-sm transition-all focus:ring-4 focus:ring-rose-100 flex items-center justify-center gap-2"
              >
                <X className="w-5 h-5" /> Reject
              </button>
            </>
          )}

          {currentUser.role === 'art_director' && task.status === 'approved_by_art_director' && (
            <>
              <div className="bg-green-50 text-green-700 border border-green-200 rounded-xl p-4 mb-2 flex items-start gap-3">
                <Check className="w-5 h-5 flex-shrink-0 mt-0.5 text-green-600" />
                <div>
                  <div className="font-semibold mb-1">Approved by You</div>
                  <div className="text-xs">At {new Date(task.updatedAt).toLocaleString()}</div>
                </div>
              </div>
              <button 
                onClick={() => {
                  setSelectedMinaFeedbackIds([]);
                  resetADRejectNotes();
                  setModal('ad_reject');
                }}
                className="w-full bg-white hover:bg-gray-50 text-gray-700 font-semibold py-2 px-4 rounded-lg border border-gray-200 shadow-sm transition-all text-sm"
              >
                Reject / Reopen
              </button>
            </>
          )}

        </div>

        <div className="flex-1 bg-slate-50 p-4 sm:p-6">
          <h3 className="text-[11px] font-black text-slate-400 mb-4 uppercase tracking-wider flex items-center gap-2"><Clock className="w-4 h-4 text-slate-400"/> VERSION HISTORY</h3>
          <div className="space-y-4 relative before:absolute before:inset-0 before:ml-2 md:before:mx-auto before:-translate-x-px md:before:translate-x-0 before:h-full before:w-[2px] before:bg-slate-200">
            {task.versions.map((v, i) => (
              <div key={v.id} className="relative flex items-start gap-4">
                <div className="flex-shrink-0 w-4 h-4 rounded-full bg-white border-4 border-indigo-500 z-10 mt-1"></div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex-1">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-sm text-slate-900">Version {v.versionNumber}</span>
                    <span className="text-xs font-bold text-slate-400">{new Date(v.createdAt).toLocaleDateString()}</span>
                  </div>
                  {v.submissionNote && <p className="text-sm text-slate-600 mt-2 font-medium">"{v.submissionNote}"</p>}
                </div>
              </div>
            ))}
          </div>

          {visibleComments.length > 0 && (
            <div className="mt-6 border-t border-slate-200 pt-5">
              <h3 className="mb-4 text-[11px] font-black uppercase tracking-wider text-slate-400">Comments</h3>
              <div className="space-y-3">
                {visibleComments.map(comment => {
                  const author = initialUsers.find(user => user.id === comment.authorId);
                  return (
                    <div key={comment.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-black text-slate-900">{author?.name || 'Unknown'}</p>
                          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                            {comment.action.replaceAll('_', ' ')}
                          </p>
                        </div>
                        <span className="text-[10px] font-bold text-slate-400">{new Date(comment.createdAt).toLocaleString()}</span>
                      </div>

                      {comment.message && <p className="mb-3 text-sm font-medium text-slate-700">{comment.message}</p>}

                      {comment.sections.length > 0 && (
                        <div className="space-y-3">
                          {comment.sections.map(section => (
                            <div key={section.id} className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-[88px,1fr]">
                              {section.imageUrl && (
                                <button type="button" onClick={() => setLightboxUrl(section.imageUrl || null)} className="h-20 overflow-hidden rounded-lg border border-slate-200 bg-white">
                                  <img src={section.imageUrl} alt={section.imageName || 'Comment screen'} className="h-full w-full object-cover" />
                                </button>
                              )}
                              {section.note && <p className="text-sm font-medium text-slate-700">{section.note}</p>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          </div>

          <div className="mt-4">
            {isArchived ? (
              <button
                type="button"
                onClick={() => unarchiveTask(task.id)}
                className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700 transition-colors hover:bg-emerald-100"
              >
                Unarchive Task
              </button>
            ) : (
              <button
                type="button"
                onClick={() => archiveTask(task.id)}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-600 transition-colors hover:bg-slate-50"
              >
                Archive Task
              </button>
            )}
          </div>

        </div>

      {/* MODALS */}
      {modal === 'send_to_ad' && (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-slate-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="text-lg font-black text-slate-900">Approve & Send to Marwa</h3>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-indigo-600 transition-colors"><X className="w-5 h-5"/></button>
            </div>
            <form onSubmit={handleSendToAD} className="p-6 space-y-5">
              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">Priority *</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <label className="cursor-pointer">
                    <input type="radio" name="priority" value="low" className="peer sr-only" required />
                    <div className="text-center text-sm font-bold py-2 px-1 rounded-lg border border-slate-200 text-slate-500 peer-checked:bg-slate-900 peer-checked:text-white peer-checked:border-slate-900 transition-colors">Low</div>
                  </label>
                  <label className="cursor-pointer">
                    <input type="radio" name="priority" value="normal" className="peer sr-only" defaultChecked />
                    <div className="text-center text-sm font-bold py-2 px-1 rounded-lg border border-slate-200 text-slate-500 peer-checked:bg-indigo-600 peer-checked:text-white peer-checked:border-indigo-600 transition-colors">Normal</div>
                  </label>
                  <label className="cursor-pointer">
                    <input type="radio" name="priority" value="high" className="peer sr-only" />
                    <div className="text-center text-sm font-bold py-2 px-1 rounded-lg border border-slate-200 text-slate-500 peer-checked:bg-amber-500 peer-checked:text-white peer-checked:border-amber-500 transition-colors">High</div>
                  </label>
                  <label className="cursor-pointer">
                    <input type="radio" name="priority" value="urgent" className="peer sr-only" />
                    <div className="text-center text-sm font-bold py-2 px-1 rounded-lg border border-slate-200 text-slate-500 peer-checked:bg-rose-500 peer-checked:text-white peer-checked:border-rose-500 transition-colors">Urgent</div>
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1">Deadline</label>
                <input type="text" name="deadline" placeholder="e.g. Before Thursday 8 PM" className="w-full border border-slate-300 rounded-lg px-4 py-2 text-sm font-bold text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none" />
              </div>
              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1">Reviewer Note (Optional)</label>
                <textarea name="note" rows={2} className="w-full border border-slate-300 rounded-lg px-4 py-2 text-sm font-medium text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"></textarea>
              </div>
              {renderReviewNotes()}
              <div className="pt-2">
                <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3 px-4 rounded-xl shadow-sm transition-colors">Send to Marwa</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modal === 'ad_reject' && (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="max-h-[92vh] w-full max-w-lg overflow-hidden rounded-2xl border border-rose-200 bg-white shadow-xl">
            <div className="p-6 border-b border-rose-100 bg-rose-50 flex justify-between items-center">
              <h3 className="text-lg font-black text-rose-900 flex items-center gap-2"><AlertCircle className="w-5 h-5"/> Reject Task</h3>
              <button
                onClick={() => {
                  setSelectedMinaFeedbackIds([]);
                  resetADRejectNotes();
                  setModal(null);
                }}
                className="text-rose-400 hover:text-rose-600 transition-colors"
              >
                <X className="w-5 h-5"/>
              </button>
            </div>
            <form onSubmit={handleADReject} className="max-h-[calc(92vh-81px)] space-y-5 overflow-y-auto p-6">
              {minaForwardableFeedback.length > 0 && (
                <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <h4 className="text-[11px] font-black uppercase tracking-wider text-slate-500">Mina's Internal Notes</h4>
                    <p className="mt-1 text-xs font-semibold text-slate-500">Select what should be sent to the task creator.</p>
                  </div>
                  <div className="space-y-2">
                    {minaForwardableFeedback.map(item => {
                      const checked = selectedMinaFeedbackIds.includes(item.id);
                      return (
                        <label key={item.id} className="flex cursor-pointer gap-3 rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-indigo-300">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={event => {
                              setSelectedMinaFeedbackIds(prev => (
                                event.target.checked
                                  ? [...prev, item.id]
                                  : prev.filter(id => id !== item.id)
                              ));
                            }}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{item.label}</p>
                            {item.note && <p className="mt-1 text-sm font-semibold text-slate-800">{item.note}</p>}
                            {item.imageUrl && (
                              <button
                                type="button"
                                onClick={event => {
                                  event.preventDefault();
                                  setLightboxUrl(item.imageUrl || null);
                                }}
                                className="mt-2 h-20 w-28 overflow-hidden rounded-lg border border-slate-200 bg-white"
                              >
                                <img src={item.imageUrl} alt={item.imageName || 'Mina note screen'} className="h-full w-full object-cover" />
                              </button>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-[11px] font-black text-slate-400 uppercase tracking-wider mb-1">Marwa's Comment</label>
                <textarea value={adRejectComment} onChange={event => setAdRejectComment(event.target.value)} rows={3} placeholder="Write new feedback, or select Mina's notes above, or do both..." className="w-full border border-slate-300 rounded-lg px-4 py-2 text-sm font-medium text-slate-900 focus:ring-2 focus:ring-rose-500 outline-none"></textarea>
              </div>
              {renderADRejectNotes()}
              <div className="pt-2">
                <button type="submit" disabled={!canSubmitADReject} className="w-full bg-rose-600 hover:bg-rose-700 text-white font-black py-3 px-4 rounded-xl shadow-sm transition-colors disabled:cursor-not-allowed disabled:bg-slate-300">Reject and Return</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {lightboxUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4" onClick={() => setLightboxUrl(null)}>
          <button type="button" className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" onClick={() => setLightboxUrl(null)}>
            <X className="h-6 w-6" />
          </button>
          <img src={lightboxUrl} alt="Full screen preview" className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" onClick={event => event.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
