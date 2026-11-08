'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export type OwnerActionState = { ok: boolean; message: string; version?: string } | null;
const inviteSchema = z.object({ email: z.string().trim().email().max(254), role: z.enum(['cashier', 'manager']) });

async function requireOwner() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== 'string') throw new Error('Sign in with an owner account to continue.');
  const { data: profile } = await supabase.from('profiles').select('active, role').eq('id', userId).maybeSingle();
  if (!profile?.active || profile.role !== 'owner') throw new Error('An active owner account is required.');
  return supabase;
}

export async function inviteStaffAction(_state: OwnerActionState, formData: FormData): Promise<OwnerActionState> {
  const parsed = inviteSchema.safeParse({ email: formData.get('email'), role: formData.get('role') });
  if (!parsed.success) return { ok: false, message: 'Enter a valid email and choose cashier or manager.' };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, message: 'Staff invitations are not configured. Add SUPABASE_SERVICE_ROLE_KEY to the server environment.' };
  }
  try {
    const supabase = await requireOwner();
    const admin = createAdminClient();
    const { data: invitationId, error: createError } = await supabase.rpc('owner_create_staff_invitation', {
      p_email: parsed.data.email.toLowerCase(), p_role: parsed.data.role,
    });
    if (createError || !invitationId) throw new Error(createError?.message ?? 'Could not create invitation.');
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    try {
      const { error } = await admin.auth.admin.inviteUserByEmail(parsed.data.email.toLowerCase(), {
        redirectTo: `${appUrl.replace(/\/$/, '')}/auth/confirm`,
        data: { full_name: parsed.data.email.split('@')[0] },
      });
      if (error) throw new Error(error.message);
    } catch (error) {
      await supabase.rpc('owner_cancel_staff_invitation', { p_invitation_id: invitationId });
      throw error;
    }
    revalidatePath('/owner/team');
    return { ok: true, message: `Invitation sent to ${parsed.data.email}.`, version: randomUUID() };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not send invitation.' };
  }
}

export async function cancelInvitationAction(formData: FormData) {
  const id = z.string().uuid().safeParse(formData.get('invitationId'));
  if (!id.success) return;
  try {
    const supabase = await requireOwner();
    const { data: invitation } = await supabase.from('staff_invitations').select('user_id, status').eq('id', id.data).maybeSingle();
    if (invitation?.status !== 'pending') return;
    if (invitation.user_id) {
      const { error } = await createAdminClient().auth.admin.deleteUser(invitation.user_id);
      if (error) throw new Error(error.message);
    }
    const { error } = await supabase.rpc('owner_cancel_staff_invitation', { p_invitation_id: id.data });
    if (error) throw new Error(error.message);
    revalidatePath('/owner/team');
  } catch { /* Server-side authorization still protects the operation. */ }
}

export async function updateStaffAction(formData: FormData) {
  const parsed = z.object({
    userId: z.string().uuid(), role: z.enum(['cashier', 'manager']), active: z.enum(['true', 'false']),
  }).safeParse({ userId: formData.get('userId'), role: formData.get('role'), active: formData.get('active') });
  if (!parsed.success) return;
  try {
    const supabase = await requireOwner();
    await supabase.rpc('set_profile_role', {
      p_user_id: parsed.data.userId, p_role: parsed.data.role, p_active: parsed.data.active === 'true',
    });
    revalidatePath('/owner/team');
  } catch { /* Database RPC rechecks owner access and staff-role constraints. */ }
}

export async function saveStoreSettingsAction(_state: OwnerActionState, formData: FormData): Promise<OwnerActionState> {
  const name = z.string().trim().min(2).max(80).safeParse(formData.get('storeName'));
  const logo = formData.get('logo');
  if (!name.success) return { ok: false, message: 'Store name must be between 2 and 80 characters.' };
  if (!(logo instanceof File)) return { ok: false, message: 'Choose a PNG, JPEG, or WebP image.' };
  if (logo.size > 2 * 1024 * 1024) return { ok: false, message: 'Logo must be 2 MB or smaller.' };
  if (logo.size && !['image/png', 'image/jpeg', 'image/webp'].includes(logo.type)) return { ok: false, message: 'Choose a PNG, JPEG, or WebP image.' };
  if (logo.size) {
    const header = new Uint8Array(await logo.slice(0, 12).arrayBuffer());
    const isPng = header.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte);
    const isJpeg = header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    const isWebp = header.length >= 12 && String.fromCharCode(...header.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...header.slice(8, 12)) === 'WEBP';
    if (!(isPng && logo.type === 'image/png') && !(isJpeg && logo.type === 'image/jpeg') && !(isWebp && logo.type === 'image/webp')) {
      return { ok: false, message: 'The file contents do not match a PNG, JPEG, or WebP image.' };
    }
  }
  try {
    const supabase = await requireOwner();
    const { data: existing } = await supabase.from('store_settings').select('logo_path').eq('singleton', true).maybeSingle();
    let path = existing?.logo_path ?? null;
    let uploadedPath: string | null = null;
    if (logo.size) {
      const extension = logo.type === 'image/jpeg' ? 'jpg' : logo.type === 'image/png' ? 'png' : 'webp';
      uploadedPath = `store/${randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from('store-branding').upload(uploadedPath, logo, { contentType: logo.type, upsert: false });
      if (uploadError) throw new Error(uploadError.message);
      path = uploadedPath;
    }
    const { error } = await supabase.rpc('owner_update_store_settings', { p_store_name: name.data, p_logo_path: path });
    if (error) {
      if (uploadedPath) await supabase.storage.from('store-branding').remove([uploadedPath]);
      throw new Error(error.message);
    }
    if (uploadedPath && existing?.logo_path) await supabase.storage.from('store-branding').remove([existing.logo_path]);
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Store profile saved.', version: randomUUID() };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not save store settings.' };
  }
}
