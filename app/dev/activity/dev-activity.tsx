'use client';

import { useMemo, useState } from 'react';
type Event = { id: string; action: string; entity_type: string | null; created_at: string };
export function DevActivity({ events }: { events: Event[] }) {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => { const q = query.trim().toLowerCase(); return events.filter((event) => !q || `${event.action} ${event.entity_type ?? ''}`.toLowerCase().includes(q)); }, [events, query]);
  return <section className="workspace-card"><div className="workspace-filters"><label className="workspace-search">Search event type<input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="e.g. shift_opened" /></label><span>{rows.length} shown · latest 100</span></div>
    {!rows.length ? <div className="workspace-empty"><strong>{events.length ? 'No technical events match' : 'No technical activity available'}</strong><p>{events.length ? 'Try another event type.' : 'Redacted application events will appear as they are recorded.'}</p></div> : <div className="workspace-activity-list">{rows.map((event) => <article key={event.id}><span className="workspace-activity-mark" /><div className="workspace-activity-main"><strong>{event.action.replaceAll('_', ' ')}</strong><p>{event.entity_type || 'Application event'}</p></div><time>{new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' }).format(new Date(event.created_at))}</time></article>)}</div>}
  </section>;
}
