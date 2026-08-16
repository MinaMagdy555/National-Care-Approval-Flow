import { neon } from '@neondatabase/serverless';

type ApiResponse = {
  status: (code: number) => {
    json: (value: unknown) => void;
    end: () => void;
  };
  setHeader: (name: string, value: string) => void;
};

const STATE_ID = 'current';

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

export default async function handler(req: { method?: string; body?: unknown }, res: ApiResponse) {
  try {
    const sql = getSql();
    await ensureSchema(sql);

    if (req.method === 'GET') {
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
      res.status(200).json({ ok: true });
      return;
    }

    res.setHeader('Allow', 'GET, PUT');
    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Neon error';
    res.status(500).json({ error: message });
  }
}
