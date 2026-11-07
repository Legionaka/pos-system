'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { signInAction } from '@/app/auth/actions';
import type { AuthActionState } from '@/app/auth/types';

function FieldError({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="auth-field-error" id={id}>{errors[0]}</p>;
}

export function LoginForm({ setupComplete = false }: { setupComplete?: boolean }) {
  const [state, action, pending] = useActionState<AuthActionState, FormData>(
    signInAction,
    null,
  );

  return (
    <section className="auth-card" aria-labelledby="login-title">
      <header className="auth-card-header">
        <h1 id="login-title">Welcome back</h1>
        <p>Sign in to your store workspace.</p>
      </header>

      {setupComplete && (
        <p className="auth-success" role="status">
          Your account is ready. Sign in with your new password.
        </p>
      )}

      <form className="auth-form" action={action} noValidate>
        <div className="auth-field">
          <label htmlFor="login-email">Email address</label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@store.com"
            required
            aria-invalid={Boolean(state?.fieldErrors?.email?.length)}
            aria-describedby={state?.fieldErrors?.email?.length ? 'login-email-error' : undefined}
          />
          <FieldError id="login-email-error" errors={state?.fieldErrors?.email} />
        </div>

        <div className="auth-field">
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            required
            aria-invalid={Boolean(state?.fieldErrors?.password?.length)}
            aria-describedby={state?.fieldErrors?.password?.length ? 'login-password-error' : undefined}
          />
          <FieldError id="login-password-error" errors={state?.fieldErrors?.password} />
        </div>

        <div className="auth-form-helper">
          <span>Authorized staff only</span>
          <span>Secure sign-in</span>
        </div>

        {state?.message && <p className="auth-error" role="alert">{state.message}</p>}

        <button className="auth-primary-button" type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="auth-link-row">
        Have an invitation?{' '}
        <Link className="auth-link" href="/register">Set up your account</Link>
      </p>
    </section>
  );
}
