import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { AppSettings, User } from '../src/lib/types';
import { isMemberDeleted, normalizeMemberEmail, visibleMemberRoster } from '../src/lib/memberIdentity';

export interface WorkspaceRequest {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
}

export interface WorkspaceAuthOptions {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => number;
}

const COOKIE = 'national_care_workspace';
const MAX_AGE = 8 * 60 * 60;

export function safeUser(user: User): User {
  return { id: user.id, name: user.name, email: user.email, role: user.role,
    jobTitle: user.jobTitle, isAdmin: Boolean(user.isAdmin), legacyId: user.legacyId };
}

function header(req: WorkspaceRequest, name: string): string {
  const value = req.headers?.[name] || req.headers?.[name.toLowerCase()];
  return typeof value === 'string' ? value : '';
}

export function createWorkspaceAuth(options: WorkspaceAuthOptions = {}) {
  const env = options.env || process.env;
  const fetcher = options.fetch || fetch;
  const now = options.now || Date.now;
  const secret = () => {
    const source = env.WORKSPACE_SESSION_SECRET || env.DATABASE_URL;
    if (!source) throw new Error('Workspace authentication is not configured.');
    return createHash('sha256').update('national-care-workspace-session:').update(source).digest();
  };
  const sign = (value: string) => createHmac('sha256', secret()).update(value).digest('base64url');
  const credentialVersion = (user: User) => sign(`${user.id}:${user.passwordHash || ''}:${user.passwordUpdatedAt || ''}`);
  const cookie = (req: WorkspaceRequest, token: string, maxAge = MAX_AGE) =>
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${env.NODE_ENV === 'production' || header(req, 'x-forwarded-proto') === 'https' ? '; Secure' : ''}`;
  const bearer = (req: WorkspaceRequest) => /^Bearer\s+(.+)$/i.exec(header(req, 'authorization'))?.[1];

  async function loadProfiles(req: WorkspaceRequest): Promise<User[]> {
    const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) return [];
    const token = bearer(req) || key;
    const response = await fetcher(`${url.replace(/\/$/, '')}/rest/v1/profiles?select=*`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('Could not verify the workspace member directory.');
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('The member directory returned an invalid response.');
    return rows.map(profile => safeUser({ id: profile.id, name: profile.name, email: profile.email,
      role: profile.role, jobTitle: profile.job_title, isAdmin: profile.is_admin, legacyId: profile.legacy_id }));
  }

  async function authenticate(req: WorkspaceRequest, settings: AppSettings, profiles: User[]): Promise<User | null> {
    const raw = header(req, 'cookie').split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (raw && !bearer(req)) {
      try {
        const [payload, signature, extra] = raw.split('.');
        if (!payload || !signature || extra) return null;
        const expected = Buffer.from(sign(payload));
        const supplied = Buffer.from(signature);
        if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
        const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        const user = (settings.manualUsers || []).find(user => user.id === session.sub);
        if (!user || !Number.isFinite(session.exp) || session.exp <= now() || session.version !== credentialVersion(user)
          || isMemberDeleted(user, settings.deletedMembers)) return null;
        return safeUser(user);
      } catch { return null; }
    }
    const token = bearer(req);
    if (!token) return null;
    const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
    const key = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    const response = await fetcher(`${url.replace(/\/$/, '')}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
    if (!response.ok) return null;
    const identity = await response.json();
    const profile = profiles.find(user => user.id === identity.id);
    if (!profile || isMemberDeleted(profile, settings.deletedMembers)) return null;
    // The directory uses manual identities for a matching registered email as well.
    const canonical = visibleMemberRoster(profiles, settings.manualUsers || [], settings.deletedMembers || [])
      .find(user => user.id === profile.id || (normalizeMemberEmail(profile.email) && normalizeMemberEmail(user.email) === normalizeMemberEmail(profile.email)));
    return canonical ? safeUser(canonical) : null;
  }

  function login(req: WorkspaceRequest, settings: AppSettings, identifier: string, password: string) {
    const normalized = identifier.trim().toLowerCase();
    if (isMemberDeleted({ id: '', email: normalized }, settings.deletedMembers)) return { user: null, cookie: null, code: 'INVALID_CREDENTIALS' };
    const user = (settings.manualUsers || []).find(user => normalizeMemberEmail(user.email) === normalized || user.name.trim().toLowerCase() === normalized);
    if (!user) return { user: null, cookie: null, code: 'NOT_MANUAL' };
    if (!user.passwordHash || isMemberDeleted(user, settings.deletedMembers)) return { user: null, cookie: null, code: 'INVALID_CREDENTIALS' };
    const actual = createHash('sha256').update(`national-care-tool-login:${password.trim()}`).digest('hex');
    const expected = Buffer.from(user.passwordHash);
    const supplied = Buffer.from(actual);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return { user: null, cookie: null, code: 'INVALID_CREDENTIALS' };
    const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: now() + MAX_AGE * 1000, version: credentialVersion(user) })).toString('base64url');
    return { user: safeUser(user), cookie: cookie(req, `${payload}.${sign(payload)}`), code: null };
  }

  return { authenticate, loadProfiles, login, clearCookie: (req: WorkspaceRequest) => cookie(req, '', 0) };
}

/** Cookie-authenticated JSON writes must originate from this workspace. */
export function isSameOriginRequest(req: WorkspaceRequest): boolean {
  const origin = header(req, 'origin');
  if (!origin) return true;
  try { return new URL(origin).host === (header(req, 'x-forwarded-host') || header(req, 'host')); }
  catch { return false; }
}

export function withoutPrivateSettings(settings: Partial<AppSettings>): Partial<AppSettings> {
  const removePrivate = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(removePrivate);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !['passwordHash', 'password', 'passwordUpdatedAt', 'dailyReports'].includes(key))
      .map(([key, child]) => [key, removePrivate(child)]));
  };
  return removePrivate(settings) as Partial<AppSettings>;
}
