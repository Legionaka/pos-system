import { Suspense } from 'react';
import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getStoreSettings } from '@/lib/store-settings';
import { getJohannesburgDate, getJohannesburgDateDaysAgo } from '@/lib/request-time';
import { WorkspaceHeader, WorkspaceLoading, WorkspaceShell } from '@/app/workspace/workspace-shell';
import { ReportsView, type SalesReportData } from './reports-view';

export const metadata = { title: 'Sales reports | TrueMarket' };
type Search = Promise<{ from?: string; to?: string }>;
const dateSchema = /^\d{4}-\d{2}-\d{2}$/;

async function loadAllPages<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const result = await query(from, from + 999);
    if (result.error) return { rows, error: result.error };
    rows.push(...(result.data ?? []));
    if ((result.data ?? []).length < 1000) return { rows, error: null };
  }
}

export default function ReportsPage({ searchParams }: { searchParams: Search }) {
  return <Suspense fallback={<WorkspaceLoading label="Preparing sales report" />}><ReportsContent searchParams={searchParams} /></Suspense>;
}

async function ReportsContent({ searchParams }: { searchParams: Search }) {
  await connection();
  const query = await searchParams;
  const today = getJohannesburgDate();
  const defaultFrom = getJohannesburgDateDaysAgo(29);
  const from = query.from && dateSchema.test(query.from) ? query.from : defaultFrom;
  const to = query.to && dateSchema.test(query.to) ? query.to : today;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const id = claims?.claims?.sub;
  if (typeof id !== 'string') redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('name, role, active').eq('id', id).maybeSingle();
  if (!profile?.active) redirect('/login');
  if (profile.role !== 'owner' && profile.role !== 'manager') redirect(profile.role === 'dev' ? '/dev' : '/pos');
  const { data, error } = await supabase.rpc('sales_report', { p_from: from, p_to: to });
  const start = new Date(`${from}T00:00:00+02:00`).toISOString();
  const end = new Date(new Date(`${to}T00:00:00+02:00`).getTime() + 86400000).toISOString();
  const [targetsResult, targetSalesResult] = await Promise.all([
    loadAllPages((fromRow, toRow) => supabase.from('sales_targets').select('target_date, user_id, target_cents').gte('target_date', from).lte('target_date', to).order('target_date').range(fromRow, toRow)),
    loadAllPages((fromRow, toRow) => supabase.from('sales').select('cashier_id, total_cents, discount_cents, created_at').gte('created_at', start).lt('created_at', end).neq('status', 'voided').order('created_at').range(fromRow, toRow)),
  ]);
  const targetUserIds = [...new Set((targetsResult.rows ?? []).map((target) => target.user_id).filter((id): id is string => Boolean(id)))];
  const { data: targetProfiles } = targetUserIds.length ? await supabase.from('profiles').select('id, name, email').in('id', targetUserIds) : { data: [] as Array<{ id: string; name: string | null; email: string | null }> };
  const profileNames = new Map((targetProfiles ?? []).map((person) => [person.id, person.name || person.email || 'Staff member']));
  const targetSalesByScope = new Map<string, number>();
  for (const sale of targetSalesResult.rows) {
    const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(sale.created_at));
    for (const scope of ['', sale.cashier_id]) {
      const key = `${day}:${scope}`;
      targetSalesByScope.set(key, (targetSalesByScope.get(key) ?? 0) + sale.total_cents);
    }
  }
  const targets = (targetsResult.rows ?? []).map((target) => {
    const actualCents = targetSalesByScope.get(`${target.target_date}:${target.user_id ?? ''}`) ?? 0;
    return { ...target, actual_cents: actualCents, staff_name: target.user_id ? profileNames.get(target.user_id) ?? 'Staff member' : 'Store total' };
  });
  const store = await getStoreSettings();
  const parsed = data as unknown as SalesReportData | null;
  const discountTotalCents = (targetSalesResult.rows ?? []).reduce((sum, sale) => sum + sale.discount_cents, 0);
  const page = <div className="workspace-page"><WorkspaceHeader eyebrow="STORE MANAGEMENT / PERFORMANCE" title="Sales reports" description="Sales, refunds, VAT, payment methods, and cashier totals. Amounts are shown in South African rand." /><ReportsView data={parsed} targets={targets} discountTotalCents={discountTotalCents} error={error || targetsResult.error || targetSalesResult.error ? 'Report could not be loaded. Check the date range and try again.' : null} from={from} to={to} /></div>;
  return profile.role === 'owner'
    ? <WorkspaceShell role="owner" name={profile.name || 'Owner'} store={store}>{page}</WorkspaceShell>
    : <main className="workspace-manager-page"><header className="catalog-topbar"><a href="/catalog">{store.storeName}</a><nav><a href="/catalog">Products</a><a href="/inventory">Inventory</a><a href="/sales">Sales history</a></nav></header>{page}</main>;
}
