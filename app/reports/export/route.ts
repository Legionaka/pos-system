import { createClient } from '@/lib/supabase/server';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const isValidDate = (value: string) => datePattern.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const csv = (value: string | number | null) => {
  let safe = String(value ?? '').replace(/[\r\n]+/g, ' ');
  if (/^\s*[=+@-]/u.test(safe)) safe = `'${safe}`;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  if (!isValidDate(from) || !isValidDate(to) || to < from || (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 > 364) {
    return Response.json({ error: 'Choose a valid date range of up to 365 days.' }, { status: 400 });
  }
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const id = claims?.claims?.sub;
  if (typeof id !== 'string') return Response.json({ error: 'Sign in to download reports.' }, { status: 401 });
  const { data: profile } = await supabase.from('profiles').select('active, role').eq('id', id).maybeSingle();
  if (!profile?.active || (profile.role !== 'owner' && profile.role !== 'manager')) return Response.json({ error: 'Report access is restricted to managers and owners.' }, { status: 403 });
  const start = new Date(`${from}T00:00:00+02:00`).toISOString();
  const end = new Date(new Date(`${to}T00:00:00+02:00`).getTime() + 86400000).toISOString();
  const { data: sales, error, count } = await supabase.from('sales').select('id, number, cashier_id, status, subtotal_cents, discount_cents, vat_cents, total_cents, created_at', { count: 'exact' })
    .gte('created_at', start).lt('created_at', end).neq('status', 'voided').order('created_at').range(0, 19999);
  if (error) return Response.json({ error: 'Report rows could not be loaded.' }, { status: 500 });
  if ((count ?? 0) > 20000) return Response.json({ error: 'This export is over 20,000 sales. Choose a shorter date range.' }, { status: 413 });
  const ids = (sales ?? []).map((sale) => sale.id);
  const cashierIds = [...new Set((sales ?? []).map((sale) => sale.cashier_id))];
  const [profilesResult, paymentsResult, refundsResult] = ids.length ? await Promise.all([
    supabase.from('profiles').select('id, name, email').in('id', cashierIds),
    supabase.from('payments').select('sale_id, method, amount_cents, reference').in('sale_id', ids),
    supabase.from('refunds').select('id, sale_id, total_cents').in('sale_id', ids),
  ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  if (profilesResult.error || paymentsResult.error || refundsResult.error) return Response.json({ error: 'Report details could not be loaded.' }, { status: 500 });
  const refundIds = (refundsResult.data ?? []).map((refund) => refund.id);
  const { data: refundPayouts, error: payoutError } = refundIds.length
    ? await supabase.from('refund_payments').select('refund_id, method, amount_cents, reference').in('refund_id', refundIds)
    : { data: [], error: null };
  if (payoutError) return Response.json({ error: 'Refund payout details could not be loaded.' }, { status: 500 });
  const nameById = new Map((profilesResult.data ?? []).map((person) => [person.id, person.name || person.email || 'Staff member']));
  const refundBySale = new Map<string, number>();
  for (const refund of refundsResult.data ?? []) refundBySale.set(refund.sale_id, (refundBySale.get(refund.sale_id) ?? 0) + refund.total_cents);
  const paymentBySale = new Map<string, string[]>();
  for (const payment of paymentsResult.data ?? []) {
    const values = paymentBySale.get(payment.sale_id) ?? [];
    values.push(`${payment.method} ${payment.amount_cents}${payment.reference ? ` (${payment.reference})` : ''}`);
    paymentBySale.set(payment.sale_id, values);
  }
  const payoutsByRefund = new Map<string, string[]>();
  for (const payout of refundPayouts ?? []) {
    const values = payoutsByRefund.get(payout.refund_id) ?? [];
    values.push(`${payout.method} ${payout.amount_cents}${payout.reference ? ` (${payout.reference})` : ''}`);
    payoutsByRefund.set(payout.refund_id, values);
  }
  const refundMethodsBySale = new Map<string, string[]>();
  for (const refund of refundsResult.data ?? []) refundMethodsBySale.set(refund.sale_id, [...(refundMethodsBySale.get(refund.sale_id) ?? []), ...(payoutsByRefund.get(refund.id) ?? [])]);
  const rows = [
    ['Date (Africa/Johannesburg)', 'Sale number', 'Cashier', 'Status', 'Subtotal cents', 'Discount cents', 'VAT cents', 'Gross total cents', 'Refund total cents', 'Net cents', 'Sale payments', 'Refund payouts'],
    ...(sales ?? []).map((sale) => [new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Johannesburg', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(sale.created_at)), sale.number, nameById.get(sale.cashier_id) ?? 'Staff member', sale.status, sale.subtotal_cents, sale.discount_cents, sale.vat_cents, sale.total_cents, refundBySale.get(sale.id) ?? 0, sale.total_cents - (refundBySale.get(sale.id) ?? 0), (paymentBySale.get(sale.id) ?? []).join('; '), (refundMethodsBySale.get(sale.id) ?? []).join('; ')])
  ];
  const body = `\uFEFF${rows.map((row) => row.map(csv).join(',')).join('\r\n')}`;
  return new Response(body, { headers: {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="sales-report-${from}-to-${to}.csv"`,
    'Cache-Control': 'private, no-store',
  } });
}
