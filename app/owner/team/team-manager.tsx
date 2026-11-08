'use client';

import { useActionState } from 'react';
import { cancelInvitationAction, inviteStaffAction, updateStaffAction } from '../actions';

type Person = { id: string; name: string | null; email: string | null; role: 'cashier' | 'manager' | 'owner' | 'dev'; active: boolean; created_at: string };
type Invitation = { id: string; email: string; role: 'cashier' | 'manager'; status: 'pending' | 'accepted' | 'cancelled'; created_at: string };
const date = (value: string) => new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium' }).format(new Date(value));

export function TeamManager({ people, invitations }: { people: Person[]; invitations: Invitation[] }) {
  const [state, action, pending] = useActionState(inviteStaffAction, null);
  return <div className="workspace-stack">
    <section className="workspace-card"><div className="workspace-card-heading"><div><p className="workspace-eyebrow">ADD A STAFF MEMBER</p><h2>Send an invitation</h2></div></div>
      <form action={action} className="workspace-form workspace-invite-form"><label>Email address<input type="email" name="email" required maxLength={254} placeholder="name@example.com" /></label><label>Role<select name="role" defaultValue="cashier"><option value="cashier">Cashier</option><option value="manager">Manager</option></select></label><button className="workspace-button" type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send invitation'}</button></form>
      {state?.message && <p className={state.ok ? 'workspace-success' : 'workspace-alert'} role={state.ok ? 'status' : 'alert'}>{state.message}</p>}
      <p className="workspace-note">Invitations use the server-side Supabase service role key. Add <code>SUPABASE_SERVICE_ROLE_KEY</code> to the server environment before sending invitations.</p>
    </section>
    <section className="workspace-card"><div className="workspace-card-heading"><div><p className="workspace-eyebrow">CURRENT ACCESS</p><h2>Staff accounts <span className="workspace-count">{people.length}</span></h2></div></div>
      {!people.length ? <div className="workspace-empty"><strong>No staff accounts yet</strong><p>Invite a cashier or manager to get the team started.</p></div> : <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Staff member</th><th>Role</th><th>Access</th><th>Update access</th></tr></thead><tbody>{people.map((person) => <tr key={person.id}><td><strong>{person.name || 'Name not set'}</strong><small>{person.email || 'Email unavailable'}</small></td><td><span className="workspace-tag">{person.role}</span></td><td><span className={`workspace-status ${person.active ? 'is-active' : ''}`}>{person.active ? 'Active' : 'Inactive'}</span></td><td><form action={updateStaffAction} className="workspace-row-form"><input type="hidden" name="userId" value={person.id} /><label className="workspace-sr-only" htmlFor={`role-${person.id}`}>Role for {person.name || person.email}</label><select id={`role-${person.id}`} name="role" defaultValue={person.role}><option value="cashier">Cashier</option><option value="manager">Manager</option></select><label className="workspace-sr-only" htmlFor={`active-${person.id}`}>Access status for {person.name || person.email}</label><select id={`active-${person.id}`} name="active" defaultValue={String(person.active)}><option value="true">Active</option><option value="false">Inactive</option></select><button type="submit">Save</button></form></td></tr>)}</tbody></table></div>}
    </section>
    <section className="workspace-card"><div className="workspace-card-heading"><div><p className="workspace-eyebrow">INVITATION TRACKER</p><h2>Recent invitations</h2></div></div>
      {!invitations.length ? <div className="workspace-empty"><strong>No invitations sent</strong><p>Invitations you send will be listed here.</p></div> : <div className="workspace-table-wrap"><table className="workspace-table"><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Sent</th><th /></tr></thead><tbody>{invitations.map((invite) => <tr key={invite.id}><td>{invite.email}</td><td>{invite.role}</td><td><span className="workspace-tag">{invite.status}</span></td><td>{date(invite.created_at)}</td><td>{invite.status === 'pending' && <form action={cancelInvitationAction}><input type="hidden" name="invitationId" value={invite.id} /><button className="workspace-link-button" type="submit">Cancel</button></form>}</td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
