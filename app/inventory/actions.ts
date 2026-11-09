'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Json } from '@/lib/supabase/database';
import { createClient } from '@/lib/supabase/server';

export type InventoryActionState = { ok: boolean; message: string; countId?: string; version?: string } | null;

async function requireManager() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== 'string') return null;
  const { data: profile } = await supabase.from('profiles').select('active, role').eq('id', userId).maybeSingle();
  return profile?.active && (profile.role === 'manager' || profile.role === 'owner') ? supabase : null;
}

function refreshInventory() {
  revalidatePath('/inventory');
  revalidatePath('/catalog');
  revalidatePath('/pos');
  revalidatePath('/owner');
  revalidatePath('/owner/activity');
}

export async function receiveDeliveryAction(_state: InventoryActionState, formData: FormData): Promise<InventoryActionState> {
  const supabase = await requireManager();
  if (!supabase) return { ok: false, message: 'An active manager or owner account is required.' };
  const header = z.object({
    supplier: z.string().trim().min(2).max(120), date: z.string().date(),
    reference: z.string().trim().max(120), notes: z.string().trim().max(500),
  }).safeParse({ supplier: formData.get('supplier'), date: formData.get('deliveryDate'), reference: formData.get('reference') ?? '', notes: formData.get('notes') ?? '' });
  if (!header.success) return { ok: false, message: 'Check the supplier, delivery date, reference, and notes.' };

  const items: Array<{ product_id: string; qty: number; unit_cost_cents: number }> = [];
  for (const [key, rawQty] of formData.entries()) {
    const match = /^qty_([0-9a-f-]{36})$/i.exec(key);
    if (!match || typeof rawQty !== 'string' || rawQty.trim() === '') continue;
    const parsedQty = z.coerce.number().int().positive().max(2_147_483_647).safeParse(rawQty);
    const rawCost = formData.get(`cost_${match[1]}`);
    const parsedCost = z.string().trim().regex(/^\d{1,9}(?:\.\d{1,2})?$/).safeParse(rawCost);
    if (!parsedQty.success || !parsedCost.success) return { ok: false, message: 'Enter a positive whole quantity and a unit cost for every received product.' };
    const [whole, fraction = ''] = parsedCost.data.split('.');
    const unitCost = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(unitCost)) return { ok: false, message: 'A unit cost is outside the supported range.' };
    items.push({ product_id: match[1], qty: parsedQty.data, unit_cost_cents: unitCost });
  }
  if (!items.length) return { ok: false, message: 'Enter a quantity and cost for at least one product.' };

  const { error } = await supabase.rpc('receive_inventory_delivery', {
    p_supplier_name: header.data.supplier, p_delivery_date: header.data.date,
    p_reference: header.data.reference || null, p_notes: header.data.notes || null, p_items: items as unknown as Json,
  });
  if (error) return { ok: false, message: error.message.includes('in progress') ? 'Finish or cancel the active stock count before receiving a delivery.' : 'The delivery could not be recorded. Check quantities and try again.' };
  refreshInventory();
  return { ok: true, message: 'Delivery received and stock movements recorded.', version: crypto.randomUUID() };
}

export async function startInventoryCountAction(): Promise<InventoryActionState> {
  const supabase = await requireManager();
  if (!supabase) return { ok: false, message: 'An active manager or owner account is required.' };
  const { data, error } = await supabase.rpc('start_inventory_count');
  if (error || !data) return { ok: false, message: error?.message ?? 'Could not start the stock count.' };
  refreshInventory();
  return { ok: true, message: 'Count started. Checkout and stock changes are paused until you finish or cancel.', countId: data, version: crypto.randomUUID() };
}

export async function finishInventoryCountAction(_state: InventoryActionState, formData: FormData): Promise<InventoryActionState> {
  const supabase = await requireManager();
  if (!supabase) return { ok: false, message: 'An active manager or owner account is required.' };
  const countId = z.string().uuid().safeParse(formData.get('countId'));
  if (!countId.success) return { ok: false, message: 'Refresh the page and reopen the active count.' };
  const rows: Array<{ item_id: string; counted_qty: number }> = [];
  for (const [key, value] of formData.entries()) {
    const match = /^count_([0-9a-f-]{36})$/i.exec(key);
    if (!match || typeof value !== 'string') continue;
    if (value.trim() === '') return { ok: false, message: 'Enter a count for every product before applying adjustments.' };
    const qty = z.coerce.number().int().min(0).max(2_147_483_647).safeParse(value);
    if (!qty.success) return { ok: false, message: 'Every counted quantity must be a non-negative whole number.' };
    rows.push({ item_id: match[1], counted_qty: qty.data });
  }
  const { error } = await supabase.rpc('finish_inventory_count', { p_count_id: countId.data, p_counts: rows as unknown as Json });
  if (error) return { ok: false, message: 'The count could not be applied. Check that every product has a count and try again.' };
  refreshInventory();
  return { ok: true, message: 'Stock count completed and variances recorded.', version: crypto.randomUUID() };
}

export async function cancelInventoryCountAction(formData: FormData): Promise<void> {
  const supabase = await requireManager();
  const countId = z.string().uuid().safeParse(formData.get('countId'));
  if (!supabase || !countId.success) return;
  const { error } = await supabase.rpc('cancel_inventory_count', { p_count_id: countId.data });
  if (!error) refreshInventory();
}
