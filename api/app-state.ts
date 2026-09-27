import { getReassignmentNotifications, getHandoffNotifications, mergeHandoffNotifications } from '../src/lib/reassignmentNotifications';
import { canManageWorkflowBuilder } from '../src/lib/workflowUtils';
import { preserveDeadlineState, projectDeadlineNotifications } from '../src/lib/deadlinePolicy';
import { canViewTask, projectTaskNotifications } from '../src/lib/taskPolicy';
import { mergeAuthorizedTasks, mergeAuthorizedTaskNotifications } from '../server/taskAccess';
import { createWorkspaceAuth, isSameOriginRequest, withoutPrivateSettings, safeUser } from '../server/workspaceAuth';
import { mergeAuthorizedReports, mergeReportNotifications, projectReports, projectReportNotifications, ReportAccessError } from '../server/reportAccess';
import { visibleMemberRoster } from '../src/lib/memberIdentity';
import { canRemoveMember } from '../src/lib/memberDeletion';
import { applyMemberDeletions, mergeMemberDeletions } from '../src/lib/memberIdentity';
import { findMemberDeletionBlockers } from '../src/lib/memberDeletion';
import { canManageAppSettings, mergeAppSettings } from '../src/lib/appSettings';
import type { DeletedMember, Task, User, DailyReport, Notification } from '../src/lib/types';
import { neon } from '@neondatabase/serverless';
import { filterResetNotifications, NotificationResetRecord, planNotificationReset } from '../src/lib/notificationReset';

type ApiResponse = {
  status: (code: number) => {
    json: (value: unknown) => void;
    end: () => void;
  };
  setHeader: (name: string, value: string) => void;
};

type ApiRequest = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
};

const STATE_ID = 'current';
const NEON_TRANSFER_QUOTA_ERROR_MESSAGE =
  'Shared database transfer limit has been reached. Shared data is paused until the Neon quota is restored.';

export function getSql() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured.');
  }
  return neon(databaseUrl);
}

export async function ensureSchema(sql: ReturnType<typeof neon>) {
  await sql`
    CREATE TABLE IF NOT EXISTS app_state (
      id text PRIMARY KEY,
      state jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS deleted_member_tombstones (
      member_id text PRIMARY KEY,
      record jsonb NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS deleted_workflow_tombstones (
      workflow_id text PRIMARY KEY,
      deleted_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

function parseBody(body: unknown) {
  if (typeof body === 'string') return JSON.parse(body);
  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function getStateDeletedWorkflowIds(state: unknown) {
  if (!isRecord(state) || !isRecord(state.settings)) return [];
  const deletedWorkflowIds = state.settings.deletedWorkflowIds;
  return Array.isArray(deletedWorkflowIds)
    ? deletedWorkflowIds.filter((id): id is string => typeof id === 'string' && Boolean(id))
    : [];
}

function applyWorkflowTombstones(state: unknown, tombstoneIds: string[]) {
  if (!isRecord(state) || tombstoneIds.length === 0) return state;

  const settings = isRecord(state.settings) ? state.settings : {};
  const deletedSet = new Set([
    ...getStateDeletedWorkflowIds(state),
    ...tombstoneIds,
  ]);
  const filteredWorkflows = Array.isArray(settings.workflows)
    ? settings.workflows.filter(workflow => (
        !isRecord(workflow) ||
        typeof workflow.id !== 'string' ||
        !deletedSet.has(workflow.id)
      ))
    : settings.workflows;
  const taskTypeWorkflowIds = isRecord(settings.taskTypeWorkflowIds)
    ? Object.fromEntries(
        Object.entries(settings.taskTypeWorkflowIds).filter(([, workflowId]) => (
          typeof workflowId !== 'string' || !deletedSet.has(workflowId)
        ))
      )
    : settings.taskTypeWorkflowIds;
  const defaultWorkflowId = typeof settings.defaultWorkflowId === 'string' && deletedSet.has(settings.defaultWorkflowId)
    ? (Array.isArray(filteredWorkflows)
        ? (filteredWorkflows.find(workflow => isRecord(workflow) && typeof workflow.id === 'string') as { id?: string } | undefined)?.id || null
        : null)
    : settings.defaultWorkflowId;

  return {
    ...state,
    settings: {
      ...settings,
      workflows: filteredWorkflows,
      deletedWorkflowIds: Array.from(deletedSet),
      defaultWorkflowId,
      taskTypeWorkflowIds,
    },
  };
}

async function getWorkflowTombstoneIds(sql: ReturnType<typeof neon>) {
  const rows = await sql`
    SELECT workflow_id
    FROM deleted_workflow_tombstones
  ` as Array<{ workflow_id: unknown }>;
  return rows
    .map(row => row.workflow_id)
    .filter((id): id is string => typeof id === 'string' && Boolean(id));
}

export function applyStateMemberTombstones(state: unknown, records: DeletedMember[]) {
  if (!isRecord(state)) return records.length ? { settings: applyMemberDeletions({}, records) } : state;
  return { ...state, settings: applyMemberDeletions(isRecord(state.settings) ? state.settings : {}, records) };
}

export async function getMemberTombstones(sql: ReturnType<typeof neon>) {
  const rows = await sql`SELECT record FROM deleted_member_tombstones` as Array<{ record: unknown }>;
  return mergeMemberDeletions(rows.map(row => row.record));
}

function requestWantsMeta(req: ApiRequest) {
  const queryValue = req.query?.meta;
  if (queryValue === '1' || queryValue === 'true') return true;
  if (Array.isArray(queryValue) && queryValue.some(value => value === '1' || value === 'true')) return true;

  if (!req.url) return false;
  try {
    const parsed = new URL(req.url, 'https://national-care.local');
    return parsed.searchParams.get('meta') === '1' || parsed.searchParams.get('meta') === 'true';
  } catch {
    return false;
  }
}

function requestWantsSettings(req: ApiRequest) {
  const queryValue = req.query?.settings;
  if (queryValue === '1' || queryValue === 'true') return true;
  if (Array.isArray(queryValue) && queryValue.some(value => value === '1' || value === 'true')) return true;

  if (!req.url) return false;
  try {
    const parsed = new URL(req.url, 'https://national-care.local');
    return parsed.searchParams.get('settings') === '1' || parsed.searchParams.get('settings') === 'true';
  } catch {
    return false;
  }
}

function getApiErrorResponse(error: unknown) {
  if (error instanceof ReportAccessError) return { status: error.status, body: { error: error.message } };
  const message = error instanceof Error ? error.message : 'Unknown Neon error';
  const normalized = message.toLowerCase();

  if (
    normalized.includes('data transfer quota') ||
    normalized.includes('transfer quota') ||
    normalized.includes('quota exceeded') ||
    normalized.includes('exceeded the data transfer') ||
    normalized.includes('http status 402')
  ) {
    return {
      status: 402,
      body: {
        error: NEON_TRANSFER_QUOTA_ERROR_MESSAGE,
        code: 'NEON_TRANSFER_QUOTA_EXCEEDED',
      },
    };
  }

  return { status: 500, body: { error: message } };
}

export function createAppStateHandler(sqlFactory = getSql, auth = createWorkspaceAuth(), now = () => new Date()) {
return async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const requestNow = now();
    const sql = sqlFactory();
    await ensureSchema(sql);

    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && !isSameOriginRequest(req)) { res.status(403).json({ error: 'Cross-origin workspace writes are not allowed.' }); return; }
    const currentRows = await sql`SELECT state, updated_at FROM app_state WHERE id = ${STATE_ID} LIMIT 1`;
    const existingRecords = await getMemberTombstones(sql);
    const workflowTombstones = await getWorkflowTombstoneIds(sql);
    const canonical = applyStateMemberTombstones(applyWorkflowTombstones(currentRows[0]?.state || {}, workflowTombstones), existingRecords);
    const currentState = isRecord(canonical) ? canonical : {};
    const currentSettings = mergeAppSettings(isRecord(currentState.settings) ? currentState.settings : {});
    const authAction = req.query?.auth || new URL(req.url || '', 'https://workspace.local').searchParams.get('auth');
    if (req.method === 'POST' && authAction === 'logout') {
      res.setHeader('Set-Cookie', auth.clearCookie(req));
      res.status(200).json({ ok: true }); return;
    }
    if (req.method === 'POST' && authAction === 'login') {
      const body = parseBody(req.body);
      if (!isRecord(body) || typeof body.identifier !== 'string' || typeof body.password !== 'string'
        || body.identifier.length > 512 || body.password.length > 1024) { res.status(400).json({ error: 'Enter your account and password.' }); return; }
      const result = auth.login(req, currentSettings, body.identifier, body.password);
      if (!result.user) { res.status(401).json({ error: 'Invalid account or password.', code: result.code }); return; }
      res.setHeader('Set-Cookie', result.cookie!);
      res.status(200).json({ ok: true, user: result.user }); return;
    }
    let profiles = req.headers?.authorization ? await auth.loadProfiles(req) : [];
    const viewer = await auth.authenticate(req, currentSettings, profiles);
    if (viewer && !profiles.length) profiles = await auth.loadProfiles(req);
    const directory = visibleMemberRoster(profiles, currentSettings.manualUsers || [], currentSettings.deletedMembers || []);
    if (req.method === 'GET' && authAction === 'session') {
      if (!viewer) { res.setHeader('Set-Cookie', auth.clearCookie(req)); res.status(200).json({ user: null }); return; }
      res.status(200).json({ user: viewer }); return;
    }
    if (req.method === 'GET' && requestWantsSettings(req)) {
      res.status(200).json({ settings: withoutPrivateSettings(currentSettings), updatedAt: currentRows[0]?.updated_at || null }); return;
    }
    if (!viewer) { res.status(401).json({ error: 'Sign in to access this workspace.' }); return; }
    if (req.method === 'GET') {
      if (requestWantsMeta(req)) { res.status(200).json({ updatedAt: currentRows[0]?.updated_at || null }); return; }
      const reports = Array.isArray(currentState.dailyReports) ? currentState.dailyReports as DailyReport[] : [];
      const tasks = Array.isArray(currentState.tasks) ? currentState.tasks as Task[] : [];
      const reset = planNotificationReset(Array.isArray(currentState.notifications) ? currentState.notifications as Notification[] : [], currentSettings, currentState.notificationReset as NotificationResetRecord | undefined, requestNow.toISOString());
      const publicState = { ...currentState };
      delete publicState.notificationReset;
      const visibleTasks = tasks.filter(task => canViewTask(task, viewer, currentSettings, directory, requestNow));

      // Idempotently repair missing current-turn assignment notices
      const repairedNotifications = mergeHandoffNotifications(reset.notifications,
        visibleTasks.flatMap(task => getHandoffNotifications(task, currentSettings, directory, requestNow.toISOString())), reset.reset.clearedIds);

      res.status(200).json({ state: { ...publicState, settings: withoutPrivateSettings(currentSettings),
        tasks: visibleTasks,
        dailyReports: projectReports(reports, viewer, currentSettings, directory),
        notifications: projectDeadlineNotifications(projectReportNotifications(projectTaskNotifications(repairedNotifications, tasks, viewer, currentSettings, directory, requestNow), reports, viewer, currentSettings, directory),
          tasks, viewer, currentSettings, directory, requestNow),
      }, updatedAt: currentRows[0]?.updated_at || null }); return;
    }

    if (req.method === 'PUT') {
      const body = parseBody(req.body) as { state?: unknown; expectedUpdatedAt?: string | null; changedTaskIds?: string[]; deletedTaskIds?: string[] } | undefined;
      if (!body || typeof body !== 'object' || !('state' in body)) {
        res.status(400).json({ error: 'state is required' });
        return;
      }

      const incomingState = isRecord(body.state) ? body.state : {};
      if ((body.changedTaskIds !== undefined && (!Array.isArray(body.changedTaskIds) || body.changedTaskIds.some(id => typeof id !== 'string')))
        || (body.deletedTaskIds !== undefined && (!Array.isArray(body.deletedTaskIds) || body.deletedTaskIds.some(id => typeof id !== 'string')))) {
        res.status(400).json({ error: 'Invalid task change list.' }); return;
      }
      const suppliedSettings = isRecord(incomingState.settings) ? incomingState.settings : {};
      const memberSettingsManager = canRemoveMember(viewer);
      const settingsManager = canManageAppSettings(viewer, currentSettings) || currentSettings.workAssignmentCreatorIds.includes(viewer.id) || canManageWorkflowBuilder(viewer, currentSettings);
      const safeDirectory = (users: User[]) => users.map(safeUser);
      if (!memberSettingsManager && ((Array.isArray(suppliedSettings.manualUsers) && JSON.stringify(safeDirectory(suppliedSettings.manualUsers as User[])) !== JSON.stringify(safeDirectory(currentSettings.manualUsers || [])))
        || (suppliedSettings.reportingSeniorByUserId !== undefined && JSON.stringify(suppliedSettings.reportingSeniorByUserId || {}) !== JSON.stringify(currentSettings.reportingSeniorByUserId || {}))
        || (suppliedSettings.deletedMembers !== undefined && JSON.stringify(suppliedSettings.deletedMembers || []) !== JSON.stringify(currentSettings.deletedMembers || [])))) {
        throw new ReportAccessError('Only a member-settings manager can change reporting relationships or member identities.');
      }
      const incomingSettings = settingsManager ? { ...currentSettings, ...suppliedSettings } : currentSettings;
      const reset = planNotificationReset(Array.isArray(currentState.notifications) ? currentState.notifications as Notification[] : [], currentSettings, currentState.notificationReset as NotificationResetRecord | undefined, requestNow.toISOString());
      incomingSettings.notificationResetVersion = reset.notificationResetVersion;
      if (!memberSettingsManager) {
        incomingSettings.manualUsers = currentSettings.manualUsers;
        incomingSettings.reportingSeniorByUserId = currentSettings.reportingSeniorByUserId;
        incomingSettings.deletedMembers = currentSettings.deletedMembers;
      }
      // Clients receive safe users, so an omitted hash means keep the server credential.
      if (Array.isArray(incomingSettings.manualUsers)) incomingSettings.manualUsers = (incomingSettings.manualUsers as User[]).map(user => {
        const previous = currentSettings.manualUsers?.find(item => item.id === user.id);
        return { ...user, passwordHash: user.passwordHash || previous?.passwordHash, passwordUpdatedAt: user.passwordUpdatedAt || previous?.passwordUpdatedAt };
      });
      const existingReports = Array.isArray(currentState.dailyReports) ? currentState.dailyReports as DailyReport[] : [];
      const reportMerge = mergeAuthorizedReports(existingReports, Array.isArray(incomingState.dailyReports) ? incomingState.dailyReports as DailyReport[] : undefined, viewer, currentSettings);

      const existingTasksForInjection = Array.isArray(currentState.tasks) ? currentState.tasks as Task[] : [];
      // The same canonical baseline as GET lets a read acknowledgement persist even
      // when the missing notice was first recovered during a read-only request.
      const existingNotificationsWithInjected = mergeHandoffNotifications(reset.notifications,
        existingTasksForInjection.flatMap(task => getHandoffNotifications(task, currentSettings, directory, requestNow.toISOString())), reset.reset.clearedIds);

      const nextNotifications = mergeReportNotifications(existingNotificationsWithInjected,
        filterResetNotifications(Array.isArray(incomingState.notifications) ? incomingState.notifications as Notification[] : [], reset.reset), reportMerge.changed, viewer, currentSettings, directory);
      const taskMerge = mergeAuthorizedTasks(existingTasksForInjection,
        Array.isArray(incomingState.tasks) ? incomingState.tasks as Task[] : [], viewer, currentSettings, directory, body, requestNow);
      const taskNotifications = mergeAuthorizedTaskNotifications(existingNotificationsWithInjected, nextNotifications,
        taskMerge.tasks, viewer, currentSettings, directory, taskMerge.authorizedIds, requestNow);
      let canonicalNotices = taskNotifications;
      for (const next of taskMerge.tasks) {
        if (!taskMerge.authorizedIds.has(next.id)) continue;
        const prior = (currentState.tasks as Task[] || []).find(task => task.id === next.id) || null;
        canonicalNotices = mergeHandoffNotifications(canonicalNotices, [
          ...(prior ? getReassignmentNotifications(prior, next, currentSettings, directory) : []),
          ...getHandoffNotifications(next, currentSettings, directory, requestNow.toISOString()),
        ], reset.reset.clearedIds);
      }
      const deadlineState = preserveDeadlineState(Array.isArray(currentState.tasks) ? currentState.tasks as Task[] : [],
        taskMerge.tasks, existingNotificationsWithInjected, canonicalNotices, viewer);
      deadlineState.notifications = filterResetNotifications(deadlineState.notifications, reset.reset);
      const authorizedState = { ...incomingState, notificationReset: reset.reset, tasks: deadlineState.tasks, settings: incomingSettings, dailyReports: reportMerge.reports, notifications: deadlineState.notifications };
      const records = mergeMemberDeletions(existingRecords, incomingSettings.deletedMembers);
      const newRecords = records.filter(record => !existingRecords.some(old => old.id === record.id));
      const identities = records.map(record => ({ ...record, role: record.role || 'team_member' })) as User[];
      const roster = [...directory, ...identities];
      const freshBlocks = findMemberDeletionBlockers(Array.isArray(currentState.tasks) ? currentState.tasks as Task[] : [], newRecords, currentSettings, roster);
      const incomingBlocks = findMemberDeletionBlockers(Array.isArray(incomingState.tasks) ? incomingState.tasks as Task[] : [], records, mergeAppSettings(incomingSettings), roster);
      if (freshBlocks.length || incomingBlocks.length) {
        const blocks = [...freshBlocks, ...incomingBlocks];
        const visibleBlocks = blocks.filter(block => {
          const task = (Array.isArray(currentState.tasks) ? currentState.tasks as Task[] : []).find(task => task.id === block.taskId) || taskMerge.tasks.find(task => task.id === block.taskId);
          return task && canViewTask(task, viewer, currentSettings, directory, requestNow);
        });
        res.status(409).json({ error: 'A removed member still has unfinished assigned work. Refresh and reassign those steps first.', blockingTasks: visibleBlocks, blockedTaskCount: blocks.length });
        return;
      }
      const incomingDeletedWorkflowIds = getStateDeletedWorkflowIds(body.state);
      await Promise.all(incomingDeletedWorkflowIds.map(workflowId => sql`
        INSERT INTO deleted_workflow_tombstones (workflow_id, deleted_at)
        VALUES (${workflowId}, now())
        ON CONFLICT (workflow_id)
        DO UPDATE SET deleted_at = LEAST(deleted_workflow_tombstones.deleted_at, EXCLUDED.deleted_at)
      `));
      const tombstoneIds = await getWorkflowTombstoneIds(sql);
      const state = applyStateMemberTombstones(applyWorkflowTombstones(authorizedState, tombstoneIds), records);
      // Persist the state and removal records in one statement. A stale deletion cannot
      // remove membership after another client has assigned new work in the meantime.
      const checkRevision = true;
      const expectedUpdatedAt = currentRows[0]?.updated_at || null;
      if (Object.prototype.hasOwnProperty.call(body, 'expectedUpdatedAt') &&
        (body.expectedUpdatedAt ? new Date(body.expectedUpdatedAt).getTime() : null) !==
        (expectedUpdatedAt ? new Date(expectedUpdatedAt).getTime() : null)) {
        res.status(409).json({ error: 'The shared workspace changed while removing this member. Refresh and try again.' });
        return;
      }
      const rows = await sql`
        WITH written AS (
          INSERT INTO app_state (id, state, updated_at)
          VALUES (${STATE_ID}, ${JSON.stringify(state)}::jsonb, now())
          ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()
          WHERE (NOT ${checkRevision}::boolean OR app_state.updated_at = ${expectedUpdatedAt}::timestamptz)
          RETURNING updated_at
        ), removals AS (
          INSERT INTO deleted_member_tombstones (member_id, record)
          SELECT record->>'id', record FROM jsonb_array_elements(${JSON.stringify(records)}::jsonb) AS record
          WHERE EXISTS (SELECT 1 FROM written)
          ON CONFLICT (member_id) DO NOTHING
          RETURNING member_id
        )
        SELECT updated_at FROM written
      `;
      if (!rows.length) {
        res.status(409).json({ error: 'The shared workspace changed while removing this member. Refresh and try again.' });
        return;
      }
      const settings = isRecord(state) && isRecord(state.settings) ? withoutPrivateSettings(state.settings) : undefined;
      const savedTasks = deadlineState.tasks;
      const visibleTasks = savedTasks.filter(task => canViewTask(task, viewer, currentSettings, directory, requestNow));
      res.status(200).json({ ok: true, updatedAt: rows[0]?.updated_at || null, settings, tasks: visibleTasks,
        notifications: projectDeadlineNotifications(projectReportNotifications(projectTaskNotifications(deadlineState.notifications, savedTasks, viewer, currentSettings, directory, requestNow),
          reportMerge.reports, viewer, currentSettings, directory), savedTasks, viewer, currentSettings, directory, requestNow) });
      return;
    }

    res.setHeader('Allow', 'GET, PUT, POST');
    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    const { status, body } = getApiErrorResponse(error);
    res.status(status).json(body);
  }
}

}

export default createAppStateHandler();
