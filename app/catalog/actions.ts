'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const productFormSchema = z.object({
  id: z.union([z.literal(''), z.string().uuid()]),
  sku: z.string().trim().min(2).max(64).regex(/^[\w.-]+$/, 'Use letters, numbers, dots, underscores, or hyphens for the SKU.'),
  barcode: z.string().trim().max(64),
  name: z.string().trim().min(2).max(120),
  price: z.string().trim().regex(/^\d{1,9}(?:\.\d{1,2})?$/, 'Enter a price such as 24.99.'),
  taxCategory: z.enum(['standard', 'zero_rated', 'exempt']),
  reorderAt: z.string().regex(/^\d{1,9}$/).transform(Number).pipe(z.number().int().min(0).max(2_147_483_647)),
  categoryId: z.union([z.literal(''), z.string().uuid()]),
  active: z.enum(['true', 'false']),
});

const stockFormSchema = z.object({
  productId: z.string().uuid(),
  delta: z.string().regex(/^-?\d{1,9}$/).transform(Number).pipe(z.number().int().min(-2_147_483_647).max(2_147_483_647)).refine((value) => value !== 0),
  reason: z.string().trim().min(3).max(250),
});

const categoryNameSchema = z.string().trim().min(2).max(48).regex(/^[\p{L}\p{N} &'().-]+$/u);

export type CatalogActionState = {
  ok?: boolean;
  message?: string;
  version?: string;
} | null;

async function getActiveManager() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== 'string') return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('active, role')
    .eq('id', userId)
    .maybeSingle();
  if (!profile?.active || (profile.role !== 'manager' && profile.role !== 'owner')) return null;
  return supabase;
}

function moneyToCents(value: string) {
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function success(message: string): CatalogActionState {
  return { ok: true, message, version: crypto.randomUUID() };
}

export async function saveProductAction(
  _previousState: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  const supabase = await getActiveManager();
  if (!supabase) return { message: 'An active manager or owner account is required.' };

  const parsed = productFormSchema.safeParse({
    id: formData.get('id'),
    sku: formData.get('sku'),
    barcode: formData.get('barcode'),
    name: formData.get('name'),
    price: formData.get('price'),
    taxCategory: formData.get('taxCategory'),
    reorderAt: formData.get('reorderAt'),
    categoryId: formData.get('categoryId'),
    active: formData.get('active'),
  });
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? 'Check the product details and try again.' };

  const value = parsed.data;
  const product = {
    sku: value.sku,
    barcode: value.barcode || null,
    name: value.name,
    price_cents: moneyToCents(value.price),
    tax_category: value.taxCategory,
    reorder_at: value.reorderAt,
    active: value.active === 'true',
    category_id: value.categoryId || null,
  };

  const result = value.id
    ? await supabase.from('products').update(product).eq('id', value.id).select('id').maybeSingle()
    : await supabase.from('products').insert(product).select('id').single();

  if (result.error?.code === '23505') return { message: 'That SKU or barcode is already assigned to another product.' };
  if (result.error) return { message: 'The product could not be saved. Check the values and try again.' };
  if (!result.data) return { message: 'Product not found or you do not have permission to edit it.' };

  revalidatePath('/catalog');
  revalidatePath('/pos');
  return success(value.id ? 'Product changes saved.' : 'Product added. Set its opening stock with Adjust stock.');
}

export async function adjustProductStockAction(
  _previousState: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  const supabase = await getActiveManager();
  if (!supabase) return { message: 'An active manager or owner account is required.' };

  const parsed = stockFormSchema.safeParse({
    productId: formData.get('productId'),
    delta: formData.get('delta'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? 'Enter a non-zero quantity and a reason.' };

  const { error } = await supabase.rpc('adjust_stock', {
    p_product_id: parsed.data.productId,
    p_delta: parsed.data.delta,
    p_reason: parsed.data.reason,
  });
  if (error) {
    const message = error.message.toLowerCase().includes('invalid quantity')
      ? 'That adjustment would take stock below zero or above the supported limit.'
      : 'Stock could not be adjusted. Check the quantity and try again.';
    return { message };
  }

  revalidatePath('/catalog');
  revalidatePath('/pos');
  return success('Stock updated and adjustment reason recorded.');
}

export async function createCategoryAction(
  _previousState: CatalogActionState,
  formData: FormData,
): Promise<CatalogActionState> {
  const supabase = await getActiveManager();
  if (!supabase) return { message: 'An active manager or owner account is required.' };

  const parsed = categoryNameSchema.safeParse(formData.get('name'));
  if (!parsed.success) return { message: 'Enter a category name using letters, numbers, spaces, or basic punctuation.' };

  const { error } = await supabase.from('categories').insert({ name: parsed.data });
  if (error?.code === '23505') return { message: 'A category with that name already exists.' };
  if (error) return { message: 'The category could not be created. Try again.' };

  revalidatePath('/catalog');
  revalidatePath('/pos');
  return success('Category added.');
}
