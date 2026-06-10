import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve('.env.local') });

const url = process.env.VITE_SUPABASE_URL || '';
const key = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(url, key);

async function test() {
  const { data, error } = await supabase.from('app_settings').select('*');
  if (error) {
    console.error('Error fetching settings:', error.message);
  } else {
    console.log('Success! Settings fetched successfully:', JSON.stringify(data, null, 2));
  }
}

test();
