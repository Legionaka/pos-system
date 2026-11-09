'use client';

type PaymentMethod = 'cash' | 'card' | 'eft' | 'qr';
export type SalesReportData = {
  from: string; to: string;
  summary: { sale_count: number; gross_sales_cents: number; refunds_cents: number; net_sales_cents: number; vat_cents: number };
  payments: Array<{ method: PaymentMethod; sales_cents: number; refunds_cents: number }>;
  cashiers: Array<{ cashier_id: string; name: string; sales_count: number; gross_cents: number; refunds_cents: number }>;
  daily: Array<{ day: string; gross_cents: number; refunds_cents: number }>;
};
const money = (cents: number) => `R${(cents / 100).toFixed(2)}`;
const labels: Record<PaymentMethod, string> = { cash: 'Cash', card: 'Card', eft: 'EFT', qr: 'QR payment' };

export function ReportsView({ data, error, from, to }: { data: SalesReportData | null; error: string | null; from: string; to: string }) {
  return <div className="workspace-stack">
    <section className="workspace-card workspace-report-filters"><form method="get"><label>From<input type="date" name="from" required defaultValue={from} /></label><label>To<input type="date" name="to" required defaultValue={to} /></label><button className="workspace-button" type="submit">Apply dates</button></form>{!error && <a className="workspace-button workspace-button--quiet" href={`/reports/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`}>Download CSV</a>}</section>
    {error && <p className="workspace-alert" role="alert">{error}</p>}
    {!data ? null : <>
      <section className="workspace-metrics workspace-report-metrics"><article><span>Gross sales</span><strong>{money(data.summary.gross_sales_cents)}</strong><small>{data.summary.sale_count} non-voided sales</small></article><article><span>Refunds</span><strong>{money(data.summary.refunds_cents)}</strong><small>Payouts recorded</small></article><article><span>Net sales</span><strong>{money(data.summary.net_sales_cents)}</strong><small>Gross less refunds</small></article><article><span>Net VAT</span><strong>{money(data.summary.vat_cents)}</strong><small>Sales VAT less refunded VAT</small></article></section>
      <div className="workspace-two-column"><section className="workspace-card"><div className="workspace-card-heading"><div><p className="workspace-eyebrow">TENDER BREAKDOWN</p><h2>Payment methods</h2></div></div>{!data.payments.length ? <p className="workspace-muted">No payment activity in this period.</p> : <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Method</th><th>Sales</th><th>Refunds</th><th>Net</th></tr></thead><tbody>{data.payments.map((item) => <tr key={item.method}><td>{labels[item.method]}</td><td>{money(item.sales_cents)}</td><td>{money(item.refunds_cents)}</td><td><strong>{money(item.sales_cents - item.refunds_cents)}</strong></td></tr>)}</tbody></table></div>}</section>
      <section className="workspace-card"><div className="workspace-card-heading"><div><p className="workspace-eyebrow">TEAM PERFORMANCE</p><h2>Cashiers</h2></div></div>{!data.cashiers.length ? <p className="workspace-muted">No cashier activity in this period.</p> : <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Cashier</th><th>Sales</th><th>Gross</th><th>Refunds</th><th>Net</th></tr></thead><tbody>{data.cashiers.map((item) => <tr key={item.cashier_id}><td><strong>{item.name}</strong></td><td>{item.sales_count}</td><td>{money(item.gross_cents)}</td><td>{money(item.refunds_cents)}</td><td><strong>{money(item.gross_cents - item.refunds_cents)}</strong></td></tr>)}</tbody></table></div>}</section></div>
      <section className="workspace-card"><div className="workspace-card-heading"><div><p className="workspace-eyebrow">DAY BY DAY</p><h2>Daily sales</h2></div></div>{!data.daily.length ? <p className="workspace-muted">No sales in this period.</p> : <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Date</th><th>Gross sales</th><th>Refunds</th><th>Net sales</th></tr></thead><tbody>{data.daily.map((item) => <tr key={item.day}><td>{new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeZone: 'Africa/Johannesburg' }).format(new Date(`${item.day}T12:00:00+02:00`))}</td><td>{money(item.gross_cents)}</td><td>{money(item.refunds_cents)}</td><td><strong>{money(item.gross_cents - item.refunds_cents)}</strong></td></tr>)}</tbody></table></div>}</section>
      <p className="workspace-note">Reports exclude voided sales. Refund methods show recorded payouts; this application does not move money or reverse card transactions.</p>
    </>}
  </div>;
}
