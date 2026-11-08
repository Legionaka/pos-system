import Link from 'next/link';
import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { WorkspaceHeader } from '@/app/workspace/workspace-shell';

export default async function DevOverviewPage() {
  await connection();
  const supabase = await createClient();
  const [{ data: store, error: storeError }, { data: flags, error: flagsError }, { data: activity, error: activityError }] = await Promise.all([
    supabase.from('store_settings').select('store_name').eq('singleton', true).maybeSingle(),
    supabase.from('feature_flag_registry').select('key').limit(100),
    supabase.rpc('dev_activity_feed', { p_limit: 6 }),
  ]);
  const unavailable = storeError || flagsError || activityError;
  return <div className="workspace-page workspace-dev-page"><WorkspaceHeader eyebrow="DEVELOPER WORKSPACE / SUPPORT" title="System overview" description="Technical status for the single-store application. This workspace excludes customer and financial data." />
    {unavailable && <p className="workspace-alert" role="alert">One or more support checks failed. Confirm the latest database migration is applied and refresh.</p>}
    <section className="workspace-metrics workspace-metrics--dev" aria-label="System availability">
      <article><span>Database connection</span><strong className={storeError ? 'workspace-state-bad' : 'workspace-state-good'}>{storeError ? 'Unavailable' : 'Available'}</strong><small>Verified with the store settings endpoint</small></article>
      <article><span>Store configuration</span><strong>{store?.store_name ?? 'Not found'}</strong><small>Single-store environment</small></article>
      <article><span>Registered feature flags</span><strong>{flags?.length ?? '—'}</strong><small>Flags with application consumers</small></article>
    </section>
    <div className="workspace-two-column">
      <section className="workspace-card"><div className="workspace-card-heading"><div><p className="workspace-eyebrow">REDACTED EVENTS</p><h2>Recent technical activity</h2></div><Link href="/dev/activity">View all</Link></div>
        {!activity?.length ? <div className="workspace-empty"><strong>No events available</strong><p>Redacted support events will appear here as the application records activity.</p></div> : <div className="workspace-activity-list">{activity.map((event) => <article key={event.id}><span className="workspace-activity-mark" /><div className="workspace-activity-main"><strong>{event.action.replaceAll('_', ' ')}</strong><p>{event.entity_type || 'Application event'}</p></div><time>{new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' }).format(new Date(event.created_at))}</time></article>)}</div>}
      </section>
      <section className="workspace-card"><div className="workspace-card-heading"><div><p className="workspace-eyebrow">SUPPORT ACTIONS</p><h2>System tools</h2></div></div><div className="workspace-task-links"><Link href="/dev/features"><strong>Review feature flags</strong><span>Only registered and implemented flags can be changed</span></Link><Link href="/dev/activity"><strong>Inspect technical activity</strong><span>View redacted event types and timestamps</span></Link></div><p className="workspace-note">Dev accounts do not have access to sales, payment, stock movement, or product price data.</p></section>
    </div>
  </div>;
}
