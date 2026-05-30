import { ShieldCheck, Trash2, UserRoundCog } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { userRoleLabels } from '../lib/mockData';
import type { Role } from '../lib/types';
import { CustomSelect } from './CustomSelect';

const roleOptions: Role[] = [
  'team_member',
  'reviewer',
  'art_director',
  'team_leader',
  'manager',
  'developer',
  'marketing_manager',
  'admin',
];

export function UserManagement() {
  const { currentUser, userList, accountProfiles, updateUserRole, deleteUserAccount } = useAppStore();
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
  const selectOptions = roleOptions.map(role => ({ value: role, label: userRoleLabels[role] }));

  const confirmDelete = (userId: string, name: string) => {
    if (!window.confirm(`Delete ${name}'s account? This removes their self-created login from this browser.`)) return;
    deleteUserAccount(userId);
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
                  value={user.role}
                  onChange={value => updateUserRole(user.id, value as Role)}
                  options={selectOptions}
                  buttonClassName="min-h-10 rounded-xl border-slate-200 px-3 py-2.5 text-sm font-black text-slate-900 shadow-sm hover:bg-slate-50 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                  menuClassName="rounded-xl border-slate-200 bg-white shadow-xl"
                />
              </div>
              <div className="flex justify-start lg:justify-end">
                {registeredIds.has(user.id) ? (
                  <button
                    type="button"
                    onClick={() => confirmDelete(user.id, user.name)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-rose-100 bg-rose-50 text-rose-600 transition-colors hover:bg-rose-100 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                    aria-label={`Delete ${user.name}`}
                    title={`Delete ${user.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : (
                  <span className="text-xs font-bold text-slate-400">Seeded</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
