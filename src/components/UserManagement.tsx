import { ShieldCheck, UserRoundCog } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { userRoleLabels } from '../lib/mockData';
import type { Role } from '../lib/types';

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
  const { currentUser, userList, accountProfiles, updateUserRole } = useAppStore();
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
        <div className="grid grid-cols-[minmax(0,1fr)_150px] border-b border-slate-100 bg-slate-50 px-4 py-3 text-[11px] font-black uppercase tracking-wider text-slate-400 sm:grid-cols-[minmax(0,1fr)_180px_210px]">
          <span>User</span>
          <span className="hidden sm:block">Account</span>
          <span>Responsibility</span>
        </div>
        <div className="divide-y divide-slate-100">
          {userList.map(user => (
            <div
              key={user.id}
              className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_180px_210px]"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-indigo-100 text-sm font-black uppercase text-indigo-900">
                  {user.avatar ? <img src={user.avatar} alt="" className="h-full w-full object-cover" /> : user.name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-slate-950">{user.name}</p>
                  <p className="truncate text-xs font-semibold text-slate-500">{user.email || user.jobTitle || userRoleLabels[user.role]}</p>
                </div>
              </div>
              <div className="hidden text-xs font-bold text-slate-500 sm:block">
                {registeredIds.has(user.id) ? 'Self-created' : 'Seeded'}
              </div>
              <select
                value={user.role}
                onChange={event => updateUserRole(user.id, event.target.value as Role)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-black text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
              >
                {roleOptions.map(role => (
                  <option key={role} value={role}>
                    {userRoleLabels[role]}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
