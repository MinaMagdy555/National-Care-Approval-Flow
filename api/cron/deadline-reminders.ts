import { planDailyReports } from '../../src/lib/dailyReportScheduler.js';
import { timingSafeEqual } from 'node:crypto';
import { ensureSchema, getMemberTombstones, getSql } from '../app-state.js';
import { createWorkspaceAuth, type WorkspaceRequest } from '../../server/workspaceAuth.js';
import { mergeAppSettings } from '../../src/lib/appSettings.js';
import { applyMemberDeletions, visibleMemberRoster } from '../../src/lib/memberIdentity.js';
import { planDeadlineReminders } from '../../src/lib/deadlinePolicy.js';
import type { PersistedAppState } from '../../src/lib/localDb.js';
import type { User } from '../../src/lib/types.js';

type Response = { setHeader(name: string, value: string): void; status(code: number): { json(value: unknown): void } };

export async function runDeadlineReminders(sql: ReturnType<typeof getSql>, profiles: User[], now: Date) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const rows = await sql`SELECT state, updated_at FROM app_state WHERE id = ${'current'} LIMIT 1`;
    if (!rows.length) return { ok: true, generated: 0, attempts: attempt + 1 };
    const state = rows[0].state as PersistedAppState;
    const removed = await getMemberTombstones(sql);
    const settings = mergeAppSettings(applyMemberDeletions(state.settings || {}, removed));
    const users = visibleMemberRoster(profiles, settings.manualUsers || [], settings.deletedMembers || []);
    const plan = planDeadlineReminders(Array.isArray(state.tasks) ? state.tasks : [], settings, users, now);
    const reports = planDailyReports(state.tasks || [], state.dailyReports || [], settings, users, now);
    if (!plan.notifications.length && !reports.changedIds.length) return { ok: true, generated: 0, attempts: attempt + 1 };
    const next = { ...state, tasks: plan.tasks, dailyReports: reports.reports, notifications: [...(state.notifications || []), ...plan.notifications, ...reports.notifications] };
    // Notifications and independent receipts commit together. A conflicting user save
    // causes a fresh read and replan, never a replacement based on obsolete task data.
    const written = await sql`UPDATE app_state SET state = ${JSON.stringify(next)}::jsonb, updated_at = clock_timestamp()
      WHERE id = ${'current'} AND updated_at = ${rows[0].updated_at}::timestamptz RETURNING updated_at`;
    if (written.length) return { ok: true, generated: plan.notifications.length + reports.notifications.length, attempts: attempt + 1 };
  }
  return { ok: false, generated: 0, attempts: 4 };
}

export function createDeadlineReminderHandler(options: {
  sqlFactory?: typeof getSql;
  env?: Record<string, string | undefined>;
  loadProfiles?: (req: WorkspaceRequest) => Promise<User[]>;
  now?: () => Date;
} = {}) {
  const env = options.env || process.env;
  return async (req: WorkspaceRequest, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const secret = env.CRON_SECRET;
    if (!secret) { res.status(503).json({ error: 'Deadline scheduling is not configured.' }); return; }
    const actual = Buffer.from(typeof req.headers?.authorization === 'string' ? req.headers.authorization : '');
    const expected = Buffer.from(`Bearer ${secret}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { res.status(401).json({ error: 'Unauthorized' }); return; }
    try {
      const sql = (options.sqlFactory || getSql)();
      await ensureSchema(sql);
      // The scheduler secret is never forwarded to the identity provider.
      const profiles = await (options.loadProfiles || createWorkspaceAuth({ env }).loadProfiles)({});
      const result = await runDeadlineReminders(sql, profiles, (options.now || (() => new Date()))());
      res.status(result.ok ? 200 : 409).json(result);
    } catch {
      res.status(503).json({ error: 'Deadline reminders could not be saved. Retry this scheduled run.' });
    }
  };
}

export default createDeadlineReminderHandler();
