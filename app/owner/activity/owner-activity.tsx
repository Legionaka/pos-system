'use client';

import { useMemo, useState } from 'react';
import type { Json } from '@/lib/supabase/database';
type ActivityEvent = { id: string; user_id: string | null; action: string; entity_type: string | null; entity_id: string | null; meta: Json; created_at: string; actor: string };
export function OwnerActivity({ events }: { events: ActivityEvent[] }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => { const q = query.trim().toLowerCase(); return events.filter((e) => !q || [e.action, e.entity_type ?? '', e.actor, e.entity_id ?? '', JSON.stringify(e.meta)].join(' ').toLowerCase().includes(q)); }, [events, query]);
  return <section className="workspace-card"><div className="workspace-filters"><label className="workspace-search">Search activity<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Staff, action, record, or details" /></label><span>{filtered.length} shown · latest 200</span></div>
    {!filtered.length ? <div className="workspace-empty"><strong>{events.length ? 'No activity matches that search' : 'No activity recorded yet'}</strong><p>{events.length ? 'Try a different name or search term.' : 'Store events will appear here as staff work in the system.'}</p></div> : <div className="workspace-activity-list">{filtered.map((event) => <article key={event.id}><span className="workspace-activity-mark" aria-hidden="true" /><div className="workspace-activity-main"><strong>{event.action.replaceAll('_', ' ')}</strong><p>{event.entity_type || 'Store event'}{event.entity_id ? ` · ${event.entity_id}` : ''} · by {event.actor}</p><details><summary>Event details</summary><pre>{JSON.stringify(event.meta, null, 2)}</pre></details></div><time>{new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' }).format(new Date(event.created_at))}</time></article>)}</div>}
  </section>;
}
