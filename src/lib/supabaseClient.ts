import { createClient } from '@supabase/supabase-js';

function cleanEnvValue(value: string | undefined) {
  return value?.trim().replace(/^['"]|['"]$/g, '');
}

const supabaseUrl = cleanEnvValue(import.meta.env.VITE_SUPABASE_URL);
const supabaseAnonKey = cleanEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY);
const googleAuthEnabled = cleanEnvValue(import.meta.env.VITE_ENABLE_GOOGLE_AUTH);

function isValidUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export const isSupabaseConfigured = Boolean(isValidUrl(supabaseUrl) && supabaseAnonKey);
export const isGoogleAuthEnabled = googleAuthEnabled === 'true';

export const supabase = (() => {
  if (!isSupabaseConfigured) return null;

  try {
    return createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    });
  } catch (error) {
    console.error('Invalid Supabase configuration', error);
    return null;
  }
})();
