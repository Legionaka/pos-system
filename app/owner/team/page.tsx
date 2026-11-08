import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { WorkspaceHeader } from '@/app/workspace/workspace-shell';
import { TeamManager } from './team-manager';

export default async function OwnerTeamPage() {
  await connection();
  const supabase = await createClient();
  const [{ data: people, error: peopleError }, { data: invitations, error: inviteError }] = await Promise.all([
    supabase.from('profiles').select('id, name, email, role, active, created_at').in('role', ['cashier', 'manager']).order('created_at', { ascending: false }),
    supabase.from('staff_invitations').select('id, email, role, status, created_at').order('created_at', { ascending: false }).limit(100),
  ]);
  return <div className="workspace-page"><WorkspaceHeader eyebrow="OWNER WORKSPACE / PEOPLE" title="Team" description="Invite staff and manage cashier or manager access. Owner and developer accounts are provisioned separately." />
    {(peopleError || inviteError) && <p className="workspace-alert" role="alert">Some team data could not be loaded. Apply the owner and Dev workspace migration if this is a new setup.</p>}
    <TeamManager people={people ?? []} invitations={invitations ?? []} />
  </div>;
}
