import { config } from 'dotenv';

config({ path: '.env.local' });
config();

function cleanEnvValue(value: string | undefined) {
  return value?.trim().replace(/^['"]|['"]$/g, '');
}

const supabaseUrl = cleanEnvValue(process.env.VITE_SUPABASE_URL);
const supabaseAnonKey = cleanEnvValue(process.env.VITE_SUPABASE_ANON_KEY);

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

if (!supabaseUrl) {
  fail('Missing VITE_SUPABASE_URL.');
}

let parsedUrl: URL;
try {
  parsedUrl = new URL(supabaseUrl);
} catch {
  fail('VITE_SUPABASE_URL must be a URL like https://project-ref.supabase.co.');
}

if (!parsedUrl.hostname.endsWith('.supabase.co')) {
  fail('VITE_SUPABASE_URL must be your Supabase project URL, not an API key or database connection string.');
}

if (!supabaseAnonKey) {
  fail('Missing VITE_SUPABASE_ANON_KEY.');
}

if (supabaseAnonKey.startsWith('sb_secret_')) {
  fail('VITE_SUPABASE_ANON_KEY cannot use an sb_secret key. Use the publishable or legacy anon public key.');
}

if (!supabaseAnonKey.startsWith('sb_publishable_') && !supabaseAnonKey.startsWith('eyJ')) {
  fail('VITE_SUPABASE_ANON_KEY does not look like a Supabase publishable or anon public key.');
}

console.log('PASS Environment variables are valid for a browser Supabase client.');
