import type { AppSettings, DeletedMember, User } from './types.js';

export const normalizeMemberEmail = (value?: string) => (value || '').trim().toLowerCase();

/** Whitelist fields so stale snapshots cannot put password hashes into deletion history. */
export function mergeMemberDeletions(...groups: Array<unknown>): DeletedMember[] {
  const records = new Map<string, DeletedMember>();
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const value of group) {
      if (!value || typeof value.id !== 'string' || !value.id || value.id === 'guest') continue;
      const record: DeletedMember = {
        id: value.id,
        name: typeof value.name === 'string' ? value.name : value.id,
        email: typeof value.email === 'string' ? normalizeMemberEmail(value.email) || undefined : undefined,
        role: typeof value.role === 'string' ? value.role : undefined,
        jobTitle: typeof value.jobTitle === 'string' ? value.jobTitle : undefined,
        deletedAt: typeof value.deletedAt === 'string' ? value.deletedAt : '',
        deletedBy: typeof value.deletedBy === 'string' ? value.deletedBy : '',
      };
      // The original deletion remains authoritative, including its attribution.
      if (!records.has(record.id)) records.set(record.id, record);
    }
  }
  return [...records.values()];
}

export function isMemberDeleted(user: Pick<User, 'id' | 'email' | 'legacyId'>, deleted: DeletedMember[] = []): boolean {
  const email = normalizeMemberEmail(user.email);
  return deleted.some(record => record.id === user.id || record.id === user.legacyId
    || Boolean(email && email === normalizeMemberEmail(record.email)));
}

export function memberDeletionIdentities(target: User, roster: User[], actorId: string, now: string): DeletedMember[] {
  const email = normalizeMemberEmail(target.email);
  const identities = roster.filter(user => user.id === target.id || (email && normalizeMemberEmail(user.email) === email));
  identities.push(target);
  return mergeMemberDeletions(identities.flatMap(user => [user.id, user.legacyId].filter(Boolean).map(id => ({
    id, email: normalizeMemberEmail(user.email), name: user.name, role: user.role,
    jobTitle: user.jobTitle, deletedAt: now, deletedBy: actorId,
  }))));
}

/** Apply removal to configuration only. Task snapshots and historical authors stay intact. */
export function applyMemberDeletions<T extends Partial<AppSettings>>(settings: T, additional: DeletedMember[] = []): T {
  const deletedMembers = mergeMemberDeletions(additional, settings.deletedMembers);
  if (!deletedMembers.length) return { ...settings, deletedMembers };
  const deletedIds = new Set(deletedMembers.map(record => record.id));
  const remove = (ids: string[] | undefined) => Array.isArray(ids) ? ids.filter(id => !deletedIds.has(id)) : ids;
  const result = { ...settings, deletedMembers };
  const idLists = ['settingsManagerUserIds', 'workAssignmentCreatorIds', 'contributorAssignerIds', 'neverHandlerIds',
    'selfAssignmentBlockedIds', 'videoOnlyHandlerIds', 'alwaysAssignableHandlerIds', 'firstReviewerUserIds',
    'finalReviewerUserIds', 'viewAllWorkloadUserIds', 'seniorReviewerUserIds', 'dailyReportReceiverUserIds'] as const;
  for (const key of idLists) if (Array.isArray(result[key])) result[key] = remove(result[key]);
  if (Array.isArray(result.manualUsers)) result.manualUsers = result.manualUsers.filter(user => !isMemberDeleted(user, deletedMembers));
  if (Array.isArray(result.customPermissions)) result.customPermissions = result.customPermissions.map(item => ({ ...item, userIds: remove(item.userIds)! }));
  if (Array.isArray(result.customWorkingHours)) result.customWorkingHours = result.customWorkingHours.filter(item => item.targetType !== 'employee' || !deletedIds.has(item.targetValue));
  if (Array.isArray(result.taskTypes)) result.taskTypes = result.taskTypes.map(item => typeof item === 'string' ? item : ({ ...item,
    fullReviewerUserIds: remove(item.fullReviewerUserIds), quickLookUserIds: remove(item.quickLookUserIds), finalReviewerUserIds: remove(item.finalReviewerUserIds),
  }));
  // Keep explicit workflow owners in templates. Removing them would silently broaden an empty
  // user list to a role fallback; the editor must deliberately choose their replacement.
  return result;
}

export function visibleMemberRoster(profiles: User[], manualUsers: User[], deleted: DeletedMember[]): User[] {
  const manual = manualUsers.filter(user => !isMemberDeleted(user, deleted));
  const emails = new Set(manual.map(user => normalizeMemberEmail(user.email)).filter(Boolean));
  const visibleProfiles = profiles.filter(user => !isMemberDeleted(user, deleted) && !emails.has(normalizeMemberEmail(user.email)));
  const profileIds = new Set(visibleProfiles.map(user => user.id));
  return [...visibleProfiles, ...manual.filter(user => !profileIds.has(user.id))];
}
