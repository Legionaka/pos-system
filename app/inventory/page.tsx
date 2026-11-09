import { Suspense } from 'react';
import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getStoreSettings } from '@/lib/store-settings';
import { WorkspaceHeader, WorkspaceShell, WorkspaceLoading } from '@/app/workspace/workspace-shell';
import { InventoryWorkspace, type CountItem, type DeliveryItem, type InventoryProduct } from './workspace';

export const metadata = { title: 'Inventory | TrueMarket' };

async function loadAllPages<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const result = await query(from, from + 999);
    if (result.error) return { rows, error: result.error };
    rows.push(...(result.data ?? []));
    if ((result.data ?? []).length < 1000) return { rows, error: null };
  }
}

export default function InventoryPage() {
  return <Suspense fallback={<WorkspaceLoading label="Loading inventory" />}><InventoryContent /></Suspense>;
}

async function InventoryContent() {
  await connection();
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== 'string') redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('name, role, active').eq('id', userId).maybeSingle();
  if (!profile?.active) redirect('/login');
  if (profile.role !== 'manager' && profile.role !== 'owner') redirect(profile.role === 'dev' ? '/dev' : '/pos');

  const [productsResult, deliveriesResult, countResult] = await Promise.all([
    loadAllPages((from, to) => supabase.from('products').select('id, sku, barcode, name, stock_qty, reorder_at, active, image_path').order('name').range(from, to)),
    supabase.from('inventory_deliveries').select('id, supplier_name, delivery_date, reference, notes, created_at').order('created_at', { ascending: false }).limit(30),
    supabase.from('inventory_counts').select('id, status, started_at').eq('status', 'in_progress').maybeSingle(),
  ]);
  const deliveryIds = (deliveriesResult.data ?? []).map((delivery) => delivery.id);
  const [deliveryItemsResult, countItemsResult] = await Promise.all([
    deliveryIds.length ? loadAllPages<DeliveryItem>((from, to) => supabase.from('inventory_delivery_items').select('id, delivery_id, product_name, sku, qty, unit_cost_cents').in('delivery_id', deliveryIds).order('created_at').range(from, to)) : Promise.resolve({ rows: [] as DeliveryItem[], error: null }),
    countResult.data ? loadAllPages<CountItem>((from, to) => supabase.from('inventory_count_items').select('id, count_id, product_id, product_name, sku, expected_qty, counted_qty').eq('count_id', countResult.data!.id).order('product_name').range(from, to)) : Promise.resolve({ rows: [] as CountItem[], error: null }),
  ]);
  const store = await getStoreSettings();
  const page = <div className="workspace-page">
    <WorkspaceHeader eyebrow="STORE MANAGEMENT / STOCK CONTROL" title="Inventory" description="Record supplier deliveries, review stock history, and run a full-store count." />
    {(productsResult.error || deliveriesResult.error || deliveryItemsResult.error || countResult.error || countItemsResult.error) && <p className="workspace-alert" role="alert">Some inventory data could not be loaded. Refresh and try again.</p>}
    <InventoryWorkspace
      products={productsResult.rows as InventoryProduct[]}
      deliveries={deliveriesResult.data ?? []}
      deliveryItems={deliveryItemsResult.rows}
      activeCount={countResult.data ?? null}
      countItems={countItemsResult.rows}
    />
  </div>;
  return profile.role === 'owner'
    ? <WorkspaceShell role="owner" name={profile.name || 'Owner'} store={store}>{page}</WorkspaceShell>
    : <main className="workspace-manager-page"><header className="catalog-topbar"><a href="/catalog">{store.storeName}</a><nav><a href="/catalog">Products</a><a href="/sales">Sales history</a><a href="/reports">Reports</a></nav></header>{page}</main>;
}
