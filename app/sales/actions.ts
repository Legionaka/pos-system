'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Database, Json } from '@/lib/supabase/database';
import { createClient } from '@/lib/supabase/server';

type RefundActionState = { ok: boolean; message: string; totalCents?: number } | null;
type RefundLineRequest = { sale_item_id: string; qty: number; restock: boolean };
type RefundPayment = { method: Database['public']['Enums']['payment_method']; amount_cents: number; reference: string | null };

const saleIdSchema = z.string().uuid();
const reasonSchema = z.string().trim().min(3, 'Enter a refund reason.').max(250, 'Reason must be 250 characters or fewer.');
const methods = ['cash', 'card', 'eft', 'qr'] as const;

export async function recordRefundAction(_previous: RefundActionState, formData: FormData): Promise<RefundActionState> {
  const saleId = saleIdSchema.safeParse(formData.get('saleId'));
  const reason = reasonSchema.safeParse(formData.get('reason'));
  const method = z.enum(methods).safeParse(formData.get('method'));
  const reference = z.string().trim().max(120).safeParse(formData.get('reference') ?? '');
  if (!saleId.success || !reason.success || !method.success || !reference.success) {
    return { ok: false, message: !reason.success ? reason.error.issues[0]?.message ?? 'Enter a refund reason.' : 'Check the refund details and try again.' };
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== 'string') return { ok: false, message: 'Sign in with a manager or owner account to issue refunds.' };
  const { data: profile } = await supabase.from('profiles').select('active, role').eq('id', userId).maybeSingle();
  if (!profile?.active || (profile.role !== 'manager' && profile.role !== 'owner')) {
    return { ok: false, message: 'Only active managers and owners can issue refunds.' };
  }

  const { data: sale, error: saleError } = await supabase.from('sales')
    .select('id, status, rounding_cents')
    .eq('id', saleId.data)
    .maybeSingle();
  if (saleError || !sale) return { ok: false, message: 'Sale could not be found or is not available to your account.' };
  if (sale.status !== 'completed' && sale.status !== 'partially_refunded') {
    return { ok: false, message: 'This sale can no longer be refunded.' };
  }

  const [{ data: lines, error: linesError }, { data: refunds, error: refundsError }] = await Promise.all([
    supabase.from('sale_items').select('id, qty, line_total_cents').eq('sale_id', saleId.data),
    supabase.from('refunds').select('id, rounding_cents').eq('sale_id', saleId.data),
  ]);
  if (linesError || refundsError || !lines?.length) return { ok: false, message: 'Original sale lines could not be loaded.' };

  const { data: priorItems, error: priorItemsError } = await supabase.from('refund_items')
    .select('sale_item_id, qty, amount_cents')
    .in('sale_item_id', lines.map((line) => line.id));
  if (priorItemsError) return { ok: false, message: 'Existing refund quantities could not be checked. Refresh and try again.' };

  const refundedByLine = new Map<string, { qty: number; amountCents: number }>();
  for (const item of priorItems ?? []) {
    const current = refundedByLine.get(item.sale_item_id) ?? { qty: 0, amountCents: 0 };
    current.qty += item.qty;
    current.amountCents += item.amount_cents;
    refundedByLine.set(item.sale_item_id, current);
  }

  const requested: RefundLineRequest[] = [];
  let lineRefundCents = 0;
  for (const line of lines) {
    const rawQty = formData.get(`qty_${line.id}`);
    if (typeof rawQty !== 'string' || rawQty.trim() === '' || rawQty === '0') continue;
    const qtyResult = z.coerce.number().int().positive().safeParse(rawQty);
    if (!qtyResult.success) return { ok: false, message: 'Refund quantities must be whole numbers greater than zero.' };
    const qty = qtyResult.data;
    const previous = refundedByLine.get(line.id) ?? { qty: 0, amountCents: 0 };
    const remainingQty = line.qty - previous.qty;
    if (qty > remainingQty) return { ok: false, message: 'One or more quantities exceed the remaining refundable quantity. Refresh and try again.' };
    const remainingAmount = line.line_total_cents - previous.amountCents;
    const amount = qty === remainingQty
      ? remainingAmount
      : Math.round(line.line_total_cents * qty / line.qty);
    if (amount < 0 || amount > remainingAmount) return { ok: false, message: 'A refund amount could not be calculated from the original sale.' };
    lineRefundCents += amount;
    requested.push({
      sale_item_id: line.id,
      qty,
      restock: formData.get(`restock_${line.id}`) === 'on',
    });
  }
  if (!requested.length) return { ok: false, message: 'Choose at least one item quantity to refund.' };

  const completesAllItems = lines.every((line) => {
    const previous = refundedByLine.get(line.id)?.qty ?? 0;
    const current = requested.find((item) => item.sale_item_id === line.id)?.qty ?? 0;
    return previous + current === line.qty;
  });
  const previousRounding = (refunds ?? []).reduce((sum, refund) => sum + refund.rounding_cents, 0);
  const roundingAdjustment = completesAllItems ? sale.rounding_cents - previousRounding : 0;
  const totalCents = lineRefundCents + roundingAdjustment;
  if (totalCents < 0) return { ok: false, message: 'The calculated refund would be negative and cannot be recorded.' };

  const payments: RefundPayment[] = totalCents > 0
    ? [{ method: method.data, amount_cents: totalCents, reference: reference.data || null }]
    : [];
  const { data: refundId, error } = await supabase.rpc('record_refund', {
    p_sale_id: saleId.data,
    p_reason: reason.data,
    p_items: requested.map((item) => ({ sale_item_id: item.sale_item_id, qty: item.qty, restock: item.restock })) as Json,
    p_payments: payments.map((payment) => ({ method: payment.method, amount_cents: payment.amount_cents, reference: payment.reference })) as Json,
  });
  if (error || !refundId) {
    return { ok: false, message: error?.message ?? 'Refund could not be recorded. Refresh and try again.' };
  }

  revalidatePath('/sales');
  return { ok: true, message: `Refund recorded for R${(totalCents / 100).toFixed(2)}.`, totalCents };
}
