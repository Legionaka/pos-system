import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { AuthLoading, AuthShell } from '@/app/auth/auth-shell';
import { signOutAction } from '@/app/auth/actions';
import { createClient } from '@/lib/supabase/server';
import { LoginForm } from './login-form';

type LoginPageProps = {
  searchParams: Promise<{ setup?: string | string[] }>;
};

export default function LoginPage({ searchParams }: LoginPageProps) {
  return (
    <Suspense fallback={<AuthLoading />}>
      <AuthShell variant="figma">
        <Suspense fallback={<AuthLoading />}><LoginContent searchParams={searchParams} /></Suspense>
      </AuthShell>
    </Suspense>
  );
}

async function LoginContent({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (typeof userId === 'string') {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('name, role, active')
      .eq('id', userId)
      .maybeSingle();

    if (error || !profile?.active) {
      return (
        <section className="auth-notice-card" aria-labelledby="access-title">
          <h1 id="access-title">Access unavailable</h1>
          <p>This account cannot access the store. Contact the store owner.</p>
          <form action={signOutAction}>
            <button className="auth-primary-button" type="submit">Sign out</button>
          </form>
        </section>
      );
    }

    if (profile.role === 'cashier') redirect('/pos');
    if (profile.role === 'manager') redirect('/catalog');
    if (profile.role === 'owner') redirect('/owner');
    if (profile.role === 'dev') redirect('/dev');
    redirect('/login');
  }

  const setupComplete = params.setup === 'complete';
  return <LoginForm setupComplete={setupComplete} />;
}
