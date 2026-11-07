import type { ReactNode } from 'react';
import Image from 'next/image';

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'auth-brand-lockup auth-brand-lockup-compact' : 'auth-brand-lockup'}>
      <Image
        className="auth-brand-logo"
        src="/logo/truemarket-horizontal-dark.svg"
        alt="TrueMarket"
        width={508}
        height={192}
        priority
      />
    </div>
  );
}

export function AuthShell({
  children,
  variant = 'branded',
}: {
  children: ReactNode;
  variant?: 'branded' | 'figma';
}) {
  const figma = variant === 'figma';

  return (
    <main className={figma ? 'auth-page auth-page--figma' : 'auth-page'}>
      <aside className="auth-brand-panel">
        {figma && <div className="auth-brand-backdrop" aria-hidden="true" />}
        <Brand />
        {figma ? (
          <>
            <div className="auth-brand-message auth-brand-message-figma">
              <span className="auth-badge">STAFF ACCESS</span>
              <div className="auth-brand-statement">
                <h2>A steadier start<br />to every shift.</h2>
                <p className="auth-brand-description">
                  One secure place to sign in, serve customers, and keep your store moving.
                </p>
              </div>
            </div>
            <div className="auth-brand-assurance">
              <div className="auth-brand-callout auth-brand-callout-figma">
                <strong>Your store. Your team.</strong>
                <span>Access is based on the role assigned to your account.</span>
              </div>
              <p className="auth-brand-footer">Secure access for your store team.</p>
            </div>
          </>
        ) : (
          <>
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
          </>
        )}
      </aside>

      <section className={figma ? 'auth-main auth-main--figma' : 'auth-main'}>
        <div className="auth-mobile-header"><Brand compact /></div>
        <div className={figma ? 'auth-main-content auth-main-content--figma' : 'auth-main-content'}>
          {children}
        </div>
        <p className="auth-legal-note">Secure team access · Single-store workspace</p>
        {!figma && <p className="auth-mobile-legal">Invite-only staff access</p>}
      </section>
    </main>
  );
}

export function AuthLoading() {
  return <div className="auth-loading" aria-label="Loading account status" />;
}
