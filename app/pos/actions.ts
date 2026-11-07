'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const moneyText = z.string().trim().regex(/^\d{1,9}(?:\.\d{1,2})?$/, 'Enter an amount such as 0.00.');
const paymentMethod = z.enum(['cash', 'card', 'eft', 'qr']);
const saleInput = z.object({
  items: z.string().min(2).max(20_000),
  method: paymentMethod,
  cashReceived: z.string().trim().max(20),
  reference: z.string().trim().max(120),
});
const itemInput = z.array(z.object({
  product_id: z.string().uuid(),
  qty: z.number().int().positive().max(2_147_483_647),
})).min(1).max(100);

type SaleReceipt = {
  number: number;
  createdAt: string;
  subtotalCents: number;
  vatCents: number;
  roundingCents: number;
  totalCents: number;
  items: Array<{ name: string; sku: string; qty: number; unitPriceCents: number; lineTotalCents: number }>;
};

export type PosActionState = {
  message?: string;
  saleId?: string;
  saleNumber?: number;
  receipt?: SaleReceipt;
} | null;

export type ShiftActionState = { message?: string } | null;

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

  const quantities = new Map<string, number>();
  for (const item of requestedItems) {
    const quantity = (quantities.get(item.product_id) ?? 0) + item.qty;
    if (!Number.isSafeInteger(quantity) || quantity > 2_147_483_647) {
      return { message: 'An item quantity is too large.' };
    }
    quantities.set(item.product_id, quantity);
  }

  const itemPayload = [...quantities].map(([product_id, qty]) => ({ product_id, qty }));
  const productIds = itemPayload.map((item) => item.product_id);
  const { data: products, error: productsError } = await cashier.supabase
    .from('products')
    .select('id, price_cents, stock_qty, active')
    .in('id', productIds);

  if (productsError || !products || products.length !== productIds.length) {
    return { message: 'One or more products are no longer available. Refresh the catalog and try again.' };
  }

  let subtotalCents = 0;
  for (const item of itemPayload) {
    const product = products.find((row) => row.id === item.product_id);
    if (!product?.active) return { message: 'A product in this cart is no longer active. Refresh the catalog.' };
    if (product.stock_qty < item.qty) return { message: `There is not enough stock for one of the items. Available: ${product.stock_qty}.` };
    if (!Number.isSafeInteger(product.price_cents)) return { message: 'A product price is outside the supported amount range.' };
    subtotalCents += product.price_cents * item.qty;
    if (!Number.isSafeInteger(subtotalCents)) return { message: 'The sale total is outside the supported amount range.' };
  }

  const method = parsed.data.method;
  const roundingCents = method === 'cash' ? Math.round(subtotalCents / 5) * 5 - subtotalCents : 0;
  const totalCents = subtotalCents + roundingCents;
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

  const { data: saleId, error: saleError } = await cashier.supabase.rpc('complete_sale', {
    p_shift_id: shift.id,
    p_items: itemPayload,
    p_payments: payments,
  });

  if (saleError || !saleId) {
    const detail = saleError?.message.toLowerCase() ?? '';
    if (detail.includes('insufficient stock')) return { message: 'Stock changed while you were checking out. Review the cart and try again.' };
    if (detail.includes('open shift')) return { message: 'Your shift is no longer open. Refresh the page before starting another sale.' };
    if (detail.includes('payment')) return { message: 'Payment did not match the final total. Check the amount and try again.' };
    return { message: 'The sale could not be completed. Your cart is still here; please try again.' };
  }

  const { data: sale } = await cashier.supabase
    .from('sales')
    .select('number, created_at, subtotal_cents, vat_cents, rounding_cents, total_cents')
    .eq('id', saleId)
    .maybeSingle();

  const { data: saleItems } = await cashier.supabase
    .from('sale_items')
    .select('product_name, sku, qty, unit_price_cents, line_total_cents')
    .eq('sale_id', saleId)
    .order('created_at');

  revalidatePath('/pos');
  return {
    saleId,
    saleNumber: sale?.number,
    receipt: sale && saleItems ? {
      number: sale.number,
      createdAt: sale.created_at,
      subtotalCents: sale.subtotal_cents,
      vatCents: sale.vat_cents,
      roundingCents: sale.rounding_cents,
      totalCents: sale.total_cents,
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
