import { createHash } from 'crypto';
import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';

dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL);
const now = new Date().toISOString();

const hashPassword = password =>
  createHash('sha256')
    .update(`national-care-tool-login:${password.trim()}`)
    .digest('hex');

const members = [
  {
    id: 'manual_samar_ramadan',
    name: 'Samar Ramadan',
    email: 'samarradnann@gmail.com',
    password: 'Samar.Ramadan',
    role: 'team_member',
    jobTitle: 'Content Creator',
  },
  {
    id: 'manual_rahma_mohamed',
    name: 'Rahma Mohamed',
    email: 'rahmamoohaamed132@gmail.com',
    password: 'Rahma.Mohamed',
    role: 'team_member',
    jobTitle: 'Content Creator',
  },
  {
    id: 'manual_shahed_hazem',
    name: 'Shahed Hazem',
    email: 'shahdmuhammed51@gmail.com',
    password: 'Shahed.Hazem',
    role: 'team_member',
    jobTitle: 'Video Editor',
  },
];

await sql`
  CREATE TABLE IF NOT EXISTS app_state (
    id text PRIMARY KEY,
    state jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )
`;

const rows = await sql`
  SELECT state, updated_at
  FROM app_state
  WHERE id = 'current'
  LIMIT 1
`;

const state = rows[0]?.state || { tasks: [], notifications: [], settings: {}, dailyReports: [] };
state.settings = state.settings || {};

// Member removals survive re-running the seed and stale roster snapshots.
const hasRemovalTable = await sql`SELECT to_regclass('deleted_member_tombstones') AS table_name`;
const removalRows = hasRemovalTable[0]?.table_name
  ? await sql`SELECT record FROM deleted_member_tombstones`
  : [];
const removals = [...removalRows.map(row => row.record), ...(state.settings.deletedMembers || [])];
const removedIds = new Set(removals.map(record => record.id));
const removedEmails = new Set(removals.map(record => String(record.email || '').trim().toLowerCase()).filter(Boolean));
const isRemoved = user => removedIds.has(user.id) || removedEmails.has(String(user.email || '').trim().toLowerCase());
state.settings.deletedMembers = Array.from(new Map(removals.map(record => [record.id, record])).values());

const existingUsers = Array.isArray(state.settings.manualUsers)
  ? state.settings.manualUsers
  : [];
const usersByEmail = new Map(
  existingUsers
    .filter(user => !isRemoved(user))
    .filter(user => user.id !== 'manual_shahed_hazem' && String(user.email || '').trim().toLowerCase() !== 'shahdhazem42@gmail.com')
    .map(user => [String(user.email || '').trim().toLowerCase(), user])
);

for (const member of members) {
  if (isRemoved(member)) continue;
  const key = member.email.toLowerCase();
  const previous = usersByEmail.get(key) || {};
  usersByEmail.set(key, {
    ...previous,
    id: previous.id || member.id,
    name: member.name,
    email: member.email,
    role: member.role,
    jobTitle: member.jobTitle,
    isAdmin: false,
    passwordHash: hashPassword(member.password),
    passwordUpdatedAt: now,
  });
}

state.settings.manualUsers = Array.from(usersByEmail.values());
state.settings.updatedAt = now;

const saved = await sql`
  INSERT INTO app_state (id, state, updated_at)
  VALUES ('current', ${JSON.stringify(state)}::jsonb, now())
  ON CONFLICT (id)
  DO UPDATE SET state = EXCLUDED.state, updated_at = now()
  WHERE app_state.updated_at = ${rows[0]?.updated_at || null}::timestamptz
  RETURNING updated_at
`;
if (!saved.length) throw new Error('Workspace changed during seeding. Retry against fresh membership state.');

console.log(JSON.stringify(
  state.settings.manualUsers
    .filter(user => members.some(member => member.email === user.email))
    .map(user => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      jobTitle: user.jobTitle,
      hasPassword: Boolean(user.passwordHash),
    })),
  null,
  2
));
