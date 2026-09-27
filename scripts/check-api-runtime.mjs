import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entries = ['api/app-state.ts', 'api/metadata.ts', 'api/cron/deadline-reminders.ts', 'api/drive/resumable-upload.ts'];

if (process.argv[2] === '--check') {
  const buildRoot = process.argv[3];
  const load = relative => import(pathToFileURL(path.join(buildRoot, relative)).href);
  for (const entry of entries) {
    assert.equal(typeof (await load(entry.replace(/\.ts$/, '.js'))).default, 'function');
  }
  const { createAppStateHandler } = await load('api/app-state.js');
  const { createWorkspaceAuth } = await load('server/workspaceAuth.js');
  const member = { id: 'runtime-check', name: 'Runtime Check', email: 'runtime@example.test', role: 'team_member',
    passwordHash: createHash('sha256').update('national-care-tool-login:runtime-test-password').digest('hex') };
  const sql = async parts => {
    const query = parts.join('?').replace(/\s+/g, ' ').trim();
    if (query.startsWith('CREATE TABLE') || query.startsWith('SELECT record') || query.startsWith('SELECT workflow_id')) return [];
    if (query.startsWith('SELECT state, updated_at')) return [{ state: { settings: { manualUsers: [member] }, tasks: [], notifications: [] }, updated_at: '2026-09-28T00:00:00Z' }];
    throw new Error(`Unexpected runtime-check query: ${query}`);
  };
  const handler = createAppStateHandler(() => sql, createWorkspaceAuth({ env: { WORKSPACE_SESSION_SECRET: 'runtime-check-only', NODE_ENV: 'production' } }));
  async function request(method, url, body, headers = {}) {
    const result = { status: 0, body: null, headers: {} };
    await handler({ method, url, body, headers: { host: 'workspace.test', ...headers } }, {
      setHeader: (name, value) => { result.headers[name] = value; },
      status: code => { result.status = code; return { json: value => { result.body = value; }, end() {} }; },
    });
    return result;
  }
  const anonymous = await request('GET', '/api/app-state?auth=session');
  assert.equal(anonymous.status, 200);
  assert.deepEqual(anonymous.body, { user: null });
  const login = await request('POST', '/api/app-state?auth=login', { identifier: member.email, password: 'runtime-test-password' });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.id, member.id);
  assert.equal(login.body.user.passwordHash, undefined);
  assert.match(login.headers['Set-Cookie'], /HttpOnly; SameSite=Lax.*Secure/);
  const session = await request('GET', '/api/app-state?auth=session', undefined, { cookie: login.headers['Set-Cookie'].split(';')[0] });
  assert.equal(session.status, 200);
  assert.equal(session.body.user.id, member.id);
  const rejected = await request('POST', '/api/app-state?auth=login', { identifier: member.email, password: 'wrong-password' });
  assert.equal(rejected.status, 401);
  assert.equal(rejected.body.code, 'INVALID_CREDENTIALS');
  console.log('PASS Plain Node.js: all API modules load; login, secure session, and invalid-password responses work.');
} else {
  // Preserve emitted import specifiers: bundling or tsx would hide Node ESM failures.
  const outputRoot = path.join(projectRoot, 'output');
  fs.mkdirSync(outputRoot, { recursive: true });
  const buildRoot = fs.mkdtempSync(path.join(outputRoot, 'api-runtime-'));
  try {
    fs.writeFileSync(path.join(buildRoot, 'package.json'), '{"type":"module"}');
    const visited = new Set();
    const compile = source => {
      if (visited.has(source)) return;
      visited.add(source);
      const relative = path.relative(projectRoot, source);
      assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), 'API dependency must stay inside the project');
      const emitted = ts.transpileModule(fs.readFileSync(source, 'utf8'), { fileName: source,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, isolatedModules: true, esModuleInterop: true } }).outputText;
      const destination = path.join(buildRoot, relative.replace(/\.tsx?$/, '.js'));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, emitted);
      for (const { fileName: specifier } of ts.preProcessFile(emitted).importedFiles) {
        if (!specifier.startsWith('.')) continue;
        const base = path.resolve(path.dirname(source), specifier);
        const candidates = [base.replace(/\.js$/, '.ts'), base, `${base}.ts`, `${base}.tsx`];
        const dependency = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        assert.ok(dependency, `Cannot resolve ${specifier} from ${relative}`);
        compile(dependency);
      }
    };
    entries.forEach(entry => compile(path.join(projectRoot, entry)));
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--check', buildRoot], { cwd: projectRoot, stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    assert.equal(path.dirname(path.resolve(buildRoot)), outputRoot);
    fs.rmSync(buildRoot, { recursive: true, force: true });
  }
}
