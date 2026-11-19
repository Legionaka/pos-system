import { connection } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { WorkspaceHeader } from '@/app/workspace/workspace-shell';
import { PosSettingsForms } from './pos-settings-forms';

export default async function OwnerPosSettingsPage() {
  await connection();
  const supabase = await createClient();
  const [settings, products, staff, promotions] = await Promise.all([
    supabase.from('store_feature_settings').select('cashier_discount_limit_bps').eq('singleton', true).maybeSingle(),
    supabase.from('products').select('id, name, sku').eq('active', true).order('name'),
    supabase.from('profiles').select('id, name, email').eq('active', true).eq('role', 'cashier').order('name'),
    supabase.from('promotions').select('id, name, discount_type, discount_value, starts_on, ends_on, active, product_id').order('created_at', { ascending: false }).limit(50),
  ]);
  return <div className="workspace-page"><WorkspaceHeader eyebrow="OWNER WORKSPACE / POS CONTROLS" title="Promotions and targets" description="Set cashier discount limits, schedule promotions, and record daily sales goals." />
    {(settings.error || products.error || staff.error || promotions.error) && <p className="workspace-alert" role="alert">Some POS settings could not be loaded. Apply the latest database migration and refresh.</p>}
    <PosSettingsForms limitPercent={(settings.data?.cashier_discount_limit_bps ?? 1000) / 100} products={products.data ?? []} staff={staff.data ?? []} promotions={promotions.data ?? []} />
  </div>;
}
