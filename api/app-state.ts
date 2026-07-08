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
}

function parseBody(body: unknown) {
  if (typeof body === 'string') return JSON.parse(body);
  return body;
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
      res.status(200).json({ state: rows[0]?.state || null, updatedAt: rows[0]?.updated_at || null });
      return;
    }

    if (req.method === 'PUT') {
      const body = parseBody(req.body) as { state?: unknown } | undefined;
      if (!body || typeof body !== 'object' || !('state' in body)) {
        res.status(400).json({ error: 'state is required' });
        return;
      }

      await sql`
        INSERT INTO app_state (id, state, updated_at)
        VALUES (${STATE_ID}, ${JSON.stringify(body.state)}::jsonb, now())
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
