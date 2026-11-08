import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { WorkspaceHeader } from '@/app/workspace/workspace-shell';
import { OwnerActivity } from './owner-activity';

export default async function OwnerActivityPage() {
  await connection();
  const supabase = await createClient();
  const { data: logs, error } = await supabase.from('audit_logs').select('id, user_id, action, entity_type, entity_id, meta, created_at').order('created_at', { ascending: false }).limit(200);
  const ids = [...new Set((logs ?? []).flatMap((log) => log.user_id ? [log.user_id] : []))];
  const { data: profiles, error: profileError } = ids.length ? await supabase.from('profiles').select('id, name, email').in('id', ids) : { data: [], error: null };
  const people = new Map((profiles ?? []).map((p) => [p.id, p.name || p.email || 'System']));
  return <div className="workspace-page"><WorkspaceHeader eyebrow="OWNER WORKSPACE / AUDIT" title="Activity" description="Search recent staff, product, shift, sale, refund, and store events. Financial metadata is visible only to owners." />
    {(error || profileError) && <p className="workspace-alert" role="alert">Activity could not be loaded.</p>}
    <OwnerActivity events={(logs ?? []).map((log) => ({ ...log, actor: log.user_id ? people.get(log.user_id) ?? 'Staff member' : 'System' }))} />
  </div>;
}
