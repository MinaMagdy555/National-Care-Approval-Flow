import { Edit3, Plus, ShieldCheck, Trash2, UserRoundCog, X } from 'lucide-react';
import { useState } from 'react';
import { useAppStore } from '../lib/store';
import { CustomSelect } from './CustomSelect';
import { AppSettings, Role, User } from '../lib/types';
import { isLeaderboardUser } from '../lib/workAssignmentUtils';

const JOB_TITLE_OPTIONS: Array<{ value: string; label: string; permissionRole: Role }> = [
  { value: 'senior_brand_designer_video_editor', label: 'Senior Brand Designer & Video Editor', permissionRole: 'reviewer' },
  { value: 'graphic_designer', label: 'Graphic Designer', permissionRole: 'team_member' },
  { value: 'content_creator', label: 'Content Creator', permissionRole: 'team_member' },
  { value: 'senior_content_creator', label: 'Senior Content Creator', permissionRole: 'team_member' },
  { value: 'video_editor', label: 'Video Editor', permissionRole: 'team_member' },
  { value: 'art_director', label: 'Art Director', permissionRole: 'art_director' },
  { value: 'team_leader', label: 'Team Leader', permissionRole: 'team_leader' },
  { value: 'manager', label: 'Manager', permissionRole: 'manager' },
  { value: 'developer', label: 'Developer', permissionRole: 'developer' },
  { value: 'marketing_manager', label: 'Marketing Manager', permissionRole: 'marketing_manager' },
  { value: 'hr', label: 'HR', permissionRole: 'team_member' },
];

function normalizeLabel(value: string) {
  return value.trim().toLowerCase();
}

function getJobTitleOption(value: string) {
  const normalized = normalizeLabel(value);
  return JOB_TITLE_OPTIONS.find(option => normalizeLabel(option.label) === normalized || option.value === normalized);
}

function getPermissionRoleForJobTitle(title: string, fallback: Role): Role {
  const exactMatch = getJobTitleOption(title);
  if (exactMatch) return exactMatch.permissionRole;

  const normalized = normalizeLabel(title);
  if (normalized.includes('art director')) return 'art_director';
  if (normalized.includes('team leader')) return 'team_leader';
  if (normalized.includes('marketing manager')) return 'marketing_manager';
  if (normalized.includes('manager')) return 'manager';
  if (normalized.includes('developer')) return 'developer';
  return fallback;
}

function splitCapabilities(value?: string) {
  return (value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function uniqueLabels(values: string[]) {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function UserManagement() {
  const {
    currentUser,
    userList,
    accountProfiles,
    appSettings,
    createManualUser,
    updateUserProfile,
    addCustomResponsibility,
    deleteUserAccount,
    updateAppSettings,
  } = useAppStore();
  const [newResponsibility, setNewResponsibility] = useState('');
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isMemberModalOpen, setIsMemberModalOpen] = useState(false);
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState<Role>('team_member');
  const [memberTitle, setMemberTitle] = useState('');
  const [memberPassword, setMemberPassword] = useState('');
  const [memberTags, setMemberTags] = useState<string[]>([]);
  const [memberTagInput, setMemberTagInput] = useState('');
  const canManageUsers = Boolean(currentUser.isAdmin) || currentUser.role === 'admin' || isLeaderboardUser(currentUser.id);

  if (!canManageUsers) {
    return (
      <div className="p-6 lg:p-8">
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm font-bold text-slate-600">
          You do not have access to manage members roles and positions.
        </div>
      </div>
    );
  }

  const registeredIds = new Set(accountProfiles.map(profile => profile.id));
  const manualIds = new Set((appSettings.manualUsers || []).map(user => user.id));
  const tagOptions = uniqueLabels([
    ...appSettings.responsibilities.map(responsibility => responsibility.label),
    ...userList.flatMap(user => splitCapabilities(user.jobTitle)),
  ]);

  const confirmDelete = (userId: string, name: string) => {
    if (!window.confirm(`Delete ${name}'s account? This removes the user from the tool and removes any saved email login for them.`)) return;
    deleteUserAccount(userId);
  };

  const handleAddResponsibility = () => {
    const label = newResponsibility.trim();
    if (!label) return;
    addCustomResponsibility(label);
    setNewResponsibility('');
  };

  const openMemberModal = (user?: User) => {
    const parts = splitCapabilities(user?.jobTitle);
    setEditingUser(user || null);
    setMemberName(user?.name || '');
    setMemberEmail(user?.email || '');
    setMemberRole(user?.role || 'team_member');
    setMemberTitle(parts[0] || user?.jobTitle || '');
    setMemberPassword('');
    setMemberTags(parts.slice(1));
    setMemberTagInput('');
    setIsMemberModalOpen(true);
  };

  const closeMemberModal = () => {
    setIsMemberModalOpen(false);
    setEditingUser(null);
    setMemberName('');
    setMemberEmail('');
    setMemberRole('team_member');
    setMemberTitle('');
    setMemberPassword('');
    setMemberTags([]);
    setMemberTagInput('');
  };

  const addMemberTag = (value: string) => {
    const label = value.trim();
    if (!label) return;
    setMemberTags(prev => uniqueLabels([...prev, label]));
    setMemberTagInput('');
  };

  const removeMemberTag = (value: string) => {
    setMemberTags(prev => prev.filter(item => item.toLowerCase() !== value.toLowerCase()));
  };

  const saveMember = () => {
    const name = memberName.trim();
    const title = memberTitle.trim();
    if (!name || !title) return;

    const tags = uniqueLabels(memberTags);
    tags.forEach(tag => {
      if (!appSettings.responsibilities.some(responsibility => responsibility.label.toLowerCase() === tag.toLowerCase())) {
        addCustomResponsibility(tag);
      }
    });

    const jobTitle = uniqueLabels([title, ...tags]).join(', ');
    const payload = {
      name,
      email: memberEmail.trim() || undefined,
      role: getPermissionRoleForJobTitle(title, memberRole),
      jobTitle,
      password: memberPassword.trim() || undefined,
    };

    if (editingUser) {
      updateUserProfile(editingUser.id, payload);
    } else {
      createManualUser(payload);
    }
    closeMemberModal();
  };

  const togglePermission = (userId: string, key: keyof AppSettings) => {
    updateAppSettings(settings => {
      const list = (settings[key] as string[]) || [];
      const next = list.includes(userId)
        ? list.filter(id => id !== userId)
        : [...list, userId];
      return {
        ...settings,
        [key]: next
      };
    });
  };

  return (
    <div className="space-y-5 p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white">
            <UserRoundCog className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-black text-slate-950">Members Roles and Positions</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            Add members, set roles, positions, and responsibilities, and keep the team list updated.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black uppercase tracking-wide text-emerald-700">
            <ShieldCheck className="h-4 w-4" />
            Admin Access
          </div>
          <button
            type="button"
            onClick={() => openMemberModal()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            Add Member
          </button>
        </div>
      </div>

      <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[1fr,auto]">
        <input
          type="text"
          value={newResponsibility}
          onChange={event => setNewResponsibility(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              handleAddResponsibility();
            }
          }}
          placeholder="Add role, e.g. Social Media Designer"
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="button"
          onClick={handleAddResponsibility}
          disabled={!newResponsibility.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <Plus className="h-4 w-4" />
          Add Role
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="hidden grid-cols-[minmax(140px,1fr)_minmax(160px,1.1fr)_minmax(180px,1.2fr)_minmax(240px,1.2fr)_120px_112px] gap-4 border-b border-slate-100 bg-slate-50 px-4 py-3 text-[11px] font-black uppercase tracking-wider text-slate-400 lg:grid">
          <span>Name</span>
          <span>Job Title</span>
          <span>Email</span>
          <span>Responsibility</span>
          <span>Permissions</span>
          <span className="text-right">Actions</span>
        </div>
        <div className="divide-y divide-slate-100">
          {userList.map(user => (
            <div
              key={user.id}
              className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(140px,1fr)_minmax(160px,1.1fr)_minmax(180px,1.2fr)_minmax(240px,1.2fr)_120px_112px] lg:items-center"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-indigo-100 text-sm font-black uppercase text-indigo-900">
                  {user.avatar ? <img src={user.avatar} alt="" className="h-full w-full object-cover" /> : user.name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">Name</span>
                  <p className="truncate text-sm font-black text-slate-950">{user.name}</p>
                  {registeredIds.has(user.id) && (
                    <p className="mt-0.5 text-[11px] font-black uppercase tracking-wide text-indigo-500">Self-created</p>
                  )}
                  {manualIds.has(user.id) && (
                    <p className="mt-0.5 text-[11px] font-black uppercase tracking-wide text-amber-600">Manual member</p>
                  )}
                </div>
              </div>
              <div className="min-w-0">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">Job Title</span>
                <p className="truncate text-sm font-bold text-slate-600">{splitCapabilities(user.jobTitle)[0] || appSettings.responsibilities.find(item => item.permissionRole === user.role)?.label || user.role}</p>
              </div>
              <div className="min-w-0">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">Email</span>
                <p className="truncate text-sm font-bold text-slate-600">{user.email || '-'}</p>
              </div>
              <div>
                <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">Responsibility</span>
                <div className="flex flex-wrap gap-1.5">
                  {splitCapabilities(user.jobTitle).length > 0 ? splitCapabilities(user.jobTitle).map(tag => (
                    <span key={tag} className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-1 text-[11px] font-black text-indigo-700">
                      {tag}
                    </span>
                  )) : (
                    <span className="text-xs font-bold text-slate-400">No tags</span>
                  )}
                </div>
              </div>
              <div>
                <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">Permissions</span>
                <button
                  type="button"
                  onClick={() => setExpandedUserId(expandedUserId === user.id ? null : user.id)}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-black uppercase tracking-wide transition-colors ${
                    expandedUserId === user.id
                      ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <UserRoundCog className="h-3.5 w-3.5" />
                  Configure
                </button>
              </div>
              <div className="flex justify-start gap-2 lg:justify-end">
                <button
                  type="button"
                  onClick={() => openMemberModal(user)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  aria-label={`Edit ${user.name}`}
                  title={`Edit ${user.name}`}
                >
                  <Edit3 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => confirmDelete(user.id, user.name)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-rose-100 bg-rose-50 text-rose-600 transition-colors hover:bg-rose-100 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                  aria-label={`Delete ${user.name}`}
                  title={`Delete ${user.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {expandedUserId === user.id && (
                <div className="col-span-full border border-slate-200 bg-slate-50/50 p-4 rounded-2xl mt-2 animate-in fade-in duration-200 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-500">Edit Permissions for {user.name}</h4>
                    <button
                      type="button"
                      onClick={() => setExpandedUserId(null)}
                      className="text-xs font-bold text-slate-400 hover:text-slate-600"
                    >
                      Close
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    <label className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors">
                      <input
                        type="checkbox"
                        checked={appSettings.workAssignmentCreatorIds.includes(user.id)}
                        onChange={() => togglePermission(user.id, 'workAssignmentCreatorIds')}
                        className="mt-1 h-4 w-4 rounded border-slate-300 accent-indigo-600 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <p className="text-xs font-black text-slate-900">Assign Work to Team</p>
                        <p className="text-[10px] font-semibold text-slate-400 mt-0.5 font-medium">Allows user to assign tasks to members.</p>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors">
                      <input
                        type="checkbox"
                        checked={(appSettings.firstReviewerUserIds || []).includes(user.id)}
                        onChange={() => togglePermission(user.id, 'firstReviewerUserIds')}
                        className="mt-1 h-4 w-4 rounded border-slate-300 accent-indigo-600 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <p className="text-xs font-black text-slate-900">First Reviewer (First Rev.)</p>
                        <p className="text-[10px] font-semibold text-slate-400 mt-0.5 font-medium">User acts as first-level reviewer.</p>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors">
                      <input
                        type="checkbox"
                        checked={(appSettings.finalReviewerUserIds || []).includes(user.id)}
                        onChange={() => togglePermission(user.id, 'finalReviewerUserIds')}
                        className="mt-1 h-4 w-4 rounded border-slate-300 accent-indigo-600 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <p className="text-xs font-black text-slate-900">Final Reviewer (Final Rev.)</p>
                        <p className="text-[10px] font-semibold text-slate-400 mt-0.5 font-medium">User acts as final-level reviewer.</p>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors">
                      <input
                        type="checkbox"
                        checked={(appSettings.viewAllWorkloadUserIds || []).includes(user.id)}
                        onChange={() => togglePermission(user.id, 'viewAllWorkloadUserIds')}
                        className="mt-1 h-4 w-4 rounded border-slate-300 accent-indigo-600 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <p className="text-xs font-black text-slate-900">View All Workload</p>
                        <p className="text-[10px] font-semibold text-slate-400 mt-0.5 font-medium">Can view all workload and stats cards.</p>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors">
                      <input
                        type="checkbox"
                        checked={!appSettings.selfAssignmentBlockedIds.includes(user.id)}
                        onChange={() => togglePermission(user.id, 'selfAssignmentBlockedIds')}
                        className="mt-1 h-4 w-4 rounded border-slate-300 accent-indigo-600 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <p className="text-xs font-black text-slate-900">Assign Tasks to Self</p>
                        <p className="text-[10px] font-semibold text-slate-400 mt-0.5 font-medium">Allows user to assign tasks to themselves.</p>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors">
                      <input
                        type="checkbox"
                        checked={!appSettings.neverHandlerIds.includes(user.id)}
                        onChange={() => togglePermission(user.id, 'neverHandlerIds')}
                        className="mt-1 h-4 w-4 rounded border-slate-300 accent-indigo-600 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <p className="text-xs font-black text-slate-900">Can Be Assigned Tasks</p>
                        <p className="text-[10px] font-semibold text-slate-400 mt-0.5 font-medium">Allows assigning tasks to this member.</p>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors">
                      <input
                        type="checkbox"
                        checked={appSettings.videoOnlyHandlerIds.includes(user.id)}
                        onChange={() => togglePermission(user.id, 'videoOnlyHandlerIds')}
                        className="mt-1 h-4 w-4 rounded border-slate-300 accent-indigo-600 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <p className="text-xs font-black text-slate-900">Video Tasks Only</p>
                        <p className="text-[10px] font-semibold text-slate-400 mt-0.5 font-medium">Excludes user from non-video suggestions.</p>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors">
                      <input
                        type="checkbox"
                        checked={appSettings.settingsManagerUserIds.includes(user.id)}
                        onChange={() => togglePermission(user.id, 'settingsManagerUserIds')}
                        className="mt-1 h-4 w-4 rounded border-slate-300 accent-indigo-600 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <p className="text-xs font-black text-slate-900">Manage Tool Settings</p>
                        <p className="text-[10px] font-semibold text-slate-400 mt-0.5 font-medium">Allows managing system configuration details.</p>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors">
                      <input
                        type="checkbox"
                        checked={appSettings.contributorAssignerIds.includes(user.id)}
                        onChange={() => togglePermission(user.id, 'contributorAssignerIds')}
                        className="mt-1 h-4 w-4 rounded border-slate-300 accent-indigo-600 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <p className="text-xs font-black text-slate-900">Assign Contributors</p>
                        <p className="text-[10px] font-semibold text-slate-400 mt-0.5 font-medium">Allows user to manage task contributors.</p>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-3 bg-white border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors">
                      <input
                        type="checkbox"
                        checked={appSettings.alwaysAssignableHandlerIds.includes(user.id)}
                        onChange={() => togglePermission(user.id, 'alwaysAssignableHandlerIds')}
                        className="mt-1 h-4 w-4 rounded border-slate-300 accent-indigo-600 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <p className="text-xs font-black text-slate-900">Always Assignable</p>
                        <p className="text-[10px] font-semibold text-slate-400 mt-0.5 font-medium">Bypasses some assignment check limitations.</p>
                      </div>
                    </label>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {isMemberModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" onClick={closeMemberModal}>
          <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-slate-100 bg-slate-50/60 px-5 py-4">
              <div>
                <h2 className="text-lg font-black text-slate-950">{editingUser ? 'Edit Member' : 'Add Member'}</h2>
                <p className="mt-0.5 text-xs font-semibold text-slate-500">
                  Set the member title and flexible capability tags used for assignment suggestions.
                </p>
              </div>
              <button
                type="button"
                onClick={closeMemberModal}
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close member editor"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[75vh] space-y-5 overflow-y-auto p-5">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Name *
                  <input
                    value={memberName}
                    onChange={event => setMemberName(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  />
                </label>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Email
                  <input
                    type="email"
                    value={memberEmail}
                    onChange={event => setMemberEmail(event.target.value)}
                    placeholder={editingUser && manualIds.has(editingUser.id) ? 'Optional for manual members' : 'Email linked to login profile'}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  />
                </label>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Position / Custom Title *
                  <input
                    value={memberTitle}
                    onChange={event => setMemberTitle(event.target.value)}
                    placeholder="e.g. Graphic Designer"
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  />
                </label>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Job Title
                  <CustomSelect
                    value={getJobTitleOption(memberTitle)?.value || memberTitle}
                    onChange={value => {
                      const option = JOB_TITLE_OPTIONS.find(item => item.value === value);
                      if (!option) return;
                      setMemberTitle(option.label);
                      setMemberRole(option.permissionRole);
                    }}
                    options={JOB_TITLE_OPTIONS.map(({ value, label }) => ({ value, label }))}
                    buttonClassName="mt-1 min-h-10 rounded-xl border-slate-200 px-3 py-2.5 text-sm font-black text-slate-900 shadow-sm hover:bg-slate-50 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    menuClassName="rounded-xl border-slate-200 bg-white shadow-xl"
                  />
                </label>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  {editingUser ? 'Reset Password' : 'Password *'}
                  <input
                    type="text"
                    value={memberPassword}
                    onChange={event => setMemberPassword(event.target.value)}
                    placeholder={editingUser ? 'Leave blank to keep current password' : 'Set the member login password'}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  />
                </label>
              </div>

              <div className="grid gap-4 lg:grid-cols-[1fr,1fr]">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">Available Tags</h3>
                      <p className="mt-0.5 text-[11px] font-semibold text-slate-400">Click or drag tags into the member box.</p>
                    </div>
                  </div>
                  <div className="mb-3 grid gap-2 sm:grid-cols-[1fr,auto]">
                    <input
                      value={memberTagInput}
                      onChange={event => setMemberTagInput(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addMemberTag(memberTagInput);
                        }
                      }}
                      placeholder="Write a new capability"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    />
                    <button
                      type="button"
                      onClick={() => addMemberTag(memberTagInput)}
                      disabled={!memberTagInput.trim()}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      <Plus className="h-4 w-4" />
                      Add
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {tagOptions.map(tag => (
                      <button
                        key={tag}
                        type="button"
                        draggable
                        onDragStart={event => event.dataTransfer.setData('text/plain', tag)}
                        onClick={() => addMemberTag(tag)}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-black text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                <div
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => {
                    event.preventDefault();
                    addMemberTag(event.dataTransfer.getData('text/plain'));
                  }}
                  className="rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 p-4"
                >
                  <h3 className="text-xs font-black uppercase tracking-wider text-indigo-700">Member Responsibilities</h3>
                  <p className="mt-0.5 text-[11px] font-semibold text-indigo-500">Drop tags here or remove any tag that no longer fits.</p>
                  <div className="mt-4 flex min-h-28 flex-wrap content-start gap-2 rounded-xl bg-white/70 p-3">
                    {memberTags.length > 0 ? memberTags.map(tag => (
                      <span key={tag} className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white px-3 py-1 text-xs font-black text-indigo-700">
                        {tag}
                        <button
                          type="button"
                          onClick={() => removeMemberTag(tag)}
                          className="text-indigo-300 transition-colors hover:text-rose-600"
                          aria-label={`Remove ${tag}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    )) : (
                      <span className="text-xs font-bold text-slate-400">No extra tags yet.</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 bg-white px-5 py-4">
              <button
                type="button"
                onClick={closeMemberModal}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 transition-colors hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveMember}
                disabled={!memberName.trim() || !memberTitle.trim() || (!editingUser && !memberPassword.trim())}
                className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-black text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {editingUser ? 'Save Changes' : 'Add Member'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
