'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Json } from '@/lib/supabase/database';
import { createClient } from '@/lib/supabase/server';
import { getJohannesburgDate } from '@/lib/request-time';
import { getSupabaseConfig } from '@/lib/supabase/config';

const moneyText = z.string().trim().regex(/^\d{1,9}(?:\.\d{1,2})?$/, 'Enter an amount such as 0.00.');
const paymentMethod = z.enum(['cash', 'card', 'eft', 'qr']);
const saleInput = z.object({
  items: z.string().min(2).max(20_000),
  method: paymentMethod,
  cashReceived: z.string().trim().max(20),
  reference: z.string().trim().max(120),
  managerEmail: z.string().trim().max(254),
  managerPassword: z.string().max(256),
  basketDiscountBps: z.string().regex(/^\d{1,5}$/).transform(Number).pipe(z.number().int().min(0).max(10000)),
});
const itemInput = z.array(z.object({
  product_id: z.string().uuid(),
  qty: z.number().int().positive().max(2_147_483_647),
  discount_percent_bps: z.number().int().min(0).max(10000).optional(),
})).min(1).max(100);

type SaleReceipt = {
  number: number;
  createdAt: string;
  subtotalCents: number;
  discountCents: number;
  vatCents: number;
  roundingCents: number;
  totalCents: number;
  payments: Array<{ method: string; amountCents: number; reference: string | null }>;
  items: Array<{ name: string; sku: string; qty: number; unitPriceCents: number; lineTotalCents: number }>;
};

export type PosActionState = {
  message?: string;
  saleId?: string;
  saleNumber?: number;
  receipt?: SaleReceipt;
} | null;

export type HoldActionState = { ok: boolean; message: string; holdId?: string; version?: string } | null;

export type ShiftActionState = { message?: string } | null;

export async function syncOfflineSaleAction(input: { key: string; shiftId: string; items: Array<{ product_id: string; qty: number; unit_price_cents: number; discount_cents: number }>; cashReceivedCents: number }): Promise<{ ok: boolean; saleId?: string; message: string }> {
  const cashier = await getActiveCashier();
  if (!cashier) return { ok: false, message: 'Cashier session is no longer active.' };
  const parsed = z.object({ key: z.string().uuid(), shiftId: z.string().uuid(), items: z.array(z.object({ product_id: z.string().uuid(), qty: z.number().int().positive().max(2_147_483_647), unit_price_cents: z.number().int().nonnegative(), discount_cents: z.number().int().nonnegative() })).min(1).max(100), cashReceivedCents: z.number().int().nonnegative() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Queued sale data is invalid.' };
  const { data, error } = await cashier.supabase.rpc('offline_complete_sale', { p_key: parsed.data.key, p_shift_id: parsed.data.shiftId, p_items: parsed.data.items as unknown as Json, p_cash_received: parsed.data.cashReceivedCents });
  if (error || !data) return { ok: false, message: error?.message.toLowerCase().includes('insufficient stock') ? 'Stock changed before this sale synced. Review it with a manager.' : 'Sale needs staff review before it can sync.' };
  revalidatePath('/pos');
  revalidatePath('/sales');
  return { ok: true, saleId: data, message: 'Offline sale synced.' };
}

export async function recordCashMovementAction(_previousState: ShiftActionState, formData: FormData): Promise<ShiftActionState> {
  const cashier = await getActiveCashier();
  if (!cashier) return { message: 'Sign in with an active cashier account to record a till movement.' };
  const parsed = z.object({ shiftId: z.string().uuid(), type: z.enum(['paid_in', 'payout']), amount: moneyText, reason: z.string().trim().min(3).max(250) }).safeParse({
    shiftId: formData.get('shiftId'), type: formData.get('type'), amount: formData.get('amount'), reason: formData.get('reason'),
  });
  const amount = parsed.success ? moneyToCents(parsed.data.amount) : null;
  if (!parsed.success || amount === null || amount <= 0) return { message: 'Enter a positive amount and a reason for the cash movement.' };
  const { error } = await cashier.supabase.rpc('record_cash_movement', { p_shift_id: parsed.data.shiftId, p_type: parsed.data.type, p_amount: amount, p_reason: parsed.data.reason });
  if (error) return { message: 'Cash movement could not be recorded. Confirm the shift is still open.' };
  revalidatePath('/pos');
  revalidatePath('/owner/shifts');
  return { message: 'Cash movement recorded.' };
}

function moneyToCents(value: string): number | null {
  if (!moneyText.safeParse(value).success) return null;
  const [whole, fraction = ''] = value.trim().split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

async function getActiveCashier() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== 'string') return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('active, role')
    .eq('id', userId)
    .maybeSingle();

  if (!profile?.active || profile.role !== 'cashier') return null;
  return { supabase, userId };
}

export async function openShiftAction(
  _previousState: ShiftActionState,
  formData: FormData,
): Promise<ShiftActionState> {
  const cashier = await getActiveCashier();
  if (!cashier) return { message: 'Sign in with an active cashier account to open a shift.' };

  const rawOpeningCash = formData.get('openingCash');
  const openingCashCents = typeof rawOpeningCash === 'string' ? moneyToCents(rawOpeningCash) : null;
  if (openingCashCents === null) return { message: 'Enter opening cash in rand and cents, such as 100.00.' };

  const { error } = await cashier.supabase.rpc('open_shift', {
    p_opening_cash_cents: openingCashCents,
  });

  if (error) {
    const message = error.message.toLowerCase().includes('duplicate key')
      ? 'You already have an open shift. Refresh this page to continue.'
      : 'The shift could not be opened. Refresh the page and try again.';
    return { message };
  }

  revalidatePath('/pos');
  redirect('/pos');
}

export async function closeShiftAction(
  _previousState: ShiftActionState,
  formData: FormData,
): Promise<ShiftActionState> {
  const cashier = await getActiveCashier();
  if (!cashier) return { message: 'Sign in with an active cashier account to close a shift.' };

  const shiftIdValue = formData.get('shiftId');
  const shiftId = z.string().uuid().safeParse(shiftIdValue);
  const rawCountedCash = formData.get('countedCash');
  const countedCashCents = typeof rawCountedCash === 'string' ? moneyToCents(rawCountedCash) : null;
  if (!shiftId.success || countedCashCents === null) {
    return { message: 'Enter the counted till cash in rand and cents, such as 100.00.' };
  }

  const { data: shift } = await cashier.supabase
    .from('shifts')
    .select('id')
    .eq('id', shiftId.data)
    .eq('user_id', cashier.userId)
    .is('closed_at', null)
    .maybeSingle();
  if (!shift) return { message: 'This shift is no longer open. Refresh the page.' };

  const { error } = await cashier.supabase.rpc('close_shift', {
    p_shift_id: shift.id,
    p_counted_cash_cents: countedCashCents,
  });
  if (error) return { message: 'The shift could not be closed. Check the amount and try again.' };

  revalidatePath('/pos');
  redirect('/pos');
}

export async function completeSaleAction(
  _previousState: PosActionState,
  formData: FormData,
): Promise<PosActionState> {
  const cashier = await getActiveCashier();
  if (!cashier) return { message: 'Your cashier session is no longer active. Sign in again.' };

  const parsed = saleInput.safeParse({
    items: formData.get('items'),
    method: formData.get('method'),
    cashReceived: formData.get('cashReceived'),
    reference: formData.get('reference'),
    managerEmail: formData.get('managerEmail') ?? '',
    managerPassword: formData.get('managerPassword') ?? '',
    basketDiscountBps: formData.get('basketDiscountBps') ?? '0',
  });
  if (!parsed.success) return { message: 'Review the cart and payment details, then try again.' };

  let requestedItems: z.infer<typeof itemInput>;
  try {
    const json: unknown = JSON.parse(parsed.data.items);
    const itemResult = itemInput.safeParse(json);
    if (!itemResult.success) return { message: 'The cart contains invalid items. Please rebuild it and try again.' };
    requestedItems = itemResult.data;
  } catch {
    return { message: 'The cart could not be read. Please rebuild it and try again.' };
  }

  if (new Set(requestedItems.map((item) => item.product_id)).size !== requestedItems.length) return { message: 'The cart contains duplicate product rows. Rebuild it and try again.' };
  const itemPayload = requestedItems.map((item) => ({ product_id: item.product_id, qty: item.qty, discount_percent_bps: item.discount_percent_bps ?? 0 }));
  const heldSaleId = formData.get('heldSaleId');
  const parsedHeldSaleId = heldSaleId ? z.string().uuid().safeParse(heldSaleId) : null;
  if (heldSaleId && !parsedHeldSaleId?.success) return { message: 'The held sale identifier is invalid. Refresh and try again.' };
  const productIds = itemPayload.map((item) => item.product_id);
  const { data: products, error: productsError } = await cashier.supabase
    .from('products')
    .select('id, price_cents, stock_qty, active')
    .in('id', productIds);

  if (productsError || !products || products.length !== productIds.length) {
    return { message: 'One or more products are no longer available. Refresh the catalog and try again.' };
  }

  const today = getJohannesburgDate();
  const [{ data: promotions, error: promotionsError }, { data: discountSettings }] = await Promise.all([
    cashier.supabase.from('promotions').select('product_id, discount_type, discount_value').eq('active', true).lte('starts_on', today).gte('ends_on', today),
    cashier.supabase.from('store_feature_settings').select('cashier_discount_limit_bps').eq('singleton', true).maybeSingle(),
  ]);
  if (promotionsError) return { message: 'Active promotions could not be checked. Try again.' };

  let subtotalCents = 0;
  let discountTotalCents = 0;
  const discountedItemPayload = [] as Array<{ product_id: string; qty: number; discount_cents: number }>;
  for (const item of itemPayload) {
    const product = products.find((row) => row.id === item.product_id);
    if (!product?.active) return { message: 'A product in this cart is no longer active. Refresh the catalog.' };
    if (product.stock_qty < item.qty) return { message: `There is not enough stock for one of the items. Available: ${product.stock_qty}.` };
    if (!Number.isSafeInteger(product.price_cents)) return { message: 'A product price is outside the supported amount range.' };
    subtotalCents += product.price_cents * item.qty;
    if (!Number.isSafeInteger(subtotalCents)) return { message: 'The sale total is outside the supported amount range.' };
    const gross = product.price_cents * item.qty;
    const manualDiscount = Math.round(gross * Math.max(item.discount_percent_bps, parsed.data.basketDiscountBps) / 10000);
    const promotionDiscount = (promotions ?? []).filter((promotion) => !promotion.product_id || promotion.product_id === product.id).reduce((best, promotion) => {
      const amount = promotion.discount_type === 'percent' ? Math.round(gross * promotion.discount_value / 10000) : promotion.discount_value * item.qty;
      return Math.max(best, Math.min(gross, amount));
    }, 0);
    const lineDiscount = Math.max(manualDiscount, promotionDiscount);
    discountTotalCents += lineDiscount;
    discountedItemPayload.push({ product_id: item.product_id, qty: item.qty, discount_cents: lineDiscount });
  }

  const discountBps = subtotalCents > 0 ? Math.ceil(discountTotalCents * 10000 / subtotalCents) : 0;
  const limitBps = discountSettings?.cashier_discount_limit_bps ?? 1000;
  if (discountBps > limitBps) {
    if (!parsed.data.managerEmail || !parsed.data.managerPassword) return { message: `Discounts above ${limitBps / 100}% need a manager or owner to approve with their account credentials.` };
    try {
      const { url, anonKey } = getSupabaseConfig();
      const approvalClient = createSupabaseClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const { data: signedIn, error: authError } = await approvalClient.auth.signInWithPassword({ email: parsed.data.managerEmail, password: parsed.data.managerPassword });
      if (authError || !signedIn.user) return { message: 'Manager credentials could not be verified.' };
      const { data: approver } = await approvalClient.from('profiles').select('active, role').eq('id', signedIn.user.id).maybeSingle();
      if (!approver?.active || (approver.role !== 'manager' && approver.role !== 'owner')) return { message: 'Approval requires an active manager or owner account.' };
      const { error: approvalError } = await approvalClient.rpc('approve_sale_discount', { p_cashier_id: cashier.userId, p_discount_bps: discountBps });
      if (approvalError) return { message: 'Manager approval could not be recorded.' };
      await approvalClient.auth.signOut();
    } catch { return { message: 'Manager approval could not be verified. Check the connection and try again.' }; }
  }

  const method = parsed.data.method;
  const amountBeforeRounding = subtotalCents - discountTotalCents;
  const roundingCents = method === 'cash' ? Math.round(amountBeforeRounding / 5) * 5 - amountBeforeRounding : 0;
  const totalCents = amountBeforeRounding + roundingCents;
  let payments: Array<Record<string, string | number>> = [];

  if (totalCents > 0) {
    const reference = parsed.data.reference || null;
    if (method === 'cash') {
      const receivedCents = moneyToCents(parsed.data.cashReceived);
      if (receivedCents === null || receivedCents < totalCents) {
        return { message: 'Enter cash received equal to or greater than the total due.' };
      }
      payments = [{ method, amount_cents: totalCents, received_cents: receivedCents }];
    } else {
      payments = [{ method, amount_cents: totalCents, ...(reference ? { reference } : {}) }];
    }
  }

  const { data: shift } = await cashier.supabase
    .from('shifts')
    .select('id')
    .eq('user_id', cashier.userId)
    .is('closed_at', null)
    .maybeSingle();
  if (!shift) return { message: 'Open a cashier shift before completing a sale.' };

  const { data: saleId, error: saleError } = parsedHeldSaleId?.success
    ? await cashier.supabase.rpc('complete_held_sale', {
      p_held_sale_id: parsedHeldSaleId.data,
      p_items: discountedItemPayload as unknown as Json,
      p_payments: payments as unknown as Json,
    })
    : await cashier.supabase.rpc('complete_sale', {
      p_shift_id: shift.id,
      p_items: discountedItemPayload as unknown as Json,
      p_payments: payments,
    });

  if (saleError || !saleId) {
    const detail = saleError?.message.toLowerCase() ?? '';
    if (detail.includes('insufficient stock')) return { message: 'Stock changed while you were checking out. Review the cart and try again.' };
    if (detail.includes('stock count')) return { message: 'Checkout is paused while a full-store stock count is in progress.' };
    if (detail.includes('open shift')) return { message: 'Your shift is no longer open. Refresh the page before starting another sale.' };
    if (detail.includes('payment')) return { message: 'Payment did not match the final total. Check the amount and try again.' };
    if (detail.includes('manager approval')) return { message: 'Manager approval expired. Enter the manager credentials again.' };
    return { message: 'The sale could not be completed. Your cart is still here; please try again.' };
  }

  const { data: sale } = await cashier.supabase
    .from('sales')
    .select('number, created_at, subtotal_cents, discount_cents, vat_cents, rounding_cents, total_cents')
    .eq('id', saleId)
    .maybeSingle();

  const { data: saleItems } = await cashier.supabase
    .from('sale_items')
    .select('product_name, sku, qty, unit_price_cents, line_total_cents')
    .eq('sale_id', saleId)
    .order('created_at');
  const { data: paymentRows } = await cashier.supabase.from('payments').select('method, amount_cents, reference').eq('sale_id', saleId);

  revalidatePath('/pos');
  revalidatePath('/sales');
  return {
    saleId,
    saleNumber: sale?.number,
    receipt: sale && saleItems ? {
      number: sale.number,
      createdAt: sale.created_at,
      subtotalCents: sale.subtotal_cents,
      discountCents: sale.discount_cents,
      vatCents: sale.vat_cents,
      roundingCents: sale.rounding_cents,
      totalCents: sale.total_cents,
      payments: (paymentRows ?? []).map((payment) => ({ method: payment.method, amountCents: payment.amount_cents, reference: payment.reference })),
      items: saleItems.map((item) => ({
        name: item.product_name,
        sku: item.sku,
        qty: item.qty,
        unitPriceCents: item.unit_price_cents,
        lineTotalCents: item.line_total_cents,
      })),
    } : undefined,
  };
}

export async function saveHeldSaleAction(_state: HoldActionState, formData: FormData): Promise<HoldActionState> {
  const cashier = await getActiveCashier();
  if (!cashier) return { ok: false, message: 'Sign in with an active cashier account to save a cart.' };
  const shiftId = z.string().uuid().safeParse(formData.get('shiftId'));
  const label = z.string().trim().max(80).safeParse(formData.get('label') ?? '');
  const heldSaleIdValue = formData.get('heldSaleId');
  const heldSaleId = heldSaleIdValue ? z.string().uuid().safeParse(heldSaleIdValue) : null;
  let items: unknown;
  try { items = JSON.parse(String(formData.get('items') ?? '')); } catch { return { ok: false, message: 'The cart could not be read.' }; }
  const parsedItems = itemInput.safeParse(items);
  if (!shiftId.success || !label.success || !parsedItems.success || (heldSaleIdValue && !heldSaleId?.success)) return { ok: false, message: 'Check the cart label and items before saving.' };
  const { data, error } = heldSaleId?.success
    ? await cashier.supabase.rpc('update_held_sale', { p_held_sale_id: heldSaleId.data, p_label: label.data || null, p_items: parsedItems.data as unknown as Json })
    : await cashier.supabase.rpc('save_held_sale', { p_shift_id: shiftId.data, p_label: label.data || null, p_items: parsedItems.data as unknown as Json });
  if (error || !data) return { ok: false, message: error?.message.includes('count') ? 'A cart cannot be saved during a full-store stock count.' : 'The cart could not be saved. Refresh and try again.' };
  revalidatePath('/pos');
  return { ok: true, message: 'Cart saved for this shift.', holdId: data, version: crypto.randomUUID() };
}

export async function deleteHeldSaleAction(formData: FormData): Promise<void> {
  const cashier = await getActiveCashier();
  const heldSaleId = z.string().uuid().safeParse(formData.get('heldSaleId'));
  if (!cashier || !heldSaleId.success) return;
  const { error } = await cashier.supabase.from('held_sales').delete().eq('id', heldSaleId.data).eq('cashier_id', cashier.userId);
  if (!error) revalidatePath('/pos');
}
