import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { WorkspaceHeader } from '@/app/workspace/workspace-shell';
import { setFeatureFlagAction } from '../actions';

export default async function DevFeaturesPage() {
  await connection();
  const supabase = await createClient();
  const [{ data: registered, error }, { data: states, error: statesError }] = await Promise.all([
    supabase.from('feature_flag_registry').select('key, description').order('key'),
    supabase.from('feature_flags').select('key, enabled'),
  ]);
  const enabled = new Map((states ?? []).map((flag) => [flag.key, flag.enabled]));
  return <div className="workspace-page workspace-dev-page"><WorkspaceHeader eyebrow="DEVELOPER WORKSPACE / CONFIGURATION" title="Feature flags" description="Toggle only flags registered against implemented application behavior." />
    {(error || statesError) && <p className="workspace-alert" role="alert">Feature flag data could not be loaded. Apply the latest migration.</p>}
    {!registered?.length ? <section className="workspace-card workspace-empty-card"><div className="workspace-empty"><span className="workspace-empty-symbol">ƒ</span><strong>No feature flags are registered</strong><p>The app currently has no feature flag consumers. A flag will appear here after its behavior is implemented and registered in the database.</p></div></section> : <section className="workspace-card"><div className="workspace-card-heading"><div><p className="workspace-eyebrow">APPLICATION CONTROLS</p><h2>Registered flags</h2></div></div><div className="workspace-feature-list">{registered.map((flag) => <article key={flag.key}><div><strong>{flag.key}</strong><p>{flag.description}</p></div><form action={setFeatureFlagAction}><input type="hidden" name="key" value={flag.key} /><select name="enabled" defaultValue={String(enabled.get(flag.key) ?? false)} aria-label={`${flag.key} state`}><option value="false">Off</option><option value="true">On</option></select><button type="submit">Save</button></form></article>)}</div></section>}
  </div>;
}
