import { connection } from 'next/server';
import { getRequestTime } from '@/lib/request-time';
import { createClient } from '@/lib/supabase/server';
import { WorkspaceHeader } from '@/app/workspace/workspace-shell';
import { ShiftTable, type ShiftRecord } from './shift-table';

export default async function OwnerShiftsPage() {
  await connection();
  const supabase = await createClient();
  const { data: rows, error } = await supabase.from('shifts')
    .select('id, user_id, opened_at, closed_at, opening_cash_cents, expected_cash_cents, counted_cash_cents, cash_variance_cents')
    .order('opened_at', { ascending: false }).limit(200);
  const userIds = [...new Set((rows ?? []).map((row) => row.user_id))];
  const { data: profiles, error: profileError } = userIds.length
    ? await supabase.from('profiles').select('id, name').in('id', userIds)
    : { data: [], error: null };
  const names = new Map((profiles ?? []).map((profile) => [profile.id, profile.name || 'Staff member']));
  const shifts: ShiftRecord[] = (rows ?? []).map((row) => ({ ...row, cashier_name: names.get(row.user_id) ?? 'Staff member' }));
  return <div className="workspace-page"><WorkspaceHeader eyebrow="OWNER WORKSPACE / CASH CONTROL" title="Shifts" description="Review till openings, cash counts, and variances. Showing up to 200 recent shifts." />
    {(error || profileError) && <p className="workspace-alert" role="alert">Shift data could not be loaded.</p>}
    <ShiftTable shifts={shifts} referenceTime={getRequestTime()} />
  </div>;
}
