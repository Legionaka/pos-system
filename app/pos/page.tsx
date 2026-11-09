import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { signOutAction } from '@/app/auth/actions';
import { createClient } from '@/lib/supabase/server';
import { getStoreSettings } from '@/lib/store-settings';
import { PosScreen, type PosProduct, type PosCategory, type PosShift } from './pos-screen';

export const metadata = { title: 'Point of sale | TrueMarket' };

export default function PosPage() {
  return (
    <Suspense fallback={<PosLoading />}>
      <PosContent />
    </Suspense>
  );
}

async function PosContent() {
  await connection();
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (typeof userId !== 'string') redirect('/login');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('name, role, active')
    .eq('id', userId)
    .maybeSingle();

  if (profileError || !profile?.active) redirect('/login');
  if (profile.role !== 'cashier') {
    return (
      <main className="pos-access-denied">
        <section>
          <p className="pos-eyebrow">STAFF WORKSPACE</p>
          <h1>Cashier access required</h1>
          <p>The point of sale is available to active cashier accounts.</p>
          <form action={signOutAction}>
            <button className="pos-button pos-button--secondary" type="submit">Sign out</button>
          </form>
        </section>
      </main>
    );
  }

  const [productsResult, categoriesResult, shiftResult] = await Promise.all([
    supabase
      .from('products')
      .select('id, sku, barcode, name, price_cents, tax_category, stock_qty, category_id, active, image_path')
      .eq('active', true)
      .order('name'),
    supabase.from('categories').select('id, name').order('name'),
    supabase
      .from('shifts')
      .select('id, opened_at, opening_cash_cents')
      .eq('user_id', userId)
      .is('closed_at', null)
      .maybeSingle(),
  ]);
  const { data: heldRows, error: heldError } = shiftResult.data
    ? await supabase.from('held_sales').select('id, label, created_at').eq('shift_id', shiftResult.data.id).order('created_at', { ascending: false }).limit(30)
    : { data: [], error: null };
  const heldIds = (heldRows ?? []).map((row) => row.id);
  const { data: heldItemRows, error: heldItemsError } = heldIds.length
    ? await supabase.from('held_sale_items').select('held_sale_id, product_id, qty').in('held_sale_id', heldIds)
    : { data: [], error: null };
  const { data: checkoutPaused, error: countStateError } = await supabase.rpc('inventory_checkout_paused');
  const store = await getStoreSettings();

  const products: PosProduct[] = (productsResult.data ?? []).map((product) => ({ ...product, image_url: product.image_path && process.env.NEXT_PUBLIC_SUPABASE_URL ? `${process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/product-images/${product.image_path}` : null }));
  const categories: PosCategory[] = categoriesResult.data ?? [];
  const shift: PosShift | null = shiftResult.data;
  const loadError = productsResult.error || categoriesResult.error || shiftResult.error || heldError || heldItemsError || countStateError
    ? 'Some store data could not be loaded. Refresh this page or contact the store owner.'
    : null;

  return (
    <PosScreen
      cashierName={profile.name || 'Cashier'}
      products={products}
      categories={categories}
      shift={shift}
      loadError={loadError}
      storeName={store.storeName}
      storeLogoUrl={store.logoUrl}
      heldSales={(heldRows ?? []).map((row) => ({ ...row, items: (heldItemRows ?? []).filter((item) => item.held_sale_id === row.id).map(({ product_id, qty }) => ({ productId: product_id, qty })) }))}
      checkoutPaused={Boolean(checkoutPaused)}
    />
  );
}

function PosLoading() {
  return (
    <main className="pos-loading" aria-busy="true" aria-label="Loading point of sale">
      <span className="pos-loading-mark" />
      <p>Preparing the store workspace…</p>
    </main>
  );
}
