import { Plus, ShieldCheck, Trash2, UserRoundCog } from 'lucide-react';
import { useState } from 'react';
import { useAppStore } from '../lib/store';
import { CustomSelect } from './CustomSelect';
import { AppSettings } from '../lib/types';

export function UserManagement() {
  const {
    currentUser,
    userList,
    accountProfiles,
    appSettings,
    updateUserResponsibility,
    addCustomResponsibility,
    deleteUserAccount,
    updateAppSettings,
  } = useAppStore();
  const [newResponsibility, setNewResponsibility] = useState('');
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const canManageUsers = Boolean(currentUser.isAdmin) || currentUser.role === 'admin';

  if (!canManageUsers) {
    return (
      <div className="p-6 lg:p-8">
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm font-bold text-slate-600">
          You do not have access to manage users.
        </div>
      </div>
    );
  }

  const registeredIds = new Set(accountProfiles.map(profile => profile.id));
  const selectOptions = appSettings.responsibilities.map(responsibility => ({ value: responsibility.label, label: responsibility.label }));

  const getPermissionRoleForResponsibility = (responsibility: string) => (
    appSettings.responsibilities.find(item => item.label === responsibility)?.permissionRole || 'team_member'
  );

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
          <h1 className="text-2xl font-black text-slate-950">Users & Roles</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            New accounts appear here so you can assign their responsibility.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black uppercase tracking-wide text-emerald-700">
          <ShieldCheck className="h-4 w-4" />
          Admin Access
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
        <div className="hidden grid-cols-[minmax(140px,1fr)_minmax(140px,1.1fr)_minmax(200px,1.3fr)_minmax(220px,0.9fr)_120px_60px] gap-4 border-b border-slate-100 bg-slate-50 px-4 py-3 text-[11px] font-black uppercase tracking-wider text-slate-400 lg:grid">
          <span>Name</span>
          <span>Job Title</span>
          <span>Email</span>
          <span>Responsibility</span>
          <span>Permissions</span>
          <span className="text-right">Delete</span>
        </div>
        <div className="divide-y divide-slate-100">
          {userList.map(user => (
            <div
              key={user.id}
              className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(140px,1fr)_minmax(140px,1.1fr)_minmax(200px,1.3fr)_minmax(220px,0.9fr)_120px_60px] lg:items-center"
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
                </div>
              </div>
              <div className="min-w-0">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">Job Title</span>
                <p className="truncate text-sm font-bold text-slate-600">{user.jobTitle || appSettings.responsibilities.find(item => item.permissionRole === user.role)?.label || user.role}</p>
              </div>
              <div className="min-w-0">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">Email</span>
                <p className="truncate text-sm font-bold text-slate-600">{user.email || '-'}</p>
              </div>
              <div>
                <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">Responsibility</span>
                <CustomSelect
                  value={user.jobTitle || appSettings.responsibilities.find(item => item.permissionRole === user.role)?.label || user.role}
                  onChange={value => updateUserResponsibility(user.id, value, getPermissionRoleForResponsibility(value))}
                  options={selectOptions}
                  buttonClassName="min-h-10 rounded-xl border-slate-200 px-3 py-2.5 text-sm font-black text-slate-900 shadow-sm hover:bg-slate-50 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                  menuClassName="rounded-xl border-slate-200 bg-white shadow-xl"
                />
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
              <div className="flex justify-start lg:justify-end">
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
    </div>
  );
}
