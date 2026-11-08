import { Suspense, type ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getStoreSettings } from '@/lib/store-settings';
import { WorkspaceLoading, WorkspaceShell } from '@/app/workspace/workspace-shell';

export default function DevLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<WorkspaceLoading />}><DevFrame>{children}</DevFrame></Suspense>;
}

async function DevFrame({ children }: { children: ReactNode }) {
  await connection();
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const id = claims?.claims?.sub;
  if (typeof id !== 'string') redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('name, role, active').eq('id', id).maybeSingle();
  if (!profile?.active) redirect('/login');
  if (profile.role !== 'dev') redirect(profile.role === 'owner' ? '/owner' : profile.role === 'cashier' ? '/pos' : '/catalog');
  const store = await getStoreSettings();
  return <WorkspaceShell role="dev" name={profile.name || 'Developer'} store={store}>{children}</WorkspaceShell>;
}
