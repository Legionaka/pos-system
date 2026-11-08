import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { WorkspaceHeader } from '@/app/workspace/workspace-shell';
import { DevActivity } from './dev-activity';

export default async function DevActivityPage() {
  await connection();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('dev_activity_feed', { p_limit: 100 });
  return <div className="workspace-page workspace-dev-page"><WorkspaceHeader eyebrow="DEVELOPER WORKSPACE / DIAGNOSTICS" title="Technical activity" description="A limited event feed showing event types and timestamps only. User identities, record IDs, and event metadata are not returned." />
    {error && <p className="workspace-alert" role="alert">Technical activity could not be loaded.</p>}
    <DevActivity events={data ?? []} />
  </div>;
}
