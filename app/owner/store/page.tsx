import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getStoreSettings } from '@/lib/store-settings';
import { WorkspaceHeader } from '@/app/workspace/workspace-shell';
import { StoreSettingsForm } from './store-settings-form';

export default async function OwnerStorePage() {
  await connection();
  const supabase = await createClient();
  const store = await getStoreSettings();
  const { data, error } = await supabase.from('store_settings').select('updated_at').eq('singleton', true).maybeSingle();
  return <div className="workspace-page"><WorkspaceHeader eyebrow="OWNER WORKSPACE / BRAND" title="Store profile" description="Set the store identity shown on staff sign-in, workspaces, and customer receipts." />
    {error && <p className="workspace-alert" role="alert">Could not load store settings. Apply the owner and Dev workspace migration.</p>}
    <StoreSettingsForm storeName={store.storeName} logoUrl={store.logoUrl} updatedAt={data?.updated_at ?? null} />
  </div>;
}
