BEGIN;

-- Catalog variants remain independent stock keeping units, grouped for display.
ALTER TABLE public.products ADD COLUMN variant_group_id uuid REFERENCES public.products(id) ON DELETE SET NULL;
GRANT UPDATE (variant_group_id) ON public.products TO authenticated;
CREATE INDEX products_variant_group_idx ON public.products(variant_group_id);

CREATE TABLE public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name text NOT NULL CHECK (length(trim(supplier_name)) BETWEEN 2 AND 120),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ordered','partially_received','received','cancelled')),
  reference text CHECK (reference IS NULL OR length(reference) <= 120),
  notes text CHECK (notes IS NULL OR length(notes) <= 500),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name text NOT NULL,
  sku text NOT NULL,
  ordered_qty integer NOT NULL CHECK (ordered_qty > 0),
  received_qty integer NOT NULL DEFAULT 0 CHECK (received_qty >= 0 AND received_qty <= ordered_qty),
  unit_cost_cents bigint NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  UNIQUE(purchase_order_id, product_id)
);
ALTER TABLE public.stock_movements ADD COLUMN purchase_order_item_id uuid REFERENCES public.purchase_order_items(id) ON DELETE RESTRICT;

CREATE TABLE public.store_feature_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  cashier_discount_limit_bps integer NOT NULL DEFAULT 1000 CHECK (cashier_discount_limit_bps BETWEEN 0 AND 10000),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.store_feature_settings(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE public.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 100),
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  discount_type text NOT NULL CHECK (discount_type IN ('percent','fixed')),
  discount_value integer NOT NULL CHECK (discount_value > 0),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  CHECK ((discount_type = 'percent' AND discount_value <= 10000) OR discount_type = 'fixed')
);
CREATE INDEX promotions_active_dates_idx ON public.promotions(active, starts_on, ends_on);

CREATE TABLE public.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN ('paid_in','payout')),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 250),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sales_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_date date NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_cents bigint NOT NULL CHECK (target_cents > 0),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT(target_date, user_id)
);
CREATE TABLE public.discount_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cashier_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  approved_bps integer NOT NULL CHECK (approved_bps BETWEEN 0 AND 10000),
  approved_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '2 minutes',
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.discount_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.discount_approvals FROM anon, authenticated;

ALTER TABLE public.sales ADD COLUMN offline_key uuid UNIQUE;

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_feature_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_orders, public.purchase_order_items, public.store_feature_settings, public.promotions, public.cash_movements, public.sales_targets FROM anon, authenticated;
GRANT SELECT ON public.purchase_orders, public.purchase_order_items, public.store_feature_settings, public.promotions, public.cash_movements, public.sales_targets TO authenticated;
CREATE POLICY purchase_orders_manager_read ON public.purchase_orders FOR SELECT TO authenticated USING (public.has_any_role(ARRAY['manager'::public.app_role,'owner'::public.app_role]));
CREATE POLICY purchase_items_manager_read ON public.purchase_order_items FOR SELECT TO authenticated USING (public.has_any_role(ARRAY['manager'::public.app_role,'owner'::public.app_role]));
CREATE POLICY feature_settings_staff_read ON public.store_feature_settings FOR SELECT TO authenticated USING (public.has_any_role(ARRAY['cashier'::public.app_role,'manager'::public.app_role,'owner'::public.app_role]));
CREATE POLICY promotions_staff_read ON public.promotions FOR SELECT TO authenticated USING (public.has_any_role(ARRAY['cashier'::public.app_role,'manager'::public.app_role,'owner'::public.app_role]));
CREATE POLICY cash_movements_manager_read ON public.cash_movements FOR SELECT TO authenticated USING (public.has_any_role(ARRAY['manager'::public.app_role,'owner'::public.app_role]) OR EXISTS(SELECT 1 FROM public.shifts s WHERE s.id=shift_id AND s.user_id=auth.uid()));
CREATE POLICY targets_manager_read ON public.sales_targets FOR SELECT TO authenticated USING (public.has_any_role(ARRAY['manager'::public.app_role,'owner'::public.app_role]));

CREATE OR REPLACE FUNCTION public.set_cashier_discount_limit(p_limit_bps integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.has_role('owner') THEN RAISE EXCEPTION 'An active owner account is required'; END IF;
  IF p_limit_bps NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'Discount limit must be between 0 and 100 percent'; END IF;
  UPDATE public.store_feature_settings SET cashier_discount_limit_bps=p_limit_bps, updated_by=v_actor, updated_at=now() WHERE singleton;
END; $$;

CREATE OR REPLACE FUNCTION public.approve_sale_discount(p_cashier_id uuid,p_discount_bps integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_actor uuid:=auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.has_any_role(ARRAY['manager'::public.app_role,'owner'::public.app_role]) THEN RAISE EXCEPTION 'An active manager or owner account is required'; END IF;
  IF p_discount_bps NOT BETWEEN 0 AND 10000 OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_cashier_id AND active AND role='cashier') THEN RAISE EXCEPTION 'Discount approval details are invalid'; END IF;
  INSERT INTO public.discount_approvals(cashier_id,approved_bps,approved_by) VALUES(p_cashier_id,p_discount_bps,v_actor);
  INSERT INTO public.audit_logs(user_id,action,entity_type,meta) VALUES(v_actor,'sale_discount_approved','discount_approvals',jsonb_build_object('cashier_id',p_cashier_id,'approved_bps',p_discount_bps));
END; $$;

CREATE OR REPLACE FUNCTION private.enforce_sale_discount_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_limit integer; v_required integer; v_approval uuid;
BEGIN
  IF NEW.subtotal_cents=0 OR NEW.discount_cents=0 THEN RETURN NEW; END IF;
  SELECT cashier_discount_limit_bps INTO v_limit FROM public.store_feature_settings WHERE singleton;
  v_required:=ceil(NEW.discount_cents::numeric*10000/NEW.subtotal_cents)::integer;
  IF v_required<=coalesce(v_limit,1000) THEN RETURN NEW; END IF;
  SELECT id INTO v_approval FROM public.discount_approvals WHERE cashier_id=NEW.cashier_id AND approved_bps>=v_required AND used_at IS NULL AND expires_at>now() ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF v_approval IS NULL THEN RAISE EXCEPTION 'Manager approval is required for this discount'; END IF;
  UPDATE public.discount_approvals SET used_at=now() WHERE id=v_approval;
  RETURN NEW;
END; $$;
CREATE TRIGGER sales_discount_approval_guard BEFORE INSERT ON public.sales FOR EACH ROW EXECUTE FUNCTION private.enforce_sale_discount_approval();

CREATE OR REPLACE FUNCTION public.save_promotion(p_id uuid, p_name text, p_product_id uuid, p_type text, p_value integer, p_starts_on date, p_ends_on date, p_active boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_actor uuid := auth.uid(); v_id uuid := COALESCE(p_id, gen_random_uuid());
BEGIN
  IF v_actor IS NULL OR NOT public.has_role('owner') THEN RAISE EXCEPTION 'An active owner account is required'; END IF;
  IF length(trim(p_name)) NOT BETWEEN 2 AND 100 OR p_type NOT IN ('percent','fixed') OR p_value<=0 OR p_starts_on IS NULL OR p_ends_on<p_starts_on OR (p_type='percent' AND p_value>10000) THEN RAISE EXCEPTION 'Promotion details are invalid'; END IF;
  INSERT INTO public.promotions(id,name,product_id,discount_type,discount_value,starts_on,ends_on,active,created_by)
  VALUES(v_id,trim(p_name),p_product_id,p_type,p_value,p_starts_on,p_ends_on,p_active,v_actor)
  ON CONFLICT(id) DO UPDATE SET name=excluded.name,product_id=excluded.product_id,discount_type=excluded.discount_type,discount_value=excluded.discount_value,starts_on=excluded.starts_on,ends_on=excluded.ends_on,active=excluded.active;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.save_sales_target(p_date date, p_user_id uuid, p_target_cents bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.has_role('owner') THEN RAISE EXCEPTION 'An active owner account is required'; END IF;
  IF p_date IS NULL OR p_target_cents<=0 THEN RAISE EXCEPTION 'Target date and amount are required'; END IF;
  IF p_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user_id AND active AND role='cashier') THEN RAISE EXCEPTION 'Target staff member is unavailable'; END IF;
  INSERT INTO public.sales_targets(target_date,user_id,target_cents,created_by) VALUES(p_date,p_user_id,p_target_cents,v_actor)
  ON CONFLICT(target_date,user_id) DO UPDATE SET target_cents=excluded.target_cents,updated_at=now(),created_by=v_actor;
END; $$;

CREATE OR REPLACE FUNCTION public.create_purchase_order(p_supplier text,p_reference text,p_notes text,p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_actor uuid:=auth.uid(); v_id uuid:=gen_random_uuid(); v_item jsonb; v_product public.products%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT public.has_any_role(ARRAY['manager'::public.app_role,'owner'::public.app_role]) THEN RAISE EXCEPTION 'An active manager or owner account is required'; END IF;
  IF length(trim(p_supplier)) NOT BETWEEN 2 AND 120 OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Purchase order details are invalid'; END IF;
  INSERT INTO public.purchase_orders(id,supplier_name,reference,notes,created_by) VALUES(v_id,trim(p_supplier),nullif(trim(p_reference),''),nullif(trim(p_notes),''),v_actor);
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE id=(v_item->>'product_id')::uuid AND active;
    IF NOT FOUND OR (v_item->>'qty')::integer<=0 OR (v_item->>'unit_cost_cents')::bigint<0 THEN RAISE EXCEPTION 'Purchase order item is invalid'; END IF;
    INSERT INTO public.purchase_order_items(purchase_order_id,product_id,product_name,sku,ordered_qty,unit_cost_cents) VALUES(v_id,v_product.id,v_product.name,v_product.sku,(v_item->>'qty')::integer,(v_item->>'unit_cost_cents')::bigint);
  END LOOP;
  INSERT INTO public.audit_logs(user_id,action,entity_type,entity_id,meta) VALUES(v_actor,'purchase_order_created','purchase_orders',v_id,jsonb_build_object('supplier_name',trim(p_supplier),'item_count',jsonb_array_length(p_items)));
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.set_purchase_order_status(p_id uuid,p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_actor uuid:=auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.has_any_role(ARRAY['manager'::public.app_role,'owner'::public.app_role]) THEN RAISE EXCEPTION 'An active manager or owner account is required'; END IF;
  IF p_status NOT IN ('ordered','cancelled') THEN RAISE EXCEPTION 'Invalid purchase order transition'; END IF;
  UPDATE public.purchase_orders SET status=p_status,updated_at=now() WHERE id=p_id AND status='draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order cannot be changed'; END IF;
  INSERT INTO public.audit_logs(user_id,action,entity_type,entity_id,meta) VALUES(v_actor,'purchase_order_status_changed','purchase_orders',p_id,jsonb_build_object('status',p_status));
END; $$;

CREATE OR REPLACE FUNCTION public.receive_purchase_order_item(p_id uuid,p_item_id uuid,p_qty integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_actor uuid:=auth.uid(); v_item public.purchase_order_items%ROWTYPE; v_order public.purchase_orders%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT public.has_any_role(ARRAY['manager'::public.app_role,'owner'::public.app_role]) THEN RAISE EXCEPTION 'An active manager or owner account is required'; END IF;
  IF p_qty<=0 THEN RAISE EXCEPTION 'Received quantity must be positive'; END IF;
  SELECT * INTO v_order FROM public.purchase_orders WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR v_order.status NOT IN ('ordered','partially_received') THEN RAISE EXCEPTION 'Purchase order is not open for receiving'; END IF;
  SELECT * INTO v_item FROM public.purchase_order_items WHERE id=p_item_id AND purchase_order_id=p_id FOR UPDATE;
  IF NOT FOUND OR v_item.received_qty+p_qty>v_item.ordered_qty THEN RAISE EXCEPTION 'Received quantity exceeds outstanding order quantity'; END IF;
  UPDATE public.products SET stock_qty=stock_qty+p_qty WHERE id=v_item.product_id;
  UPDATE public.purchase_order_items SET received_qty=received_qty+p_qty WHERE id=p_item_id;
  UPDATE public.purchase_orders SET status=CASE WHEN NOT EXISTS(SELECT 1 FROM public.purchase_order_items WHERE purchase_order_id=p_id AND received_qty<ordered_qty) THEN 'received' ELSE 'partially_received' END,updated_at=now() WHERE id=p_id;
  INSERT INTO public.stock_movements(product_id,delta,reason,actor_id,purchase_order_item_id) VALUES(v_item.product_id,p_qty,'delivery_received',v_actor,p_item_id);
  INSERT INTO public.audit_logs(user_id,action,entity_type,entity_id,meta) VALUES(v_actor,'purchase_order_item_received','purchase_orders',p_id,jsonb_build_object('item_id',p_item_id,'quantity',p_qty));
END; $$;

CREATE OR REPLACE FUNCTION public.record_cash_movement(p_shift_id uuid,p_type text,p_amount bigint,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_actor uuid:=auth.uid(); v_id uuid:=gen_random_uuid(); v_shift public.shifts%ROWTYPE; v_available bigint;
BEGIN
  IF v_actor IS NULL OR NOT public.has_any_role(ARRAY['cashier'::public.app_role,'manager'::public.app_role,'owner'::public.app_role]) THEN RAISE EXCEPTION 'An active staff account is required'; END IF;
  IF p_type NOT IN ('paid_in','payout') OR p_amount<=0 OR length(trim(p_reason)) NOT BETWEEN 3 AND 250 THEN RAISE EXCEPTION 'Cash movement details are invalid'; END IF;
  SELECT * INTO v_shift FROM public.shifts WHERE id=p_shift_id AND closed_at IS NULL AND (user_id=v_actor OR public.has_any_role(ARRAY['manager'::public.app_role,'owner'::public.app_role])) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Open shift not found'; END IF;
  IF p_type='payout' THEN
    SELECT v_shift.opening_cash_cents
      + COALESCE((SELECT sum(p.amount_cents) FROM public.sales s JOIN public.payments p ON p.sale_id=s.id WHERE s.shift_id=p_shift_id AND s.status<>'voided' AND p.method='cash'),0)
      - COALESCE((SELECT sum(rp.amount_cents) FROM public.sales s JOIN public.refunds r ON r.sale_id=s.id JOIN public.refund_payments rp ON rp.refund_id=r.id WHERE s.shift_id=p_shift_id AND rp.method='cash'),0)
      + COALESCE((SELECT sum(amount_cents) FROM public.cash_movements WHERE shift_id=p_shift_id AND movement_type='paid_in'),0)
      - COALESCE((SELECT sum(amount_cents) FROM public.cash_movements WHERE shift_id=p_shift_id AND movement_type='payout'),0)
    INTO v_available;
    IF p_amount>v_available THEN RAISE EXCEPTION 'Payout exceeds cash currently expected in the till'; END IF;
  END IF;
  INSERT INTO public.cash_movements(id,shift_id,movement_type,amount_cents,reason,actor_id) VALUES(v_id,p_shift_id,p_type,p_amount,trim(p_reason),v_actor);
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.save_variant_group(p_product_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_actor uuid:=auth.uid(); v_group uuid; v_root uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.has_any_role(ARRAY['manager'::public.app_role,'owner'::public.app_role]) THEN RAISE EXCEPTION 'An active manager or owner account is required'; END IF;
  IF cardinality(p_product_ids)<2 OR cardinality(p_product_ids)>50 OR (SELECT count(DISTINCT x) FROM unnest(p_product_ids) x)<>cardinality(p_product_ids) THEN RAISE EXCEPTION 'Select between 2 and 50 unique products'; END IF;
  SELECT id INTO v_root FROM public.products WHERE id=ANY(p_product_ids) ORDER BY id LIMIT 1;
  v_group:=v_root;
  UPDATE public.products SET variant_group_id=v_group WHERE id=ANY(p_product_ids);
  UPDATE public.products SET variant_group_id=NULL WHERE variant_group_id=v_group AND NOT(id=ANY(p_product_ids));
  RETURN v_group;
END; $$;

CREATE OR REPLACE FUNCTION public.offline_complete_sale(p_key uuid,p_shift_id uuid,p_items jsonb,p_cash_received bigint)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_actor uuid:=auth.uid(); v_existing uuid; v_total bigint; v_items jsonb; v_sale uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.has_role('cashier') THEN RAISE EXCEPTION 'An active cashier account is required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_key::text, 0));
  SELECT id INTO v_existing FROM public.sales WHERE offline_key=p_key;
  IF FOUND THEN RETURN v_existing; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 OR p_cash_received<0 THEN RAISE EXCEPTION 'Offline sale details are invalid'; END IF;
  SELECT sum(p.price_cents*(x.value->>'qty')::integer - COALESCE((x.value->>'discount_cents')::bigint,0)) INTO v_total FROM jsonb_array_elements(p_items) x(value) JOIN public.products p ON p.id=(x.value->>'product_id')::uuid WHERE p.active;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) x(value)
    JOIN public.products p ON p.id=(x.value->>'product_id')::uuid
    WHERE NOT p.active OR (x.value->>'unit_price_cents')::bigint IS DISTINCT FROM p.price_cents
  ) THEN RAISE EXCEPTION 'Offline sale product or price changed; staff review is required'; END IF;
  IF v_total IS NULL OR v_cash_received<v_total THEN RAISE EXCEPTION 'Offline cash amount is insufficient or a product is unavailable'; END IF;
  v_total := round(v_total::numeric / 5)::bigint * 5;
  IF v_cash_received<v_total THEN RAISE EXCEPTION 'Offline cash amount is insufficient or a product is unavailable'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x(value) JOIN public.products p ON p.id=(x.value->>'product_id')::uuid WHERE COALESCE((x.value->>'discount_cents')::bigint,0)>p.price_cents*(x.value->>'qty')::integer) THEN RAISE EXCEPTION 'Offline sale discount is invalid'; END IF;
  v_items:=p_items;
  v_sale:=public.complete_sale(p_shift_id,v_items,jsonb_build_array(jsonb_build_object('method','cash','amount_cents',v_total,'received_cents',v_cash_received)));
  UPDATE public.sales SET offline_key=p_key WHERE id=v_sale;
  RETURN v_sale;
END; $$;

CREATE OR REPLACE FUNCTION public.close_shift(p_shift_id uuid,p_counted_cash_cents bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_actor_id uuid:=auth.uid(); v_shift public.shifts%ROWTYPE; v_expected_cash bigint; v_variance bigint;
BEGIN
  IF v_actor_id IS NULL OR NOT public.has_any_role(ARRAY['cashier'::public.app_role,'manager'::public.app_role,'owner'::public.app_role]) THEN RAISE EXCEPTION 'An active staff account is required'; END IF;
  IF p_counted_cash_cents IS NULL OR p_counted_cash_cents<0 THEN RAISE EXCEPTION 'Counted cash must be zero or greater'; END IF;
  SELECT * INTO v_shift FROM public.shifts WHERE id=p_shift_id FOR UPDATE;
  IF NOT FOUND OR v_shift.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Open shift not found'; END IF;
  IF v_shift.user_id<>v_actor_id AND NOT public.has_any_role(ARRAY['manager'::public.app_role,'owner'::public.app_role]) THEN RAISE EXCEPTION 'You may only close your own shift'; END IF;
  SELECT v_shift.opening_cash_cents
    + COALESCE((SELECT sum(p.amount_cents) FROM public.sales s JOIN public.payments p ON p.sale_id=s.id WHERE s.shift_id=p_shift_id AND s.status<>'voided' AND p.method='cash'),0)
    - COALESCE((SELECT sum(rp.amount_cents) FROM public.sales s JOIN public.refunds r ON r.sale_id=s.id JOIN public.refund_payments rp ON rp.refund_id=r.id WHERE s.shift_id=p_shift_id AND rp.method='cash'),0)
    + COALESCE((SELECT sum(amount_cents) FROM public.cash_movements WHERE shift_id=p_shift_id AND movement_type='paid_in'),0)
    - COALESCE((SELECT sum(amount_cents) FROM public.cash_movements WHERE shift_id=p_shift_id AND movement_type='payout'),0)
  INTO v_expected_cash;
  IF v_expected_cash<0 THEN RAISE EXCEPTION 'Calculated expected cash cannot be negative'; END IF;
  v_variance:=p_counted_cash_cents-v_expected_cash;
  UPDATE public.shifts SET closed_at=now(),expected_cash_cents=v_expected_cash,counted_cash_cents=p_counted_cash_cents,cash_variance_cents=v_variance WHERE id=p_shift_id;
  INSERT INTO public.audit_logs(user_id,action,entity_type,entity_id,meta) VALUES(v_actor_id,'shift_closed','shifts',p_shift_id,'{}'::jsonb);
  RETURN jsonb_build_object('expected_cash_cents',v_expected_cash,'counted_cash_cents',p_counted_cash_cents,'cash_variance_cents',v_variance);
END; $$;

REVOKE ALL ON FUNCTION public.set_cashier_discount_limit(integer), public.approve_sale_discount(uuid,integer), public.save_promotion(uuid,text,uuid,text,integer,date,date,boolean), public.save_sales_target(date,uuid,bigint), public.create_purchase_order(text,text,text,jsonb), public.set_purchase_order_status(uuid,text), public.receive_purchase_order_item(uuid,uuid,integer), public.record_cash_movement(uuid,text,bigint,text), public.save_variant_group(uuid[]), public.offline_complete_sale(uuid,uuid,jsonb,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_cashier_discount_limit(integer), public.approve_sale_discount(uuid,integer), public.save_promotion(uuid,text,uuid,text,integer,date,date,boolean), public.save_sales_target(date,uuid,bigint), public.create_purchase_order(text,text,text,jsonb), public.set_purchase_order_status(uuid,text), public.receive_purchase_order_item(uuid,uuid,integer), public.record_cash_movement(uuid,text,bigint,text), public.save_variant_group(uuid[]), public.offline_complete_sale(uuid,uuid,jsonb,bigint) TO authenticated;

COMMIT;
