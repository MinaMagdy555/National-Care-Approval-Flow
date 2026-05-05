import React, { useMemo, useState } from 'react';
import { Check, ShieldCheck, UserCog, X } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { Role } from '../lib/types';
import { initialUsers, userRoleLabels } from '../lib/mockData';
import { CustomSelect } from './CustomSelect';
import { cn } from '../lib/utils';

const ROLE_OPTIONS: Array<{ value: Role; label: string }> = [
  { value: 'team_member', label: 'Team Member' },
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'art_director', label: 'Art Director' },
  { value: 'team_leader', label: 'Team Leader' },
  { value: 'admin', label: 'Admin' },
];

const SELECT_CLASS = 'rounded-lg border-slate-300 px-3 py-2 text-sm font-bold text-slate-900 shadow-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';

function roleLabel(role: Role) {
  return userRoleLabels[role] || role.replaceAll('_', ' ');
}

export function AdminAccounts() {
  const { accountProfiles, currentUser, approveAccount, rejectAccount } = useAppStore();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const usedLegacyIds = useMemo(
    () => new Set(accountProfiles.map(profile => profile.legacyId).filter(Boolean)),
    [accountProfiles],
  );

  const profiles = [...accountProfiles].sort((a, b) => {
    const statusWeight = { pending: 0, rejected: 1, approved: 2 };
    return statusWeight[a.approvalStatus] - statusWeight[b.approvalStatus] || a.name.localeCompare(b.name);
  });

  if (!currentUser.isAdmin) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <h2 className="text-xl font-black text-slate-900">Admin access required</h2>
          <p className="mt-2 text-sm font-semibold text-slate-500">Only Mina/admin can approve accounts.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h2 className="mb-2 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">Account Approvals</h2>
        <p className="text-sm font-semibold text-slate-500">Approve confirmed users, choose their final role, and migrate old profile data when needed.</p>
      </div>

      {message && (
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-bold text-indigo-800">
          {message}
        </div>
      )}

      <div className="space-y-3">
        {profiles.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <UserCog className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="font-bold text-slate-500">No account profiles found.</p>
          </div>
        ) : (
          profiles.map(profile => (
            <React.Fragment key={profile.id}>
              <AccountApprovalRow
                profileId={profile.id}
                email={profile.email}
                name={profile.name}
                requestedRole={profile.requestedRole}
                currentRole={profile.role}
                approvalStatus={profile.approvalStatus}
                legacyId={profile.legacyId || ''}
                usedLegacyIds={usedLegacyIds}
                isSaving={savingId === profile.id}
                onApprove={async (role, legacyId) => {
                  setSavingId(profile.id);
                  const result = await approveAccount(profile.id, role, legacyId || null);
                  setMessage(result.message || (result.ok ? 'Account approved.' : 'Could not approve account.'));
                  setSavingId(null);
                }}
                onReject={async () => {
                  setSavingId(profile.id);
                  const result = await rejectAccount(profile.id);
                  setMessage(result.message || (result.ok ? 'Account rejected.' : 'Could not reject account.'));
                  setSavingId(null);
                }}
              />
            </React.Fragment>
          ))
        )}
      </div>
    </div>
  );
}

function AccountApprovalRow({
  profileId,
  email,
  name,
  requestedRole,
  currentRole,
  approvalStatus,
  legacyId,
  usedLegacyIds,
  isSaving,
  onApprove,
  onReject,
}: {
  profileId: string;
  email: string;
  name: string;
  requestedRole: Role;
  currentRole: Role;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  legacyId: string;
  usedLegacyIds: Set<string | null | undefined>;
  isSaving: boolean;
  onApprove: (role: Role, legacyId: string) => Promise<void>;
  onReject: () => Promise<void>;
}) {
  const [role, setRole] = useState<Role>(approvalStatus === 'approved' ? currentRole : requestedRole);
  const [selectedLegacyId, setSelectedLegacyId] = useState(legacyId);
  const legacyOptions = [
    { value: '', label: 'No legacy data' },
    ...initialUsers
      .filter(user => user.id === legacyId || !usedLegacyIds.has(user.id))
      .map(user => ({ value: user.id, label: `${user.name} (${user.id})` })),
  ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-base font-black text-slate-900">{name}</h3>
            <span className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider',
              approvalStatus === 'approved' && 'bg-emerald-100 text-emerald-700',
              approvalStatus === 'pending' && 'bg-amber-100 text-amber-700',
              approvalStatus === 'rejected' && 'bg-rose-100 text-rose-700',
            )}>
              {approvalStatus}
            </span>
          </div>
          <p className="truncate text-sm font-semibold text-slate-500">{email}</p>
          <p className="mt-1 text-xs font-bold text-slate-400">
            Requested: {roleLabel(requestedRole)} {legacyId ? `| Legacy: ${legacyId}` : ''}
          </p>
          <p className="mt-1 text-[10px] font-semibold text-slate-300">{profileId}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,180px)_minmax(0,220px)] lg:min-w-[420px]">
          <CustomSelect
            value={role}
            onChange={value => setRole(value as Role)}
            options={ROLE_OPTIONS}
            buttonClassName={SELECT_CLASS}
          />
          <CustomSelect
            value={selectedLegacyId}
            onChange={setSelectedLegacyId}
            options={legacyOptions}
            buttonClassName={SELECT_CLASS}
          />
        </div>

        <div className="flex gap-2 lg:justify-end">
          <button
            type="button"
            onClick={() => void onReject()}
            disabled={isSaving}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-rose-200 px-4 py-2.5 text-sm font-black text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 lg:flex-none"
          >
            <X className="h-4 w-4" />
            Reject
          </button>
          <button
            type="button"
            onClick={() => void onApprove(role, selectedLegacyId)}
            disabled={isSaving}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300 lg:flex-none"
          >
            <Check className="h-4 w-4" />
            {isSaving ? 'Saving...' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  );
}
