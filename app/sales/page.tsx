import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { getRequestTime } from '@/lib/request-time';
import { createClient } from '@/lib/supabase/server';
import { getStoreSettings } from '@/lib/store-settings';
import { WorkspaceShell } from '@/app/workspace/workspace-shell';
import { SalesHistory, type SaleHistoryEntry } from './sales-history';
import type { Database } from '@/lib/supabase/database';

type PaymentMethod = Database['public']['Enums']['payment_method'];

export const metadata = { title: 'Sales history | TrueMarket' };

export default function SalesPage() {
  return (
    <Suspense fallback={<SalesLoading />}>
      <SalesContent />
    </Suspense>
  );
}

async function SalesContent() {
  await connection();
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== 'string') redirect('/login');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, name, role, active')
    .eq('id', userId)
    .maybeSingle();

  if (profileError || !profile?.active) redirect('/login');
  if (profile.role !== 'cashier' && profile.role !== 'manager' && profile.role !== 'owner') {
    return (
      <main className="sales-access-denied">
        <section>
          <p className="sales-eyebrow">STAFF WORKSPACE</p>
          <h1>Sales access unavailable</h1>
          <p>Sales records are limited to active cashier, manager, and owner accounts.</p>
          <a className="sales-button" href="/login">Return to sign in</a>
        </section>
      </main>
    );
  }

  const { data: sales, error: salesError } = await supabase
    .from('sales')
    .select('id, number, cashier_id, shift_id, status, subtotal_cents, vat_cents, discount_cents, rounding_cents, total_cents, cash_received_cents, change_cents, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  const saleRows = sales ?? [];
  const saleIds = saleRows.map((sale) => sale.id);
  const cashierIds = [...new Set(saleRows.map((sale) => sale.cashier_id))];
  const safeSaleIds = saleIds.length ? saleIds : ['00000000-0000-0000-0000-000000000000'];
  const safeCashierIds = cashierIds.length ? cashierIds : [userId];
  const [itemsResult, paymentsResult, profilesResult] = await Promise.all([
    supabase
      .from('sale_items')
      .select('id, sale_id, product_name, sku, qty, unit_price_cents, discount_cents, line_total_cents, tax_category, vat_cents')
      .in('sale_id', safeSaleIds)
      .order('created_at'),
    supabase
      .from('payments')
      .select('id, sale_id, method, amount_cents, received_cents, change_cents, reference')
      .in('sale_id', safeSaleIds),
    supabase
      .from('profiles')
      .select('id, name')
      .in('id', safeCashierIds),
  ]);

  const canReadRefundDetails = profile.role === 'manager' || profile.role === 'owner';
  const { data: refundRows, error: refundsError } = canReadRefundDetails && saleIds.length
    ? await supabase.from('refunds').select('id, number, sale_id, reason, total_cents, rounding_cents, created_at').in('sale_id', saleIds)
    : { data: [], error: null };
  const refundIds = (refundRows ?? []).map((refund) => refund.id);
  const [{ data: refundItemRows, error: refundItemsError }, { data: refundPaymentRows, error: refundPaymentsError }] = canReadRefundDetails && refundIds.length
    ? await Promise.all([
      supabase.from('refund_items').select('sale_item_id, qty, amount_cents').in('refund_id', refundIds),
      supabase.from('refund_payments').select('refund_id, method, amount_cents, reference').in('refund_id', refundIds),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];

  const dataError = Boolean(salesError || itemsResult.error || paymentsResult.error || profilesResult.error || refundsError || refundItemsError || refundPaymentsError);
  const cashierNames = new Map((profilesResult.data ?? []).map((person) => [person.id, person.name]));
  const refundedBySaleItem = new Map<string, { qty: number; amountCents: number }>();
  for (const refundItem of refundItemRows ?? []) {
    const previous = refundedBySaleItem.get(refundItem.sale_item_id) ?? { qty: 0, amountCents: 0 };
    previous.qty += refundItem.qty;
    previous.amountCents += refundItem.amount_cents;
    refundedBySaleItem.set(refundItem.sale_item_id, previous);
  }
  const refundedRoundingBySale = new Map<string, number>();
  for (const refund of refundRows ?? []) {
    refundedRoundingBySale.set(refund.sale_id, (refundedRoundingBySale.get(refund.sale_id) ?? 0) + refund.rounding_cents);
  }
  const refundPaymentsByRefund = new Map<string, Array<{ method: PaymentMethod; amountCents: number; reference: string | null }>>();
  for (const payment of refundPaymentRows ?? []) {
    const list = refundPaymentsByRefund.get(payment.refund_id) ?? [];
    list.push({ method: payment.method, amountCents: payment.amount_cents, reference: payment.reference });
    refundPaymentsByRefund.set(payment.refund_id, list);
  }
  const refundsBySale = new Map<string, SaleHistoryEntry['refunds']>();
  for (const refund of refundRows ?? []) {
    const list = refundsBySale.get(refund.sale_id) ?? [];
    list.push({ number: refund.number, reason: refund.reason, totalCents: refund.total_cents, createdAt: refund.created_at, payments: refundPaymentsByRefund.get(refund.id) ?? [] });
    refundsBySale.set(refund.sale_id, list);
  }
  const itemsBySale = new Map<string, SaleHistoryEntry['items']>();
  for (const item of itemsResult.data ?? []) {
    const items = itemsBySale.get(item.sale_id) ?? [];
    items.push({
      id: item.id,
      name: item.product_name,
      sku: item.sku,
      qty: item.qty,
      unitPriceCents: item.unit_price_cents,
      discountCents: item.discount_cents,
      lineTotalCents: item.line_total_cents,
      taxCategory: item.tax_category,
      vatCents: item.vat_cents,
      refundedQty: refundedBySaleItem.get(item.id)?.qty ?? 0,
      refundedAmountCents: refundedBySaleItem.get(item.id)?.amountCents ?? 0,
    });
    itemsBySale.set(item.sale_id, items);
  }

  const paymentsBySale = new Map<string, SaleHistoryEntry['payments']>();
  for (const payment of paymentsResult.data ?? []) {
    const payments = paymentsBySale.get(payment.sale_id) ?? [];
    payments.push({
      method: payment.method,
      amountCents: payment.amount_cents,
      receivedCents: payment.received_cents,
      changeCents: payment.change_cents,
      reference: payment.reference,
    });
    paymentsBySale.set(payment.sale_id, payments);
  }

  const entries: SaleHistoryEntry[] = saleRows.map((sale) => ({
    id: sale.id,
    number: sale.number,
    cashierId: sale.cashier_id,
    cashierName: cashierNames.get(sale.cashier_id) || (sale.cashier_id === userId ? profile.name : null) || 'Staff member',
    status: sale.status,
    subtotalCents: sale.subtotal_cents,
    vatCents: sale.vat_cents,
    discountCents: sale.discount_cents,
    roundingCents: sale.rounding_cents,
    refundedRoundingCents: refundedRoundingBySale.get(sale.id) ?? 0,
    totalCents: sale.total_cents,
    cashReceivedCents: sale.cash_received_cents,
    changeCents: sale.change_cents,
    createdAt: sale.created_at,
    items: itemsBySale.get(sale.id) ?? [],
    payments: paymentsBySale.get(sale.id) ?? [],
    refunds: refundsBySale.get(sale.id) ?? [],
  }));

  const store = await getStoreSettings();
  const history = (
    <SalesHistory
      entries={entries}
      viewerName={profile.name || 'Staff member'}
      role={profile.role}
      homeHref={profile.role === 'cashier' ? '/pos' : profile.role === 'owner' ? '/owner' : '/catalog'}
      loadError={dataError ? 'Some transaction details could not be loaded. Refresh this page and try again.' : null}
      store={store}
      refundDataAvailable={canReadRefundDetails && !refundsError && !refundItemsError && !refundPaymentsError}
      referenceTime={getRequestTime()}
    />
  );
  return profile.role === 'owner'
    ? <WorkspaceShell role="owner" name={profile.name || 'Owner'} store={store}>{history}</WorkspaceShell>
    : history;
}

function SalesLoading() {
  return (
    <main className="sales-loading" aria-busy="true" aria-label="Loading sales history">
      <span className="sales-loading-mark" />
      <p>Loading sales history…</p>
    </main>
  );
}
