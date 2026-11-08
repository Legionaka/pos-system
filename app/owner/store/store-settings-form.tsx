'use client';

import { useActionState } from 'react';
import { saveStoreSettingsAction } from '../actions';
export function StoreSettingsForm({ storeName, logoUrl, updatedAt }: { storeName: string; logoUrl: string | null; updatedAt: string | null }) {
  const [state, action, pending] = useActionState(saveStoreSettingsAction, null);
  return <section className="workspace-card workspace-store-card"><div><p className="workspace-eyebrow">SINGLE-STORE SETTINGS</p><h2>Public store identity</h2><p className="workspace-muted">The first release supports one store. Logo uploads are limited to PNG, JPEG, or WebP up to 2 MB.</p></div>
    <form action={action} className="workspace-form workspace-store-form" encType="multipart/form-data">
      <label>Store name<input name="storeName" required minLength={2} maxLength={80} defaultValue={storeName} /></label>
      <label>Store logo<input name="logo" type="file" accept="image/png,image/jpeg,image/webp" /><small>Leave empty to keep the current logo.</small></label>
      {logoUrl ? <img className="workspace-logo-preview" src={logoUrl} alt={`${storeName} logo preview`} /> : <div className="workspace-logo-placeholder">{storeName.slice(0, 1).toUpperCase()}</div>}
      {state?.message && <p className={state.ok ? 'workspace-success' : 'workspace-alert'} role={state.ok ? 'status' : 'alert'}>{state.message}</p>}
      <button className="workspace-button" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save store profile'}</button>
    </form>
    {updatedAt && <p className="workspace-note">Last updated {new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' }).format(new Date(updatedAt))}.</p>}
  </section>;
}
