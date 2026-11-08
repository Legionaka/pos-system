import 'server-only';
import { createClient } from '@/lib/supabase/server';

export type StoreSettings = { storeName: string; logoUrl: string | null; logoPath: string | null };

export async function getStoreSettings(): Promise<StoreSettings> {
  const supabase = await createClient();
  const { data } = await supabase.from('store_settings').select('store_name, logo_path').eq('singleton', true).maybeSingle();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const logoUrl = data?.logo_path && url
    ? `${url.replace(/\/$/, '')}/storage/v1/object/public/store-branding/${data.logo_path}`
    : null;
  return { storeName: data?.store_name ?? 'TrueMarket', logoPath: data?.logo_path ?? null, logoUrl };
}
