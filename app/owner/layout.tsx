import { Suspense, type ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getStoreSettings } from '@/lib/store-settings';
import { WorkspaceLoading, WorkspaceShell } from '@/app/workspace/workspace-shell';

export default function OwnerLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<WorkspaceLoading />}><OwnerFrame>{children}</OwnerFrame></Suspense>;
}

async function OwnerFrame({ children }: { children: ReactNode }) {
  await connection();
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const id = claims?.claims?.sub;
  if (typeof id !== 'string') redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('name, role, active').eq('id', id).maybeSingle();
  if (!profile?.active) redirect('/login');
  if (profile.role !== 'owner') redirect(profile.role === 'dev' ? '/dev' : profile.role === 'cashier' ? '/pos' : '/catalog');
  const store = await getStoreSettings();
  return <WorkspaceShell role="owner" name={profile.name || 'Owner'} store={store}>{children}</WorkspaceShell>;
}
