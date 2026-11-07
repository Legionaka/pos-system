import type { ReactNode } from 'react';
import Image from 'next/image';

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'auth-brand-lockup auth-brand-lockup-compact' : 'auth-brand-lockup'}>
      <Image
        className="auth-brand-mark"
        src="/daymark-mark.svg"
        alt=""
        width={44}
        height={44}
        priority
      />
      <div className="auth-brand-name">
        <strong>Daymark Market</strong>
        {!compact && <span>STORE POS</span>}
      </div>
    </div>
  );
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page">
      <aside className="auth-brand-panel">
        <Brand />
        <div className="auth-brand-message">
          <span className="auth-badge">STAFF ACCESS</span>
          <h2>A steadier start<br />to every shift.</h2>
          <p className="auth-brand-description">
            One secure place to sign in, serve customers, and keep your store moving.
          </p>
          <div className="auth-brand-callout">
            <strong>Your store. Your team.</strong>
            <span>Access is based on the role assigned to your account.</span>
          </div>
        </div>
        <p className="auth-brand-footer">Secure access for your store team.</p>
      </aside>

      <section className="auth-main">
        <div className="auth-mobile-header"><Brand compact /></div>
        <div className="auth-main-content">{children}</div>
        <p className="auth-legal-note">Secure team access • Single-store workspace</p>
        <p className="auth-mobile-legal">Invite-only staff access</p>
      </section>
    </main>
  );
}

export function AuthLoading() {
  return <div className="auth-loading" aria-label="Loading account status" />;
}
