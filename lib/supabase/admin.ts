import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database';

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error('Staff invitations require SUPABASE_SERVICE_ROLE_KEY on the server.');
  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
