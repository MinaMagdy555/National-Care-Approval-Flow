import { neon } from '@neondatabase/serverless';

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
};

const STATE_ID = 'current';
const NEON_TRANSFER_QUOTA_ERROR_MESSAGE =
  'Shared database transfer limit has been reached. Shared data is paused until the Neon quota is restored.';

function getSql() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured.');
  }
  return neon(databaseUrl);
}

async function ensureSchema(sql: ReturnType<typeof neon>) {
  await sql`
    CREATE TABLE IF NOT EXISTS app_state (
      id text PRIMARY KEY,
      state jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
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

export default async function handler(req: ApiRequest, res: ApiResponse) {
  try {
    const sql = getSql();
    await ensureSchema(sql);

    if (req.method === 'GET') {
      if (requestWantsMeta(req)) {
        const rows = await sql`
          SELECT updated_at
          FROM app_state
          WHERE id = ${STATE_ID}
          LIMIT 1
        `;
        res.status(200).json({ updatedAt: rows[0]?.updated_at || null });
        return;
      }

      if (requestWantsSettings(req)) {
        const rows = await sql`
          SELECT state->'settings' AS settings, updated_at
          FROM app_state
          WHERE id = ${STATE_ID}
          LIMIT 1
        `;
        const tombstoneIds = await getWorkflowTombstoneIds(sql);
        const state = applyWorkflowTombstones({ settings: rows[0]?.settings || null }, tombstoneIds);
        const settings = isRecord(state) ? state.settings || null : null;
        res.status(200).json({ settings, updatedAt: rows[0]?.updated_at || null });
        return;
      }

      const rows = await sql`
        SELECT state, updated_at
        FROM app_state
        WHERE id = ${STATE_ID}
        LIMIT 1
      `;
      const tombstoneIds = await getWorkflowTombstoneIds(sql);
      const state = applyWorkflowTombstones(rows[0]?.state || null, tombstoneIds);
      res.status(200).json({ state, updatedAt: rows[0]?.updated_at || null });
      return;
    }

    if (req.method === 'PUT') {
      const body = parseBody(req.body) as { state?: unknown } | undefined;
      if (!body || typeof body !== 'object' || !('state' in body)) {
        res.status(400).json({ error: 'state is required' });
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
      const state = applyWorkflowTombstones(body.state, tombstoneIds);

      await sql`
        INSERT INTO app_state (id, state, updated_at)
        VALUES (${STATE_ID}, ${JSON.stringify(state)}::jsonb, now())
        ON CONFLICT (id)
        DO UPDATE SET state = EXCLUDED.state, updated_at = now()
      `;
      const rows = await sql`
        SELECT updated_at
        FROM app_state
        WHERE id = ${STATE_ID}
        LIMIT 1
      `;
      res.status(200).json({ ok: true, updatedAt: rows[0]?.updated_at || null });
      return;
    }

    res.setHeader('Allow', 'GET, PUT');
    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    const { status, body } = getApiErrorResponse(error);
    res.status(status).json(body);
  }
}
