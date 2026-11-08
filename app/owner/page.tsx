import Link from 'next/link';
import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { WorkspaceHeader } from '@/app/workspace/workspace-shell';
import type { Json } from '@/lib/supabase/database';

type Summary = { sales_total_cents: number; sales_count: number; open_shift_count: number; low_stock_count: number; low_stock_products: Array<{ id: string; name: string; sku: string; stock_qty: number; reorder_at: number }> };
function isSummary(value: Json): value is Summary {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && typeof value.sales_total_cents === 'number' && typeof value.sales_count === 'number'
    && typeof value.open_shift_count === 'number' && typeof value.low_stock_count === 'number'
    && Array.isArray(value.low_stock_products);
}
const money = (cents: number) => `R${(cents / 100).toFixed(2)}`;

export default async function OwnerOverviewPage() {
  await connection();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('owner_dashboard_summary');
  const summary = data && isSummary(data) ? data : null;
  return (
    <div className="workspace-page">
      <WorkspaceHeader eyebrow="OWNER WORKSPACE / TODAY" title="Store overview" description="A quick view of today’s trading and the work that needs attention." />
      {error && <p className="workspace-alert" role="alert">Dashboard data could not be loaded. Check that the latest database migration has been applied.</p>}
      <section className="workspace-metrics" aria-label="Today at a glance">
        <article><span>Completed sales today</span><strong>{money(summary?.sales_total_cents ?? 0)}</strong><small>{summary?.sales_count ?? 0} completed {summary?.sales_count === 1 ? 'sale' : 'sales'}</small></article>
        <article><span>Open shifts</span><strong>{summary?.open_shift_count ?? '—'}</strong><small>Cashiers currently on shift</small></article>
        <article><span>Low-stock products</span><strong>{summary?.low_stock_count ?? '—'}</strong><small>At or below reorder level</small></article>
      </section>
      <div className="workspace-two-column">
        <section className="workspace-card" aria-labelledby="low-stock-title">
          <div className="workspace-card-heading"><div><p className="workspace-eyebrow">STOCK TO REVIEW</p><h2 id="low-stock-title">Low stock</h2></div><Link href="/catalog">Open catalog</Link></div>
          {!summary?.low_stock_products.length ? <div className="workspace-empty"><strong>Nothing needs attention</strong><p>Active products at or below their reorder point will appear here.</p></div> : (
            <ul className="workspace-stock-list">{summary.low_stock_products.map((product) => <li key={product.id}><div><strong>{product.name}</strong><small>{product.sku}</small></div><span>{product.stock_qty} left <small>· reorder at {product.reorder_at}</small></span></li>)}</ul>
          )}
        </section>
        <section className="workspace-card" aria-labelledby="tasks-title">
          <div className="workspace-card-heading"><div><p className="workspace-eyebrow">STORE TASKS</p><h2 id="tasks-title">Manage the store</h2></div></div>
          <div className="workspace-task-links">
            <Link href="/owner/team"><strong>Manage your team</strong><span>Invite staff and update cashier or manager access</span></Link>
            <Link href="/owner/shifts"><strong>Review shifts</strong><span>Check open tills and completed cash counts</span></Link>
            <Link href="/owner/store"><strong>Update store profile</strong><span>Change the name and logo used across the app</span></Link>
            <Link href="/sales"><strong>Review sales history</strong><span>Open receipts and inspect completed transactions</span></Link>
          </div>
        </section>
      </div>
    </div>
  );
}
