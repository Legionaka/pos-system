'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { signOutAction } from '@/app/auth/actions';
import type { StoreSettings } from '@/lib/store-settings';

const ownerLinks = [
  ['/owner', 'Overview'], ['/owner/team', 'Team'], ['/owner/shifts', 'Shifts'],
  ['/owner/store', 'Store profile'], ['/owner/activity', 'Activity'],
  ['/catalog', 'Products'], ['/sales', 'Sales history'],
] as const;
const devLinks = [['/dev', 'Support overview'], ['/dev/features', 'Feature flags'], ['/dev/activity', 'Technical activity']] as const;
const sidebarPreferenceKey = 'pos-workspace-sidebar-collapsed';
let sidebarCollapsed = false;
let sidebarPreferenceLoaded = false;
const sidebarListeners = new Set<() => void>();

function getSidebarSnapshot() {
  if (!sidebarPreferenceLoaded) {
    sidebarCollapsed = window.localStorage.getItem(sidebarPreferenceKey) === 'true';
    sidebarPreferenceLoaded = true;
  }
  return sidebarCollapsed;
}

function getSidebarServerSnapshot() {
  return false;
}

function subscribeSidebar(listener: () => void) {
  sidebarListeners.add(listener);
  return () => sidebarListeners.delete(listener);
}

function updateSidebarPreference(next: boolean) {
  sidebarCollapsed = next;
  sidebarPreferenceLoaded = true;
  window.localStorage.setItem(sidebarPreferenceKey, String(next));
  sidebarListeners.forEach((listener) => listener());
}

export function WorkspaceShell({ children, name, store, role }: {
  children: ReactNode; name: string; store: StoreSettings; role: 'owner' | 'dev';
}) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribeSidebar, getSidebarSnapshot, getSidebarServerSnapshot);
  function toggleSidebar() {
    updateSidebarPreference(!collapsed);
  }
  const links = role === 'owner' ? ownerLinks : devLinks;
  return (
    <div className={`workspace-app${collapsed ? ' is-collapsed' : ''}`}>
      <aside className="workspace-sidebar">
        <Link href={role === 'owner' ? '/owner' : '/dev'} className="workspace-brand">
          {store.logoUrl ? <img src={store.logoUrl} alt="" /> : <span className="workspace-brand-mark">{store.storeName.slice(0, 1).toUpperCase()}</span>}
          <span>{store.storeName}</span>
        </Link>
        <button className="workspace-collapse-button" type="button" onClick={toggleSidebar} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <span aria-hidden="true">{collapsed ? '>' : '<'}</span>
          <span className="workspace-collapse-label">{collapsed ? 'Expand' : 'Collapse'}</span>
        </button>
        <div className="workspace-section-label">{role === 'owner' ? 'STORE MANAGEMENT' : 'SUPPORT TOOLS'}</div>
        <nav aria-label={`${role} navigation`} className="workspace-nav">
          {links.map(([href, label]) => <Link key={href} href={href} className={pathname === href ? 'is-current' : undefined} aria-current={pathname === href ? 'page' : undefined} title={label}>
            <span className="workspace-nav-short" aria-hidden="true">{label.slice(0, 1)}</span><span className="workspace-nav-label">{label}</span>
          </Link>)}
        </nav>
        <div className="workspace-sidebar-bottom">
          <div><small>{role === 'owner' ? 'Owner workspace' : 'Developer access'}</small><strong>{name}</strong></div>
          <form action={signOutAction}><button type="submit" title="Sign out"><span className="workspace-signout-label">Sign out</span><span className="workspace-signout-short">Out</span></button></form>
        </div>
      </aside>
      <section className="workspace-main">{children}</section>
    </div>
  );
}

export function WorkspaceHeader({ eyebrow, title, description, action }: {
  eyebrow: string; title: string; description: string; action?: ReactNode;
}) {
  return <header className="workspace-page-header"><div><p className="workspace-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}

export function WorkspaceLoading({ label = 'Loading workspace' }: { label?: string }) {
  return <main className="workspace-loading" aria-busy="true"><span /><p>{label}…</p></main>;
}
