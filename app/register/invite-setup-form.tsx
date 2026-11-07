'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { completeInviteAction } from '@/app/auth/actions';
import type { AuthActionState } from '@/app/auth/types';

function FieldError({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="auth-field-error" id={id}>{errors[0]}</p>;
}

export function InviteSetupForm({
  email,
  initialName,
}: {
  email: string;
  initialName: string;
}) {
  const [state, action, pending] = useActionState<AuthActionState, FormData>(
    completeInviteAction,
    null,
  );

  return (
    <section className="auth-card" aria-labelledby="register-title">
      <header className="auth-card-header">
        <h1 id="register-title">Set up your account</h1>
        <p>Finish setting up your invited staff account.</p>
      </header>

      <div className="auth-invite-status">INVITATION ACCEPTED</div>
      <p className="auth-account-email">Invitation for <strong>{email}</strong></p>

      <form className="auth-form" action={action} noValidate>
        <div className="auth-field">
          <label htmlFor="register-name">Full name</label>
          <input
            id="register-name"
            name="name"
            type="text"
            autoComplete="name"
            defaultValue={initialName}
            placeholder="Your name"
            required
            aria-invalid={Boolean(state?.fieldErrors?.name?.length)}
            aria-describedby={state?.fieldErrors?.name?.length ? 'register-name-error' : undefined}
          />
          <FieldError id="register-name-error" errors={state?.fieldErrors?.name} />
        </div>

        <div className="auth-field">
          <label htmlFor="register-password">Create password</label>
          <input
            id="register-password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            required
            aria-invalid={Boolean(state?.fieldErrors?.password?.length)}
            aria-describedby={state?.fieldErrors?.password?.length ? 'register-password-error' : undefined}
          />
          <FieldError id="register-password-error" errors={state?.fieldErrors?.password} />
        </div>

        <div className="auth-field">
          <label htmlFor="register-confirm-password">Confirm password</label>
          <input
            id="register-confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder="Enter it again"
            required
            aria-invalid={Boolean(state?.fieldErrors?.confirmPassword?.length)}
            aria-describedby={state?.fieldErrors?.confirmPassword?.length ? 'register-confirm-password-error' : undefined}
          />
          <FieldError
            id="register-confirm-password-error"
            errors={state?.fieldErrors?.confirmPassword}
          />
        </div>

        {state?.message && <p className="auth-error" role="alert">{state.message}</p>}

        <button className="auth-primary-button" type="submit" disabled={pending}>
          {pending ? 'Setting up account…' : 'Create account'}
        </button>
      </form>

      <p className="auth-note">Your store owner assigns your role.</p>
      <p className="auth-link-row">
        Already set up? <Link className="auth-link" href="/login">Sign in</Link>
      </p>
    </section>
  );
}
