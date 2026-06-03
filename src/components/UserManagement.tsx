import { Plus, ShieldCheck, Trash2, UserRoundCog } from 'lucide-react';
import { useState } from 'react';
import { useAppStore } from '../lib/store';
import { initialUsers, userRoleLabels } from '../lib/mockData';
import type { Role } from '../lib/types';
import { CustomSelect } from './CustomSelect';

const permissionResponsibilities: Array<{ label: string; role: Role }> = [
  { label: userRoleLabels.reviewer, role: 'reviewer' },
  { label: userRoleLabels.art_director, role: 'art_director' },
  { label: userRoleLabels.team_leader, role: 'team_leader' },
  { label: userRoleLabels.manager, role: 'manager' },
  { label: userRoleLabels.developer, role: 'developer' },
  { label: userRoleLabels.marketing_manager, role: 'marketing_manager' },
  { label: userRoleLabels.admin, role: 'admin' },
];

export function UserManagement() {
  const {
    currentUser,
    userList,
    accountProfiles,
    customResponsibilities,
    updateUserResponsibility,
    addCustomResponsibility,
    deleteUserAccount,
  } = useAppStore();
  const [newResponsibility, setNewResponsibility] = useState('');
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
  const defaultResponsibilities = [
    'Content Creator',
    ...initialUsers.map(user => user.jobTitle || userRoleLabels[user.role]).filter(Boolean),
    ...Object.values(userRoleLabels),
  ];
  const responsibilityLabels = Array.from(new Set([...defaultResponsibilities, ...customResponsibilities]));
  const selectOptions = responsibilityLabels.map(label => ({ value: label, label }));

  const getPermissionRoleForResponsibility = (responsibility: string) => (
    permissionResponsibilities.find(item => item.label === responsibility)?.role || 'team_member'
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
        <div className="hidden grid-cols-[minmax(150px,1fr)_minmax(170px,1fr)_minmax(220px,1.2fr)_minmax(280px,0.9fr)_76px] gap-4 border-b border-slate-100 bg-slate-50 px-4 py-3 text-[11px] font-black uppercase tracking-wider text-slate-400 lg:grid">
          <span>Name</span>
          <span>Job Title</span>
          <span>Email</span>
          <span>Responsibility</span>
          <span className="text-right">Delete</span>
        </div>
        <div className="divide-y divide-slate-100">
          {userList.map(user => (
            <div
              key={user.id}
              className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(150px,1fr)_minmax(170px,1fr)_minmax(220px,1.2fr)_minmax(280px,0.9fr)_76px] lg:items-center"
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
                <p className="truncate text-sm font-bold text-slate-600">{user.jobTitle || userRoleLabels[user.role]}</p>
              </div>
              <div className="min-w-0">
                <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">Email</span>
                <p className="truncate text-sm font-bold text-slate-600">{user.email || '-'}</p>
              </div>
              <div>
                <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-400 lg:hidden">Responsibility</span>
                <CustomSelect
                  value={user.jobTitle || userRoleLabels[user.role]}
                  onChange={value => updateUserResponsibility(user.id, value, getPermissionRoleForResponsibility(value))}
                  options={selectOptions}
                  buttonClassName="min-h-10 rounded-xl border-slate-200 px-3 py-2.5 text-sm font-black text-slate-900 shadow-sm hover:bg-slate-50 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                  menuClassName="rounded-xl border-slate-200 bg-white shadow-xl"
                />
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
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
