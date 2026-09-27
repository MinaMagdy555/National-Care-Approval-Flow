import { ensureSchema, getMemberTombstones, getSql } from '../api/app-state';
import { createWorkspaceAuth, type WorkspaceRequest } from './workspaceAuth';
import { applyMemberDeletions, visibleMemberRoster } from '../src/lib/memberIdentity';
import { mergeAppSettings } from '../src/lib/appSettings';
import { canViewTask } from '../src/lib/taskPolicy';
import type { Task } from '../src/lib/types';

function linkIdentity(raw: string): string {
  try {
    const url = new URL(raw);
    return url.pathname.match(/\/(?:d|folders)\/([^/?#]+)/)?.[1] || url.searchParams.get('id') || url.href;
  } catch { return raw; }
}

export function taskReferencesLink(task: Task, url: string): boolean {
  const id = linkIdentity(url);
  const inspect = (value: unknown): boolean => {
    if (typeof value === 'string') return value === id || linkIdentity(value) === id;
    if (Array.isArray(value)) return value.some(inspect);
    return Boolean(value && typeof value === 'object' && Object.values(value).some(inspect));
  };
  return inspect(task);
}

export function createTaskMetadataAuthorizer(sqlFactory = getSql, auth = createWorkspaceAuth()) {
  return async (req: WorkspaceRequest, targetUrl: string, taskId?: string | null): Promise<200 | 401 | 403> => {
    const sql = sqlFactory();
    await ensureSchema(sql);
    const rows = await sql`SELECT state, updated_at FROM app_state WHERE id = ${'current'} LIMIT 1`;
    const state = rows[0]?.state || {};
    const settings = mergeAppSettings(applyMemberDeletions(state.settings || {}, await getMemberTombstones(sql)));
    const profiles = await auth.loadProfiles(req);
    const user = await auth.authenticate(req, settings, profiles);
    if (!user) return 401;
    const users = visibleMemberRoster(profiles, settings.manualUsers || [], settings.deletedMembers || []);
    const tasks = (Array.isArray(state.tasks) ? state.tasks : []) as Task[];
    if (taskId) {
      const task = tasks.find(task => task.id === taskId);
      if (!task || !canViewTask(task, user, settings, users) || !taskReferencesLink(task, targetUrl)) return 403;
    }
    const linked = tasks.filter(task => taskReferencesLink(task, targetUrl));
    return linked.length && !linked.some(task => canViewTask(task, user, settings, users)) ? 403 : 200;
  };
}
