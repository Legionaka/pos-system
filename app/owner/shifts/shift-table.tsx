'use client';

import { useMemo, useState } from 'react';
export type ShiftRecord = { id: string; user_id: string; opened_at: string; closed_at: string | null; opening_cash_cents: number; expected_cash_cents: number | null; counted_cash_cents: number | null; cash_variance_cents: number | null; cashier_name: string };
const money = (cents: number | null) => cents === null ? '—' : `R${(cents / 100).toFixed(2)}`;
const dayStart = (date: string) => { const parsed = new Date(date); parsed.setHours(0, 0, 0, 0); return parsed.getTime(); };
export function ShiftTable({ shifts, referenceTime }: { shifts: ShiftRecord[]; referenceTime: number }) {
  const [status, setStatus] = useState('all');
  const [range, setRange] = useState('all');
  const visible = useMemo(() => {
    const since = range === 'all' ? 0
      : range === 'today' ? dayStart(new Date(referenceTime).toISOString())
        : range === '7d' ? referenceTime - 7 * 86400000 : referenceTime - 30 * 86400000;
    return shifts.filter((shift) => (status === 'all' || (status === 'open' ? !shift.closed_at : Boolean(shift.closed_at))) && new Date(shift.opened_at).getTime() >= since);
  }, [shifts, status, range, referenceTime]);
  return <section className="workspace-card"><div className="workspace-filters"><label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All shifts</option><option value="open">Open</option><option value="closed">Closed</option></select></label><label>Date range<select value={range} onChange={(event) => setRange(event.target.value)}><option value="all">All recent</option><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label><span>{visible.length} shown</span></div>
    {!visible.length ? <div className="workspace-empty"><strong>No shifts match these filters</strong><p>Try a wider date range or another status.</p></div> : <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Cashier</th><th>Opened</th><th>Status</th><th>Opening cash</th><th>Expected</th><th>Counted</th><th>Variance</th></tr></thead><tbody>{visible.map((shift) => <tr key={shift.id}><td><strong>{shift.cashier_name}</strong></td><td>{new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' }).format(new Date(shift.opened_at))}</td><td><span className={`workspace-status ${shift.closed_at ? '' : 'is-active'}`}>{shift.closed_at ? 'Closed' : 'Open'}</span></td><td>{money(shift.opening_cash_cents)}</td><td>{money(shift.expected_cash_cents)}</td><td>{money(shift.counted_cash_cents)}</td><td className={shift.cash_variance_cents && shift.cash_variance_cents !== 0 ? 'workspace-variance' : ''}>{money(shift.cash_variance_cents)}</td></tr>)}</tbody></table></div>}
  </section>;
}
