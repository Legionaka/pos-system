'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { AuthActionState } from './types';

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

const inviteSetupSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name.').max(80, 'Name is too long.'),
  password: z.string().min(8, 'Use at least 8 characters.').max(128),
  confirmPassword: z.string().min(1, 'Confirm your password.'),
}).refine((value) => value.password === value.confirmPassword, {
  path: ['confirmPassword'],
  message: 'The passwords do not match.',
});

export async function signInAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return {
      message: 'Check your email and password, then try again.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email.toLowerCase(),
    password: parsed.data.password,
  });

  if (error || !data.user) {
    return { message: 'Email or password is incorrect.' };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('active')
    .eq('id', data.user.id)
    .maybeSingle();

  if (profileError || !profile?.active) {
    await supabase.auth.signOut();
    return { message: 'This account cannot access the store. Contact the store owner.' };
  }

  redirect('/login');
}

export async function completeInviteAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = inviteSetupSchema.safeParse({
    name: formData.get('name'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    return {
      message: 'Check the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || typeof userId !== 'string') {
    return { message: 'Open the invitation link from your email to continue.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('active')
    .eq('id', userId)
    .maybeSingle();

  if (!profile?.active) {
    return { message: 'This account cannot access the store. Contact the store owner.' };
  }

  const { error: passwordError } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (passwordError) {
    return { message: 'We could not save your password. Please try again.' };
  }

  const { error: nameError } = await supabase
    .from('profiles')
    .update({ name: parsed.data.name })
    .eq('id', userId);

  if (nameError) {
    return {
      message: 'Your password was saved, but your name could not be saved. Submit again to finish setup.',
    };
  }

  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError) {
    return { message: 'Your account is set up. Sign out, then sign in with your new password.' };
  }

  redirect('/login?setup=complete');
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
