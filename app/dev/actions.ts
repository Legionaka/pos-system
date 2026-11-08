'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

async function requireDev() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const id = claims?.claims?.sub;
  if (typeof id !== 'string') throw new Error('Sign in to continue.');
  const { data: profile } = await supabase.from('profiles').select('active, role').eq('id', id).maybeSingle();
  if (!profile?.active || profile.role !== 'dev') throw new Error('An active developer account is required.');
  return supabase;
}

export async function setFeatureFlagAction(formData: FormData) {
  const key = formData.get('key');
  const enabled = formData.get('enabled');
  if (typeof key !== 'string' || !key || !['true', 'false'].includes(String(enabled))) return;
  try {
    const supabase = await requireDev();
    await supabase.rpc('set_feature_flag', { p_key: key, p_enabled: enabled === 'true' });
    revalidatePath('/dev/features');
  } catch { /* The RPC enforces dev access and registration at the database boundary. */ }
}
