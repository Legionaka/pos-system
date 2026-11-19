import { createClient } from '@/lib/supabase/server';

const quote = (value: string | number | boolean | null) => {
  let safe = String(value ?? '').replace(/[\r\n]+/g, ' ');
  if (/^\s*[=+@-]/u.test(safe)) safe = `'${safe}`;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function GET() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== 'string') return Response.json({ error: 'Sign in to export the catalog.' }, { status: 401 });
  const { data: profile } = await supabase.from('profiles').select('active, role').eq('id', userId).maybeSingle();
  if (!profile?.active || (profile.role !== 'owner' && profile.role !== 'manager')) return Response.json({ error: 'Catalog export is restricted to managers and owners.' }, { status: 403 });
  const products: Array<{ sku: string; barcode: string | null; name: string; price_cents: number; tax_category: string; reorder_at: number; active: boolean }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('products').select('sku, barcode, name, price_cents, tax_category, reorder_at, active').order('name').range(from, from + 999);
    if (error) return Response.json({ error: 'Catalog could not be exported.' }, { status: 500 });
    products.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const rows = [['sku', 'barcode', 'name', 'price', 'tax_category', 'reorder_at', 'active'], ...products.map((product) => [product.sku, product.barcode, product.name, (product.price_cents / 100).toFixed(2), product.tax_category, product.reorder_at, product.active])];
  const body = `\uFEFF${rows.map((row) => row.map((cell) => quote(cell as string | number | boolean | null)).join(',')).join('\r\n')}`;
  return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="catalog.csv"', 'Cache-Control': 'private, no-store' } });
}
