import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { signOutAction } from '@/app/auth/actions';
import { createClient } from '@/lib/supabase/server';
import { ProductCatalog, type CatalogProduct, type CatalogCategory } from './product-catalog';

export const metadata = { title: 'Product catalog | TrueMarket' };

export default function CatalogPage() {
  return (
    <Suspense fallback={<CatalogLoading />}>
      <CatalogContent />
    </Suspense>
  );
}

async function CatalogContent() {
  await connection();
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== 'string') redirect('/login');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('name, role, active')
    .eq('id', userId)
    .maybeSingle();
  if (profileError || !profile?.active) redirect('/login');

  if (profile.role !== 'manager' && profile.role !== 'owner') {
    return (
      <main className="catalog-access-denied">
        <section>
          <p className="catalog-eyebrow">STAFF WORKSPACE</p>
          <h1>Manager access required</h1>
          <p>Product and inventory controls are available to active manager and owner accounts.</p>
          <form action={signOutAction}><button className="catalog-button" type="submit">Sign out</button></form>
        </section>
      </main>
    );
  }

  const [productsResult, categoriesResult] = await Promise.all([
    supabase
      .from('products')
      .select('id, sku, barcode, name, price_cents, tax_category, stock_qty, reorder_at, active, category_id, updated_at')
      .order('name'),
    supabase.from('categories').select('id, name').order('name'),
  ]);

  return (
    <ProductCatalog
      managerName={profile.name || 'Manager'}
      products={(productsResult.data ?? []) as CatalogProduct[]}
      categories={(categoriesResult.data ?? []) as CatalogCategory[]}
      loadError={productsResult.error || categoriesResult.error
        ? 'Catalog data could not be loaded. Refresh this page or contact the store owner.'
        : null}
    />
  );
}

function CatalogLoading() {
  return (
    <main className="catalog-loading" aria-busy="true" aria-label="Loading product catalog">
      <span className="catalog-loading-mark" />
      <p>Loading product catalog…</p>
    </main>
  );
}

