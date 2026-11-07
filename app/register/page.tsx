import Link from 'next/link';
import { Suspense } from 'react';
import { AuthLoading, AuthShell } from '@/app/auth/auth-shell';
import { createClient } from '@/lib/supabase/server';
import { InviteSetupForm } from './invite-setup-form';

type RegisterPageProps = {
  searchParams: Promise<{ invite?: string | string[] }>;
};

export default function RegisterPage({ searchParams }: RegisterPageProps) {
  return (
    <AuthShell>
      <Suspense fallback={<AuthLoading />}>
        <RegisterContent searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

async function RegisterContent({ searchParams }: RegisterPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (typeof userId !== 'string') {
    return (
      <section className="auth-notice-card" aria-labelledby="invite-required-title">
        <h1 id="invite-required-title">Registration is invite-only</h1>
        {params.invite === 'invalid' ? (
          <p>This invitation link is invalid or has expired. Ask the store owner to send a new one.</p>
        ) : (
          <p>Open the invitation email from your store owner, then follow its link to set up your account.</p>
        )}
        <p>
          Already have an account? <Link className="auth-link" href="/login">Sign in</Link>
        </p>
      </section>
    );
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('name, active')
    .eq('id', userId)
    .maybeSingle();

  if (error || !profile?.active) {
    return (
      <section className="auth-notice-card" aria-labelledby="invite-access-title">
        <h1 id="invite-access-title">Account unavailable</h1>
        <p>This account cannot access the store. Contact the store owner.</p>
        <Link className="auth-link" href="/login">Return to sign in</Link>
      </section>
    );
  }

  const claimEmail = claimsData?.claims?.email;
  const email = typeof claimEmail === 'string' ? claimEmail : '';
  const initialName = profile.name && profile.name !== email ? profile.name : '';

  return <InviteSetupForm email={email} initialName={initialName} />;
}
