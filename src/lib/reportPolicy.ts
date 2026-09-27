import type { AppSettings, DailyReport, User } from './types';
import { isMemberDeleted } from './memberIdentity';

type ReportIdentity = Pick<DailyReport, 'userId'>;
type ReportVisibility = Pick<DailyReport, 'userId' | 'sentAt'>;
const leadershipRoles = new Set(['team_leader', 'manager', 'art_director', 'marketing_manager', 'admin']);

export function isSeniorReporter(user: Pick<User, 'role' | 'jobTitle'>): boolean {
  if (['team_leader', 'manager', 'art_director', 'marketing_manager'].includes(user.role)) return false;
  return user.role === 'reviewer' || /\bsenior\b/i.test(user.jobTitle || '');
}

/** Administrative tool access does not change a senior's reporting audience. */
export function isReportLeader(user: Pick<User, 'role' | 'jobTitle' | 'isAdmin'>): boolean {
  return !isSeniorReporter(user) && (leadershipRoles.has(user.role) || Boolean(user.isAdmin));
}

export function isReportExempt(user: Pick<User, 'role'>): boolean {
  return user.role === 'art_director' || user.role === 'marketing_manager';
}

export function getReportTeamKeys(user: Pick<User, 'jobTitle'>): string[] {
  const title = (user.jobTitle || '').toLowerCase().replace(/_/g, ' ');
  const keys: string[] = [];
  if (/\b(content|writer|copywriter|caption|script)\b/.test(title)) keys.push('Content Team');
  if (/\b(graphic|design|designer|brand)\b/.test(title)) keys.push('Design Team');
  if (/\b(video|editor|montage)\b/.test(title)) keys.push('Video Team');
  if (/\b(hr|human resources)\b/.test(title)) keys.push('HR');
  return keys;
}

function activeRoster(settings: AppSettings, users: User[]): User[] {
  const seen = new Set<string>();
  return users.filter(user => {
    if (!user?.id || user.id === 'guest' || seen.has(user.id) || isMemberDeleted(user, settings.deletedMembers)) return false;
    seen.add(user.id);
    return true;
  });
}

export function getReportSeniorId(owner: User, settings: AppSettings, users: User[]): string | null {
  if (isSeniorReporter(owner) || isReportLeader(owner)) return null;
  const seniors = activeRoster(settings, users).filter(user => user.id !== owner.id && isSeniorReporter(user));
  const assignments = settings.reportingSeniorByUserId || {};
  if (Object.prototype.hasOwnProperty.call(assignments, owner.id)) {
    const configured = assignments[owner.id];
    return seniors.some(user => user.id === configured) ? configured || null : null;
  }
  const teams = getReportTeamKeys(owner);
  const matches = seniors.filter(user => getReportTeamKeys(user).some(team => teams.includes(team)));
  // Ambiguous titles never grant access to several peers. Choose the actual senior
  // in member settings when more than one senior matches the same team.
  return matches.length === 1 ? matches[0].id : null;
}

function reportRank(user: User): number {
  if (isSeniorReporter(user)) return 1;
  if (!isReportLeader(user)) return 0;
  if (user.role === 'team_leader') return 2;
  if (user.role === 'manager') return 3;
  if (user.role === 'art_director' || user.role === 'marketing_manager') return 4;
  return 5;
}

function reportOwner(report: ReportIdentity, settings: AppSettings, users: User[]): User | undefined {
  const owner = users.find(user => user.id === report.userId);
  if (owner) return owner;
  const removed = settings.deletedMembers?.find(user => user.id === report.userId);
  return removed ? { id: removed.id, name: removed.name, role: removed.role || 'team_member', jobTitle: removed.jobTitle } : undefined;
}

/** Legacy global receiver overrides cannot widen or bypass the reporting hierarchy. */
export function getDailyReportReceiverIds(report: ReportIdentity, settings: AppSettings, users: User[]): string[] {
  const roster = activeRoster(settings, users);
  const owner = reportOwner(report, settings, users);
  if (!owner || owner.id === 'guest') return [];
  const rank = reportRank(owner);
  const leaders = roster.filter(user => user.id !== owner.id && isReportLeader(user) && reportRank(user) > rank).map(user => user.id);
  const senior = getReportSeniorId(owner, settings, roster);
  return [...new Set([...(senior ? [senior] : []), ...leaders])];
}

export function canViewDailyReport(report: ReportVisibility, viewer: User, settings: AppSettings, users: User[]): boolean {
  if (!viewer?.id || viewer.id === 'guest' || isMemberDeleted(viewer, settings.deletedMembers)) return false;
  if (report.userId === viewer.id) return true;
  if (!report.sentAt) return false;
  return getDailyReportReceiverIds(report, settings, users).includes(viewer.id);
}

export function canEditDailyReport(report: ReportIdentity, actor: User, settings: AppSettings): boolean {
  return actor.id !== 'guest' && !isMemberDeleted(actor, settings.deletedMembers)
    && !isReportExempt(actor) && report.userId === actor.id;
}
