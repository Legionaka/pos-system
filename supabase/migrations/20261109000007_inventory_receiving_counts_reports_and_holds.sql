BEGIN;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_path text;
ALTER TABLE public.products ADD CONSTRAINT products_image_path_check
  CHECK (image_path IS NULL OR image_path ~ '^products/[a-z0-9-]+\.(png|jpg|webp)$');
GRANT UPDATE (image_path) ON public.products TO authenticated;
GRANT INSERT (image_path) ON public.products TO authenticated;

CREATE TABLE public.inventory_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name text NOT NULL CHECK (length(trim(supplier_name)) BETWEEN 2 AND 120),
  delivery_date date NOT NULL DEFAULT current_date,
  reference text CHECK (reference IS NULL OR length(reference) <= 120),
  notes text CHECK (notes IS NULL OR length(notes) <= 500),
  received_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.inventory_delivery_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES public.inventory_deliveries(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name text NOT NULL,
  sku text NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  unit_cost_cents bigint NOT NULL CHECK (unit_cost_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, product_id)
);

CREATE TABLE public.inventory_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  started_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  completed_at timestamptz,
  CHECK ((status = 'in_progress' AND completed_at IS NULL) OR (status <> 'in_progress' AND completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX inventory_counts_one_active_idx ON public.inventory_counts ((status)) WHERE status = 'in_progress';

CREATE TABLE public.inventory_count_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL REFERENCES public.inventory_counts(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name text NOT NULL,
  sku text NOT NULL,
  expected_qty integer NOT NULL CHECK (expected_qty >= 0),
  counted_qty integer CHECK (counted_qty >= 0),
  counted_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  counted_at timestamptz,
  UNIQUE (count_id, product_id),
  CHECK ((counted_qty IS NULL AND counted_at IS NULL) OR (counted_qty IS NOT NULL AND counted_at IS NOT NULL))
);

ALTER TABLE public.stock_movements DROP CONSTRAINT stock_movements_reason_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_reason_check
  CHECK (reason IN ('sale_completed', 'refund_restock', 'manual_adjustment', 'sale_voided', 'delivery_received', 'stock_count_adjustment'));
ALTER TABLE public.stock_movements ADD COLUMN delivery_id uuid REFERENCES public.inventory_deliveries(id) ON DELETE RESTRICT;
ALTER TABLE public.stock_movements ADD COLUMN count_id uuid REFERENCES public.inventory_counts(id) ON DELETE RESTRICT;
CREATE INDEX inventory_deliveries_created_idx ON public.inventory_deliveries(created_at DESC);
CREATE INDEX inventory_delivery_items_delivery_idx ON public.inventory_delivery_items(delivery_id);
CREATE INDEX inventory_counts_created_idx ON public.inventory_counts(started_at DESC);
CREATE INDEX inventory_count_items_count_idx ON public.inventory_count_items(count_id, product_name);
CREATE INDEX sales_created_status_idx ON public.sales(created_at DESC, status);

ALTER TABLE public.inventory_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_delivery_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_count_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_deliveries, public.inventory_delivery_items, public.inventory_counts, public.inventory_count_items FROM anon, authenticated;
GRANT SELECT ON public.inventory_deliveries, public.inventory_delivery_items, public.inventory_counts, public.inventory_count_items TO authenticated;

CREATE POLICY inventory_deliveries_managers_read ON public.inventory_deliveries FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]));
CREATE POLICY inventory_delivery_items_managers_read ON public.inventory_delivery_items FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]));
CREATE POLICY inventory_counts_managers_read ON public.inventory_counts FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]));
CREATE POLICY inventory_count_items_managers_read ON public.inventory_count_items FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]));

-- One transaction-level gate serializes checkout, stock movement, and count start/finalization.
CREATE OR REPLACE FUNCTION private.guard_product_stock_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(731904, 1);
  IF current_setting('app.inventory_count_apply', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_counts WHERE status = 'in_progress') THEN
    RAISE EXCEPTION 'Stock is locked while a full-store count is in progress';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER products_stock_count_guard
BEFORE INSERT OR UPDATE OF stock_qty ON public.products
FOR EACH ROW EXECUTE FUNCTION private.guard_product_stock_change();

CREATE OR REPLACE FUNCTION public.receive_inventory_delivery(
  p_supplier_name text, p_delivery_date date, p_reference text, p_notes text, p_items jsonb
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE
  v_actor uuid := auth.uid(); v_delivery uuid := gen_random_uuid(); v_item jsonb;
  v_product_id uuid; v_product public.products%ROWTYPE; v_qty integer; v_cost bigint;
BEGIN
  IF v_actor IS NULL OR NOT public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]) THEN
    RAISE EXCEPTION 'An active manager or owner account is required';
  END IF;
  IF p_supplier_name IS NULL OR length(trim(p_supplier_name)) NOT BETWEEN 2 AND 120
     OR p_delivery_date IS NULL OR (p_reference IS NOT NULL AND length(p_reference) > 120)
     OR (p_notes IS NOT NULL AND length(p_notes) > 500) THEN
    RAISE EXCEPTION 'Check the supplier and delivery details';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'A delivery must contain between 1 and 100 products';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) AS x(value)
    WHERE jsonb_typeof(x.value) <> 'object' OR x.value->>'product_id' IS NULL
      OR x.value->>'qty' IS NULL OR x.value->>'unit_cost_cents' IS NULL)
    OR (SELECT count(*) <> count(DISTINCT (x.value->>'product_id')::uuid) FROM jsonb_array_elements(p_items) AS x(value)) THEN
    RAISE EXCEPTION 'Every delivery product must appear once with a quantity and unit cost';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(731904, 1);
  IF EXISTS (SELECT 1 FROM public.inventory_counts WHERE status = 'in_progress') THEN
    RAISE EXCEPTION 'Complete or cancel the active stock count before receiving a delivery';
  END IF;
  FOR v_product_id IN SELECT (x.value->>'product_id')::uuid FROM jsonb_array_elements(p_items) AS x(value) ORDER BY 1 LOOP
    SELECT * INTO v_product FROM public.products WHERE id = v_product_id FOR UPDATE;
    IF NOT FOUND OR NOT v_product.active THEN RAISE EXCEPTION 'Delivery product not found or inactive'; END IF;
  END LOOP;
  INSERT INTO public.inventory_deliveries(id, supplier_name, delivery_date, reference, notes, received_by)
  VALUES (v_delivery, trim(p_supplier_name), p_delivery_date, nullif(trim(p_reference), ''), nullif(trim(p_notes), ''), v_actor);
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS x(value) LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'qty')::integer;
    v_cost := (v_item->>'unit_cost_cents')::bigint;
    IF v_qty <= 0 OR v_cost < 0 THEN RAISE EXCEPTION 'Delivery quantity must be positive and cost cannot be negative'; END IF;
    SELECT * INTO v_product FROM public.products WHERE id = v_product_id FOR UPDATE;
    INSERT INTO public.inventory_delivery_items(delivery_id, product_id, product_name, sku, qty, unit_cost_cents)
    VALUES (v_delivery, v_product.id, v_product.name, v_product.sku, v_qty, v_cost);
    UPDATE public.products SET stock_qty = stock_qty + v_qty WHERE id = v_product.id;
    INSERT INTO public.stock_movements(product_id, delta, reason, actor_id, delivery_id)
    VALUES (v_product.id, v_qty, 'delivery_received', v_actor, v_delivery);
  END LOOP;
  INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, meta)
  VALUES (v_actor, 'inventory_delivery_received', 'inventory_deliveries', v_delivery,
    jsonb_build_object('supplier_name', trim(p_supplier_name), 'item_count', jsonb_array_length(p_items)));
  RETURN v_delivery;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_inventory_count()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_actor uuid := auth.uid(); v_count uuid := gen_random_uuid();
BEGIN
  IF v_actor IS NULL OR NOT public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]) THEN
    RAISE EXCEPTION 'An active manager or owner account is required';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(731904, 1);
  IF EXISTS (SELECT 1 FROM public.inventory_counts WHERE status = 'in_progress') THEN
    RAISE EXCEPTION 'A full-store stock count is already in progress';
  END IF;
  INSERT INTO public.inventory_counts(id, started_by) VALUES(v_count, v_actor);
  INSERT INTO public.inventory_count_items(count_id, product_id, product_name, sku, expected_qty)
  SELECT v_count, p.id, p.name, p.sku, p.stock_qty FROM public.products p ORDER BY p.name;
  INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, meta)
  VALUES(v_actor, 'inventory_count_started', 'inventory_counts', v_count,
    jsonb_build_object('product_count', (SELECT count(*) FROM public.inventory_count_items WHERE count_id = v_count)));
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_inventory_count(p_count_id uuid, p_counts jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_actor uuid := auth.uid(); v_count public.inventory_counts%ROWTYPE; v_row jsonb; v_item_id uuid; v_qty integer; v_item public.inventory_count_items%ROWTYPE; v_delta integer;
BEGIN
  IF v_actor IS NULL OR NOT public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]) THEN
    RAISE EXCEPTION 'An active manager or owner account is required';
  END IF;
  IF jsonb_typeof(p_counts) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Count entries must be a JSON array'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(731904, 1);
  SELECT * INTO v_count FROM public.inventory_counts WHERE id = p_count_id FOR UPDATE;
  IF NOT FOUND OR v_count.status <> 'in_progress' THEN RAISE EXCEPTION 'Active stock count not found'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_counts) x(value)
    WHERE jsonb_typeof(x.value) <> 'object' OR x.value->>'item_id' IS NULL OR x.value->>'counted_qty' IS NULL)
    OR (SELECT count(*) <> count(DISTINCT (x.value->>'item_id')::uuid) FROM jsonb_array_elements(p_counts) x(value))
    OR (SELECT count(*) FROM jsonb_array_elements(p_counts)) <> (SELECT count(*) FROM public.inventory_count_items WHERE count_id = p_count_id) THEN
    RAISE EXCEPTION 'Submit exactly one non-negative count for every listed product';
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_counts) AS x(value) LOOP
    v_item_id := (v_row->>'item_id')::uuid;
    v_qty := (v_row->>'counted_qty')::integer;
    IF v_qty < 0 THEN RAISE EXCEPTION 'Counted quantity cannot be negative'; END IF;
    SELECT * INTO v_item FROM public.inventory_count_items WHERE id = v_item_id AND count_id = p_count_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Count item does not belong to the active stock count'; END IF;
    UPDATE public.inventory_count_items SET counted_qty = v_qty, counted_by = v_actor, counted_at = now() WHERE id = v_item_id;
  END LOOP;
  PERFORM set_config('app.inventory_count_apply', 'on', true);
  FOR v_item IN SELECT * FROM public.inventory_count_items WHERE count_id = p_count_id ORDER BY product_id FOR UPDATE LOOP
    v_delta := v_item.counted_qty - v_item.expected_qty;
    IF v_delta <> 0 THEN
      UPDATE public.products SET stock_qty = v_item.counted_qty WHERE id = v_item.product_id;
      INSERT INTO public.stock_movements(product_id, delta, reason, actor_id, count_id)
      VALUES(v_item.product_id, v_delta, 'stock_count_adjustment', v_actor, p_count_id);
    END IF;
  END LOOP;
  UPDATE public.inventory_counts SET status = 'completed', completed_by = v_actor, completed_at = now() WHERE id = p_count_id;
  INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, meta)
  VALUES(v_actor, 'inventory_count_completed', 'inventory_counts', p_count_id,
    jsonb_build_object('adjusted_products', (SELECT count(*) FROM public.inventory_count_items WHERE count_id = p_count_id AND counted_qty <> expected_qty)));
  PERFORM set_config('app.inventory_count_apply', 'off', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_inventory_count(p_count_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]) THEN RAISE EXCEPTION 'An active manager or owner account is required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(731904, 1);
  UPDATE public.inventory_counts SET status = 'cancelled', completed_by = v_actor, completed_at = now()
  WHERE id = p_count_id AND status = 'in_progress';
  IF NOT FOUND THEN RAISE EXCEPTION 'Active stock count not found'; END IF;
  INSERT INTO public.audit_logs(user_id, action, entity_type, entity_id, meta)
  VALUES(v_actor, 'inventory_count_cancelled', 'inventory_counts', p_count_id, '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.save_held_sale(p_shift_id uuid, p_label text, p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_actor uuid := auth.uid(); v_hold uuid := gen_random_uuid(); v_product_id uuid; v_qty integer; v_product public.products%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT public.has_role('cashier') THEN RAISE EXCEPTION 'An active cashier account is required'; END IF;
  IF p_label IS NOT NULL AND length(trim(p_label)) > 80 THEN RAISE EXCEPTION 'Hold label must be 80 characters or fewer'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'A held cart must contain 1 to 100 items'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) x(value) WHERE jsonb_typeof(x.value) <> 'object' OR x.value->>'product_id' IS NULL OR x.value->>'qty' IS NULL)
    OR (SELECT count(*) <> count(DISTINCT (x.value->>'product_id')::uuid) FROM jsonb_array_elements(p_items) x(value)) THEN RAISE EXCEPTION 'Held cart items are invalid or duplicated'; END IF;
  PERFORM 1 FROM public.shifts WHERE id = p_shift_id AND user_id = v_actor AND closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'An open cashier shift is required'; END IF;
  INSERT INTO public.held_sales(id, cashier_id, shift_id, label) VALUES(v_hold, v_actor, p_shift_id, nullif(trim(p_label), ''));
  FOR v_product_id, v_qty IN SELECT (x.value->>'product_id')::uuid, (x.value->>'qty')::integer FROM jsonb_array_elements(p_items) x(value) ORDER BY 1 LOOP
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Held item quantities must be positive'; END IF;
    SELECT * INTO v_product FROM public.products WHERE id = v_product_id AND active FOR SHARE;
    IF NOT FOUND OR v_qty > v_product.stock_qty THEN RAISE EXCEPTION 'A held product is unavailable or stock is insufficient'; END IF;
    INSERT INTO public.held_sale_items(held_sale_id, product_id, qty, unit_price_cents, tax_category)
    VALUES(v_hold, v_product.id, v_qty, v_product.price_cents, v_product.tax_category);
  END LOOP;
  RETURN v_hold;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_held_sale(p_held_sale_id uuid, p_label text, p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_actor uuid := auth.uid(); v_hold public.held_sales%ROWTYPE; v_product_id uuid; v_qty integer; v_product public.products%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT public.has_role('cashier') THEN RAISE EXCEPTION 'An active cashier account is required'; END IF;
  IF p_label IS NOT NULL AND length(trim(p_label)) > 80 THEN RAISE EXCEPTION 'Hold label must be 80 characters or fewer'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'A held cart must contain 1 to 100 items'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) x(value) WHERE jsonb_typeof(x.value) <> 'object' OR x.value->>'product_id' IS NULL OR x.value->>'qty' IS NULL)
    OR (SELECT count(*) <> count(DISTINCT (x.value->>'product_id')::uuid) FROM jsonb_array_elements(p_items) x(value)) THEN RAISE EXCEPTION 'Held cart items are invalid or duplicated'; END IF;
  SELECT * INTO v_hold FROM public.held_sales WHERE id = p_held_sale_id AND cashier_id = v_actor FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.shifts WHERE id = v_hold.shift_id AND user_id = v_actor AND closed_at IS NULL) THEN RAISE EXCEPTION 'Held cart and its open shift were not found'; END IF;
  DELETE FROM public.held_sale_items WHERE held_sale_id = p_held_sale_id;
  FOR v_product_id, v_qty IN SELECT (x.value->>'product_id')::uuid, (x.value->>'qty')::integer FROM jsonb_array_elements(p_items) x(value) ORDER BY 1 LOOP
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Held item quantities must be positive'; END IF;
    SELECT * INTO v_product FROM public.products WHERE id = v_product_id AND active FOR SHARE;
    IF NOT FOUND OR v_qty > v_product.stock_qty THEN RAISE EXCEPTION 'A held product is unavailable or stock is insufficient'; END IF;
    INSERT INTO public.held_sale_items(held_sale_id, product_id, qty, unit_price_cents, tax_category)
    VALUES(p_held_sale_id, v_product.id, v_qty, v_product.price_cents, v_product.tax_category);
  END LOOP;
  UPDATE public.held_sales SET label = nullif(trim(p_label), '') WHERE id = p_held_sale_id;
  RETURN p_held_sale_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_held_sale(p_held_sale_id uuid, p_items jsonb, p_payments jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_actor uuid := auth.uid(); v_hold public.held_sales%ROWTYPE; v_items jsonb; v_item jsonb; v_product public.products%ROWTYPE; v_sale_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.has_role('cashier') THEN RAISE EXCEPTION 'An active cashier account is required'; END IF;
  SELECT * INTO v_hold FROM public.held_sales WHERE id = p_held_sale_id AND cashier_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Held sale not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shifts WHERE id = v_hold.shift_id AND user_id = v_actor AND closed_at IS NULL) THEN RAISE EXCEPTION 'An open cashier shift is required'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'A resumed cart must contain 1 to 100 items'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) x(value) WHERE jsonb_typeof(x.value) <> 'object' OR x.value->>'product_id' IS NULL OR x.value->>'qty' IS NULL)
    OR (SELECT count(*) <> count(DISTINCT (x.value->>'product_id')::uuid) FROM jsonb_array_elements(p_items) x(value)) THEN RAISE EXCEPTION 'Resumed cart items are invalid or duplicated'; END IF;
  v_items := p_items;
  IF NOT EXISTS (SELECT 1 FROM public.held_sale_items WHERE held_sale_id = p_held_sale_id) THEN RAISE EXCEPTION 'Held sale has no items'; END IF;
  DELETE FROM public.held_sale_items WHERE held_sale_id = p_held_sale_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) AS x(value) LOOP
    SELECT * INTO v_product FROM public.products WHERE id = (v_item->>'product_id')::uuid AND active FOR SHARE;
    IF NOT FOUND OR (v_item->>'qty')::integer <= 0 THEN RAISE EXCEPTION 'A resumed cart product is unavailable or has an invalid quantity'; END IF;
    INSERT INTO public.held_sale_items(held_sale_id, product_id, qty, unit_price_cents, tax_category)
    VALUES(p_held_sale_id, v_product.id, (v_item->>'qty')::integer, v_product.price_cents, v_product.tax_category);
  END LOOP;
  v_sale_id := public.complete_sale(v_hold.shift_id, v_items, p_payments);
  DELETE FROM public.held_sales WHERE id = p_held_sale_id;
  RETURN v_sale_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_checkout_paused()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
  SELECT public.has_any_role(ARRAY['cashier'::public.app_role, 'manager'::public.app_role, 'owner'::public.app_role])
    AND EXISTS (SELECT 1 FROM public.inventory_counts WHERE status = 'in_progress')
$$;

CREATE OR REPLACE FUNCTION public.sales_report(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET row_security = off AS $$
DECLARE v_from timestamptz; v_to timestamptz; v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]) THEN RAISE EXCEPTION 'An active manager or owner account is required'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 364 THEN RAISE EXCEPTION 'Choose a date range of up to 365 days'; END IF;
  v_from := p_from::timestamp AT TIME ZONE 'Africa/Johannesburg';
  v_to := (p_to + 1)::timestamp AT TIME ZONE 'Africa/Johannesburg';
  WITH scoped_sales AS (
    SELECT s.* FROM public.sales s WHERE s.created_at >= v_from AND s.created_at < v_to AND s.status <> 'voided'
  ), refunds AS (
    SELECT r.sale_id, sum(r.total_cents)::bigint AS total_cents, sum(r.vat_cents)::bigint AS vat_cents
    FROM public.refunds r JOIN scoped_sales s ON s.id = r.sale_id GROUP BY r.sale_id
  ), payments AS (
    SELECT p.method, sum(p.amount_cents)::bigint AS cents FROM public.payments p JOIN scoped_sales s ON s.id = p.sale_id GROUP BY p.method
  ), refund_methods AS (
    SELECT rp.method, sum(rp.amount_cents)::bigint AS cents FROM public.refund_payments rp JOIN public.refunds r ON r.id = rp.refund_id JOIN scoped_sales s ON s.id = r.sale_id GROUP BY rp.method
  ), all_methods AS (
    SELECT method FROM payments UNION SELECT method FROM refund_methods
  ), cashiers AS (
    SELECT s.cashier_id, coalesce(p.name, p.email, 'Staff member') AS name, count(*)::bigint AS sales_count,
      sum(s.total_cents)::bigint AS gross_cents, sum(coalesce(r.total_cents, 0))::bigint AS refunds_cents
    FROM scoped_sales s JOIN public.profiles p ON p.id = s.cashier_id LEFT JOIN refunds r ON r.sale_id = s.id
    GROUP BY s.cashier_id, p.name, p.email
  ), daily AS (
    SELECT (s.created_at AT TIME ZONE 'Africa/Johannesburg')::date AS day,
      sum(s.total_cents)::bigint AS gross_cents, sum(coalesce(r.total_cents, 0))::bigint AS refunds_cents
    FROM scoped_sales s LEFT JOIN refunds r ON r.sale_id = s.id
    GROUP BY (s.created_at AT TIME ZONE 'Africa/Johannesburg')::date
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'summary', jsonb_build_object(
      'sale_count', (SELECT count(*) FROM scoped_sales),
      'gross_sales_cents', coalesce((SELECT sum(total_cents) FROM scoped_sales), 0),
      'refunds_cents', coalesce((SELECT sum(total_cents) FROM refunds), 0),
      'net_sales_cents', coalesce((SELECT sum(total_cents) FROM scoped_sales), 0) - coalesce((SELECT sum(total_cents) FROM refunds), 0),
      'vat_cents', coalesce((SELECT sum(vat_cents) FROM scoped_sales), 0) - coalesce((SELECT sum(vat_cents) FROM refunds), 0)
    ),
    'payments', coalesce((SELECT jsonb_agg(jsonb_build_object('method', m.method, 'sales_cents', coalesce(p.cents, 0), 'refunds_cents', coalesce(r.cents, 0)) ORDER BY m.method) FROM all_methods m LEFT JOIN payments p ON p.method = m.method LEFT JOIN refund_methods r ON r.method = m.method), '[]'::jsonb),
    'cashiers', coalesce((SELECT jsonb_agg(jsonb_build_object('cashier_id', c.cashier_id, 'name', c.name, 'sales_count', c.sales_count, 'gross_cents', c.gross_cents, 'refunds_cents', c.refunds_cents) ORDER BY c.name) FROM cashiers c), '[]'::jsonb),
    'daily', coalesce((SELECT jsonb_agg(jsonb_build_object('day', d.day, 'gross_cents', d.gross_cents, 'refunds_cents', d.refunds_cents) ORDER BY d.day) FROM daily d), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- Product data is available to store staff only. Dev support accounts cannot read price or stock rows.
DROP POLICY IF EXISTS products_read_active_users ON public.products;
CREATE POLICY products_read_active_users ON public.products FOR SELECT TO authenticated
USING (public.has_any_role(ARRAY['cashier'::public.app_role, 'manager'::public.app_role, 'owner'::public.app_role]));

INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES('product-images', 'product-images', true, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 2097152, allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'];
CREATE POLICY product_images_manager_upload ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'product-images' AND public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]));
CREATE POLICY product_images_manager_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'product-images' AND public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]))
WITH CHECK (bucket_id = 'product-images' AND public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]));
CREATE POLICY product_images_manager_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'product-images' AND public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]));

REVOKE ALL ON FUNCTION public.receive_inventory_delivery(text,date,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_inventory_count() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_inventory_count(uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_inventory_count(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_held_sale(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_held_sale(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_held_sale(uuid,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_checkout_paused() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sales_report(date,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_inventory_delivery(text,date,text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_inventory_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_inventory_count(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_inventory_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_held_sale(uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_held_sale(uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_held_sale(uuid,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_checkout_paused() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_report(date,date) TO authenticated;

COMMIT;
