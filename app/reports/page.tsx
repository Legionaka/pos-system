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
  const store = await getStoreSettings();
  const parsed = data as unknown as SalesReportData | null;
  const page = <div className="workspace-page"><WorkspaceHeader eyebrow="STORE MANAGEMENT / PERFORMANCE" title="Sales reports" description="Sales, refunds, VAT, payment methods, and cashier totals. Amounts are shown in South African rand." /><ReportsView data={parsed} error={error ? 'Report could not be loaded. Check the date range and try again.' : null} from={from} to={to} /></div>;
  return profile.role === 'owner'
    ? <WorkspaceShell role="owner" name={profile.name || 'Owner'} store={store}>{page}</WorkspaceShell>
    : <main className="workspace-manager-page"><header className="catalog-topbar"><a href="/catalog">{store.storeName}</a><nav><a href="/catalog">Products</a><a href="/inventory">Inventory</a><a href="/sales">Sales history</a></nav></header>{page}</main>;
}
