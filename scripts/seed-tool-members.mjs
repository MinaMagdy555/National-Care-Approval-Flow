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
  SELECT state
  FROM app_state
  WHERE id = 'current'
  LIMIT 1
`;

const state = rows[0]?.state || { tasks: [], notifications: [], settings: {}, dailyReports: [] };
state.settings = state.settings || {};

const existingUsers = Array.isArray(state.settings.manualUsers)
  ? state.settings.manualUsers
  : [];
const usersByEmail = new Map(
  existingUsers
    .filter(user => user.id !== 'manual_shahed_hazem' && String(user.email || '').trim().toLowerCase() !== 'shahdhazem42@gmail.com')
    .map(user => [String(user.email || '').trim().toLowerCase(), user])
);

for (const member of members) {
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

await sql`
  INSERT INTO app_state (id, state, updated_at)
  VALUES ('current', ${JSON.stringify(state)}::jsonb, now())
  ON CONFLICT (id)
  DO UPDATE SET state = EXCLUDED.state, updated_at = now()
`;

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
