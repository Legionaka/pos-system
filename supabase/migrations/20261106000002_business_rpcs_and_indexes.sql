BEGIN;

CREATE INDEX products_category_id_idx ON public.products (category_id);
CREATE INDEX products_active_name_idx ON public.products (active, name);
CREATE INDEX shifts_user_opened_idx ON public.shifts (user_id, opened_at DESC);
CREATE INDEX held_sales_cashier_created_idx ON public.held_sales (cashier_id, created_at DESC);
CREATE INDEX held_sales_shift_id_idx ON public.held_sales (shift_id);
CREATE INDEX held_sale_items_held_sale_id_idx ON public.held_sale_items (held_sale_id);
CREATE INDEX held_sale_items_product_id_idx ON public.held_sale_items (product_id);
CREATE INDEX sales_cashier_created_idx ON public.sales (cashier_id, created_at DESC);
CREATE INDEX sales_shift_created_idx ON public.sales (shift_id, created_at DESC);
CREATE INDEX sales_created_idx ON public.sales (created_at DESC);
CREATE INDEX sale_items_sale_id_idx ON public.sale_items (sale_id);
CREATE INDEX sale_items_product_id_idx ON public.sale_items (product_id);
CREATE INDEX payments_sale_id_idx ON public.payments (sale_id);
CREATE INDEX refunds_sale_id_idx ON public.refunds (sale_id, created_at DESC);
CREATE INDEX refunds_approved_by_created_idx ON public.refunds (approved_by, created_at DESC);
CREATE INDEX refund_items_refund_id_idx ON public.refund_items (refund_id);
CREATE INDEX refund_items_sale_item_id_idx ON public.refund_items (sale_item_id);
CREATE INDEX refund_payments_refund_id_idx ON public.refund_payments (refund_id);
CREATE INDEX stock_movements_product_created_idx ON public.stock_movements (product_id, created_at DESC);
CREATE INDEX stock_movements_sale_id_idx ON public.stock_movements (sale_id);
CREATE INDEX stock_movements_refund_id_idx ON public.stock_movements (refund_id);
CREATE INDEX stock_movements_actor_created_idx ON public.stock_movements (actor_id, created_at DESC);
CREATE INDEX audit_logs_created_idx ON public.audit_logs (created_at DESC);
CREATE INDEX audit_logs_user_created_idx ON public.audit_logs (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.open_shift(p_opening_cash_cents bigint)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_shift_id uuid;
BEGIN
    IF v_actor_id IS NULL OR NOT public.has_role('cashier') THEN
        RAISE EXCEPTION 'An active cashier account is required';
    END IF;
    IF p_opening_cash_cents IS NULL OR p_opening_cash_cents < 0 THEN
        RAISE EXCEPTION 'Opening cash must be zero or greater';
    END IF;

    INSERT INTO public.shifts (user_id, opening_cash_cents)
    VALUES (v_actor_id, p_opening_cash_cents)
    RETURNING id INTO v_shift_id;

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, meta)
    VALUES (v_actor_id, 'shift_opened', 'shifts', v_shift_id, '{}'::jsonb);

    RETURN v_shift_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_shift(
    p_shift_id uuid,
    p_counted_cash_cents bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_shift public.shifts%ROWTYPE;
    v_expected_cash bigint;
    v_variance bigint;
BEGIN
    IF v_actor_id IS NULL OR NOT public.has_any_role(ARRAY['cashier'::public.app_role, 'manager'::public.app_role, 'owner'::public.app_role]) THEN
        RAISE EXCEPTION 'An active cashier, manager, or owner account is required';
    END IF;
    IF p_counted_cash_cents IS NULL OR p_counted_cash_cents < 0 THEN
        RAISE EXCEPTION 'Counted cash must be zero or greater';
    END IF;

    SELECT * INTO v_shift
    FROM public.shifts
    WHERE id = p_shift_id
    FOR UPDATE;

    IF NOT FOUND OR v_shift.closed_at IS NOT NULL THEN
        RAISE EXCEPTION 'Open shift not found';
    END IF;
    IF v_shift.user_id <> v_actor_id AND NOT public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]) THEN
        RAISE EXCEPTION 'You may only close your own shift';
    END IF;

    SELECT
        v_shift.opening_cash_cents
        + COALESCE((
            SELECT sum(p.amount_cents)
            FROM public.sales AS s
            JOIN public.payments AS p ON p.sale_id = s.id
            WHERE s.shift_id = p_shift_id
              AND s.status <> 'voided'
              AND p.method = 'cash'
        ), 0)
        - COALESCE((
            SELECT sum(rp.amount_cents)
            FROM public.sales AS s
            JOIN public.refunds AS r ON r.sale_id = s.id
            JOIN public.refund_payments AS rp ON rp.refund_id = r.id
            WHERE s.shift_id = p_shift_id
              AND rp.method = 'cash'
        ), 0)
    INTO v_expected_cash;

    IF v_expected_cash < 0 THEN
        RAISE EXCEPTION 'Calculated expected cash cannot be negative';
    END IF;

    v_variance := p_counted_cash_cents - v_expected_cash;

    UPDATE public.shifts
    SET closed_at = now(),
        expected_cash_cents = v_expected_cash,
        counted_cash_cents = p_counted_cash_cents,
        cash_variance_cents = v_variance
    WHERE id = p_shift_id;

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, meta)
    VALUES (v_actor_id, 'shift_closed', 'shifts', p_shift_id, '{}'::jsonb);

    RETURN jsonb_build_object(
        'expected_cash_cents', v_expected_cash,
        'counted_cash_cents', p_counted_cash_cents,
        'cash_variance_cents', v_variance
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_sale(
    p_shift_id uuid,
    p_items jsonb,
    p_payments jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_shift public.shifts%ROWTYPE;
    v_sale_id uuid := gen_random_uuid();
    v_product_id uuid;
    v_requested_qty bigint;
    v_stock_qty integer;
    v_line jsonb;
    v_payment jsonb;
    v_product public.products%ROWTYPE;
    v_qty integer;
    v_discount bigint;
    v_line_gross bigint;
    v_line_net bigint;
    v_line_vat bigint;
    v_subtotal bigint := 0;
    v_discount_total bigint := 0;
    v_vat_total bigint := 0;
    v_total_before_rounding bigint;
    v_rounding integer := 0;
    v_total bigint;
    v_payment_total bigint := 0;
    v_payment_amount bigint;
    v_cash_received bigint := 0;
    v_change bigint := 0;
    v_method public.payment_method;
    v_reference text;
    v_line_count integer := 0;
    v_payment_count integer := 0;
    v_has_cash boolean := false;
BEGIN
    IF v_actor_id IS NULL OR NOT public.has_role('cashier') THEN
        RAISE EXCEPTION 'An active cashier account is required';
    END IF;
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'p_items must be a non-empty JSON array';
    END IF;
    IF jsonb_typeof(p_payments) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'p_payments must be a JSON array';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_items) AS items(value)
        WHERE jsonb_typeof(items.value) <> 'object'
           OR items.value->>'product_id' IS NULL
           OR items.value->>'qty' IS NULL
    ) THEN
        RAISE EXCEPTION 'Every item requires product_id and qty';
    END IF;

    SELECT * INTO v_shift
    FROM public.shifts
    WHERE id = p_shift_id
      AND user_id = v_actor_id
      AND closed_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'An open shift owned by the cashier is required';
    END IF;

    -- Lock products in a stable order, then validate aggregate quantities so
    -- duplicate entries cannot bypass the stock check or race another sale.
    FOR v_product_id IN
        SELECT DISTINCT (items.value->>'product_id')::uuid
        FROM jsonb_array_elements(p_items) AS items(value)
        ORDER BY 1
    LOOP
        SELECT * INTO v_product
        FROM public.products
        WHERE id = v_product_id
        FOR UPDATE;
        IF NOT FOUND OR NOT v_product.active THEN
            RAISE EXCEPTION 'Product % not found or inactive', v_product_id;
        END IF;
    END LOOP;

    FOR v_product_id, v_requested_qty IN
        SELECT (items.value->>'product_id')::uuid,
               sum((items.value->>'qty')::bigint)
        FROM jsonb_array_elements(p_items) AS items(value)
        GROUP BY (items.value->>'product_id')::uuid
        ORDER BY 1
    LOOP
        IF v_requested_qty <= 0 OR v_requested_qty > 2147483647 THEN
            RAISE EXCEPTION 'Item quantity must be a positive integer';
        END IF;
        SELECT stock_qty INTO v_stock_qty
        FROM public.products
        WHERE id = v_product_id;
        IF v_requested_qty > v_stock_qty THEN
            RAISE EXCEPTION 'Insufficient stock for product %', v_product_id;
        END IF;
    END LOOP;

    FOR v_line IN SELECT value FROM jsonb_array_elements(p_items) AS items(value)
    LOOP
        v_line_count := v_line_count + 1;
        v_product_id := (v_line->>'product_id')::uuid;
        v_qty := (v_line->>'qty')::integer;
        v_discount := COALESCE((v_line->>'discount_cents')::bigint, 0);
        IF v_qty <= 0 OR v_discount < 0 THEN
            RAISE EXCEPTION 'Item quantity must be positive and discount cannot be negative';
        END IF;

        SELECT * INTO v_product
        FROM public.products
        WHERE id = v_product_id;

        v_line_gross := v_product.price_cents * v_qty;
        IF v_discount > v_line_gross THEN
            RAISE EXCEPTION 'Line discount exceeds the line price for product %', v_product_id;
        END IF;
        v_line_net := v_line_gross - v_discount;
        v_line_vat := CASE
            WHEN v_product.tax_category = 'standard'
                THEN round(v_line_net::numeric * 15 / 115)::bigint
            ELSE 0
        END;

        v_subtotal := v_subtotal + v_line_gross;
        v_discount_total := v_discount_total + v_discount;
        v_vat_total := v_vat_total + v_line_vat;

    END LOOP;

    IF v_line_count = 0 THEN
        RAISE EXCEPTION 'Sale must contain at least one item';
    END IF;

    v_total_before_rounding := v_subtotal - v_discount_total;

    FOR v_payment IN SELECT value FROM jsonb_array_elements(p_payments) AS payments(value)
    LOOP
        v_payment_count := v_payment_count + 1;
        IF jsonb_typeof(v_payment) <> 'object'
           OR v_payment->>'method' IS NULL
           OR v_payment->>'amount_cents' IS NULL THEN
            RAISE EXCEPTION 'Every payment requires method and amount_cents';
        END IF;
        v_method := (v_payment->>'method')::public.payment_method;
        v_payment_amount := (v_payment->>'amount_cents')::bigint;
        v_reference := v_payment->>'reference';
        IF v_payment_amount <= 0 THEN
            RAISE EXCEPTION 'Payment amount must be greater than zero';
        END IF;
        v_payment_total := v_payment_total + v_payment_amount;

        IF v_method = 'cash' THEN
            v_has_cash := true;
            IF v_payment->>'received_cents' IS NULL THEN
                RAISE EXCEPTION 'Cash payments require received_cents';
            END IF;
            IF (v_payment->>'received_cents')::bigint < v_payment_amount THEN
                RAISE EXCEPTION 'Cash received cannot be less than the amount applied';
            END IF;
            v_cash_received := v_cash_received + (v_payment->>'received_cents')::bigint;
            v_change := v_change + ((v_payment->>'received_cents')::bigint - v_payment_amount);
        ELSIF v_payment->>'received_cents' IS NOT NULL THEN
            RAISE EXCEPTION 'received_cents is only valid for cash payments';
        END IF;
    END LOOP;

    IF v_has_cash THEN
        v_rounding := (round(v_total_before_rounding::numeric / 5)::bigint * 5 - v_total_before_rounding)::integer;
    END IF;
    v_total := v_total_before_rounding + v_rounding;

    IF v_payment_total <> v_total THEN
        RAISE EXCEPTION 'Applied payment total (%) must equal sale total (%)', v_payment_total, v_total;
    END IF;
    IF v_total > 0 AND v_payment_count = 0 THEN
        RAISE EXCEPTION 'A positive sale total requires at least one payment';
    END IF;

    INSERT INTO public.sales (
        id, cashier_id, shift_id, status, subtotal_cents, vat_cents,
        discount_cents, rounding_cents, total_cents,
        cash_received_cents, change_cents
    )
    VALUES (
        v_sale_id, v_actor_id, p_shift_id, 'completed', v_subtotal,
        v_vat_total, v_discount_total, v_rounding, v_total,
        v_cash_received, v_change
    );

    FOR v_line IN SELECT value FROM jsonb_array_elements(p_items) AS items(value)
    LOOP
        v_product_id := (v_line->>'product_id')::uuid;
        v_qty := (v_line->>'qty')::integer;
        v_discount := COALESCE((v_line->>'discount_cents')::bigint, 0);

        SELECT * INTO v_product
        FROM public.products
        WHERE id = v_product_id;
        v_line_gross := v_product.price_cents * v_qty;
        v_line_net := v_line_gross - v_discount;
        v_line_vat := CASE
            WHEN v_product.tax_category = 'standard'
                THEN round(v_line_net::numeric * 15 / 115)::bigint
            ELSE 0
        END;

        INSERT INTO public.sale_items (
            sale_id, product_id, product_name, sku, qty, unit_price_cents,
            discount_cents, line_total_cents, tax_category, vat_cents
        )
        VALUES (
            v_sale_id, v_product.id, v_product.name, v_product.sku, v_qty,
            v_product.price_cents, v_discount, v_line_net,
            v_product.tax_category, v_line_vat
        );

        UPDATE public.products
        SET stock_qty = stock_qty - v_qty
        WHERE id = v_product.id;

        INSERT INTO public.stock_movements (product_id, delta, reason, actor_id, sale_id)
        VALUES (v_product.id, -v_qty, 'sale_completed', v_actor_id, v_sale_id);
    END LOOP;

    FOR v_payment IN SELECT value FROM jsonb_array_elements(p_payments) AS payments(value)
    LOOP
        v_method := (v_payment->>'method')::public.payment_method;
        v_payment_amount := (v_payment->>'amount_cents')::bigint;
        INSERT INTO public.payments (
            sale_id, method, amount_cents, received_cents, change_cents, reference
        )
        VALUES (
            v_sale_id,
            v_method,
            v_payment_amount,
            CASE WHEN v_method = 'cash' THEN (v_payment->>'received_cents')::bigint ELSE NULL END,
            CASE WHEN v_method = 'cash' THEN (v_payment->>'received_cents')::bigint - v_payment_amount ELSE NULL END,
            v_payment->>'reference'
        );
    END LOOP;

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, meta)
    VALUES (
        v_actor_id,
        'sale_completed',
        'sales',
        v_sale_id,
        jsonb_build_object('shift_id', p_shift_id, 'line_count', v_line_count)
    );

    RETURN v_sale_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.process_refund(
    p_sale_id uuid,
    p_reason text,
    p_items jsonb,
    p_payments jsonb,
    p_rounding_cents integer,
    p_is_void boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_sale public.sales%ROWTYPE;
    v_refund_id uuid := gen_random_uuid();
    v_line jsonb;
    v_payment jsonb;
    v_item_id uuid;
    v_qty integer;
    v_restock boolean;
    v_sale_item public.sale_items%ROWTYPE;
    v_refunded_qty integer;
    v_refunded_amount bigint;
    v_refunded_vat bigint;
    v_remaining_qty integer;
    v_remaining_amount bigint;
    v_remaining_vat bigint;
    v_amount bigint;
    v_vat bigint;
    v_refund_total bigint := 0;
    v_refund_vat bigint := 0;
    v_payment_total bigint := 0;
    v_payment_amount bigint;
    v_method public.payment_method;
    v_product_id uuid;
    v_stock_qty integer;
    v_item_count integer := 0;
    v_payment_count integer := 0;
    v_merchandise_total bigint;
    v_refunded_total bigint;
    v_existing_refunded_total bigint;
    v_rounding_adjustment integer := 0;
    v_unreturned_lines bigint;
BEGIN
    IF v_actor_id IS NULL OR NOT public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]) THEN
        RAISE EXCEPTION 'An active manager or owner account is required';
    END IF;
    IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'A refund reason is required';
    END IF;
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'p_items must be a non-empty JSON array';
    END IF;
    IF jsonb_typeof(p_payments) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'p_payments must be a JSON array';
    END IF;
    IF p_rounding_cents NOT BETWEEN -2 AND 2 THEN
        RAISE EXCEPTION 'Refund rounding adjustment is outside the supported cash-rounding range';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_items) AS items(value)
        WHERE jsonb_typeof(items.value) <> 'object'
           OR items.value->>'sale_item_id' IS NULL
           OR items.value->>'qty' IS NULL
    ) THEN
        RAISE EXCEPTION 'Every refund item requires sale_item_id and qty';
    END IF;
    IF (
        SELECT count(*) <> count(DISTINCT (items.value->>'sale_item_id')::uuid)
        FROM jsonb_array_elements(p_items) AS items(value)
    ) THEN
        RAISE EXCEPTION 'A sale item may only appear once in a refund request';
    END IF;

    SELECT * INTO v_sale
    FROM public.sales
    WHERE id = p_sale_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sale not found';
    END IF;
    IF p_is_void THEN
        IF v_sale.status <> 'completed'
           OR EXISTS (SELECT 1 FROM public.refunds WHERE sale_id = p_sale_id) THEN
            RAISE EXCEPTION 'Only a sale with no prior refunds can be voided';
        END IF;
        IF p_rounding_cents <> v_sale.rounding_cents THEN
            RAISE EXCEPTION 'Void refund must reverse the original cash rounding';
        END IF;
    ELSIF v_sale.status IN ('voided', 'refunded') THEN
        RAISE EXCEPTION 'Sale cannot be refunded in its current status';
    ELSIF p_rounding_cents <> 0 THEN
        RAISE EXCEPTION 'Partial refunds do not apply cash rounding';
    END IF;

    -- Lock every affected product in a stable order before a restock update.
    FOR v_product_id IN
        SELECT DISTINCT si.product_id
        FROM jsonb_array_elements(p_items) AS items(value)
        JOIN public.sale_items AS si ON si.id = (items.value->>'sale_item_id')::uuid
        WHERE si.sale_id = p_sale_id
          AND COALESCE((items.value->>'restock')::boolean, false)
        ORDER BY si.product_id
    LOOP
        PERFORM 1
        FROM public.products
        WHERE id = v_product_id
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product required for restocking no longer exists';
        END IF;
    END LOOP;

    -- Validate and calculate line refunds from immutable sale snapshots.
    FOR v_line IN SELECT value FROM jsonb_array_elements(p_items) AS items(value)
    LOOP
        v_item_count := v_item_count + 1;
        v_item_id := (v_line->>'sale_item_id')::uuid;
        v_qty := (v_line->>'qty')::integer;
        v_restock := COALESCE((v_line->>'restock')::boolean, false);
        IF v_qty <= 0 THEN
            RAISE EXCEPTION 'Refund quantity must be positive';
        END IF;

        SELECT * INTO v_sale_item
        FROM public.sale_items
        WHERE id = v_item_id
          AND sale_id = p_sale_id
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Refund item does not belong to the selected sale';
        END IF;

        SELECT COALESCE(sum(ri.qty), 0),
               COALESCE(sum(ri.amount_cents), 0),
               COALESCE(sum(ri.vat_cents), 0)
        INTO v_refunded_qty, v_refunded_amount, v_refunded_vat
        FROM public.refund_items AS ri
        JOIN public.refunds AS r ON r.id = ri.refund_id
        WHERE ri.sale_item_id = v_item_id
          AND r.sale_id = p_sale_id;

        v_remaining_qty := v_sale_item.qty - v_refunded_qty;
        v_remaining_amount := v_sale_item.line_total_cents - v_refunded_amount;
        v_remaining_vat := v_sale_item.vat_cents - v_refunded_vat;
        IF v_qty > v_remaining_qty THEN
            RAISE EXCEPTION 'Refund quantity exceeds the remaining quantity on the original sale line';
        END IF;

        IF v_qty = v_remaining_qty THEN
            v_amount := v_remaining_amount;
            v_vat := v_remaining_vat;
        ELSE
            v_amount := round(v_sale_item.line_total_cents::numeric * v_qty / v_sale_item.qty)::bigint;
            v_vat := round(v_sale_item.vat_cents::numeric * v_qty / v_sale_item.qty)::bigint;
        END IF;
        IF v_amount > v_remaining_amount OR v_vat > v_remaining_vat THEN
            RAISE EXCEPTION 'Calculated refund exceeds the remaining sale line value';
        END IF;

        v_refund_total := v_refund_total + v_amount;
        v_refund_vat := v_refund_vat + v_vat;
    END LOOP;

    IF p_is_void THEN
        v_rounding_adjustment := p_rounding_cents;
    ELSE
        SELECT count(*)
        INTO v_unreturned_lines
        FROM public.sale_items AS si
        LEFT JOIN (
            SELECT ri.sale_item_id, sum(ri.qty)::integer AS qty
            FROM public.refund_items AS ri
            JOIN public.refunds AS r ON r.id = ri.refund_id
            WHERE r.sale_id = p_sale_id
            GROUP BY ri.sale_item_id
        ) AS prior ON prior.sale_item_id = si.id
        LEFT JOIN (
            SELECT (items.value->>'sale_item_id')::uuid AS sale_item_id,
                   (items.value->>'qty')::integer AS qty
            FROM jsonb_array_elements(p_items) AS items(value)
        ) AS requested ON requested.sale_item_id = si.id
        WHERE si.sale_id = p_sale_id
          AND COALESCE(prior.qty, 0) + COALESCE(requested.qty, 0) < si.qty;

        IF v_unreturned_lines = 0 THEN
            SELECT v_sale.rounding_cents - COALESCE(sum(r.rounding_cents), 0)
            INTO v_rounding_adjustment
            FROM public.refunds AS r
            WHERE r.sale_id = p_sale_id;
        END IF;
    END IF;

    v_refund_total := v_refund_total + v_rounding_adjustment;
    IF v_refund_total < 0 THEN
        RAISE EXCEPTION 'Calculated refund cannot be negative';
    END IF;

    SELECT COALESCE(sum(r.total_cents), 0)
    INTO v_existing_refunded_total
    FROM public.refunds AS r
    WHERE r.sale_id = p_sale_id;
    IF v_existing_refunded_total + v_refund_total > v_sale.total_cents THEN
        RAISE EXCEPTION 'Cumulative refunds cannot exceed the amount paid for the sale';
    END IF;

    FOR v_payment IN SELECT value FROM jsonb_array_elements(p_payments) AS payments(value)
    LOOP
        v_payment_count := v_payment_count + 1;
        IF jsonb_typeof(v_payment) <> 'object'
           OR v_payment->>'method' IS NULL
           OR v_payment->>'amount_cents' IS NULL THEN
            RAISE EXCEPTION 'Every refund payment requires method and amount_cents';
        END IF;
        v_method := (v_payment->>'method')::public.payment_method;
        v_payment_amount := (v_payment->>'amount_cents')::bigint;
        IF v_payment_amount <= 0 THEN
            RAISE EXCEPTION 'Refund payment amount must be greater than zero';
        END IF;
        v_payment_total := v_payment_total + v_payment_amount;
    END LOOP;
    IF v_payment_total <> v_refund_total THEN
        RAISE EXCEPTION 'Refund payouts (%) must equal calculated refund total (%)', v_payment_total, v_refund_total;
    END IF;
    IF v_refund_total > 0 AND v_payment_count = 0 THEN
        RAISE EXCEPTION 'A positive refund requires at least one payout';
    END IF;

    INSERT INTO public.refunds (
        id, sale_id, approved_by, reason, total_cents, vat_cents, rounding_cents
    )
    VALUES (
        v_refund_id, p_sale_id, v_actor_id, trim(p_reason),
        v_refund_total, v_refund_vat, v_rounding_adjustment
    );

    FOR v_line IN SELECT value FROM jsonb_array_elements(p_items) AS items(value)
    LOOP
        v_item_id := (v_line->>'sale_item_id')::uuid;
        v_qty := (v_line->>'qty')::integer;
        v_restock := COALESCE((v_line->>'restock')::boolean, false);

        SELECT * INTO v_sale_item
        FROM public.sale_items
        WHERE id = v_item_id AND sale_id = p_sale_id;

        SELECT COALESCE(sum(ri.qty), 0),
               COALESCE(sum(ri.amount_cents), 0),
               COALESCE(sum(ri.vat_cents), 0)
        INTO v_refunded_qty, v_refunded_amount, v_refunded_vat
        FROM public.refund_items AS ri
        JOIN public.refunds AS r ON r.id = ri.refund_id
        WHERE ri.sale_item_id = v_item_id
          AND r.sale_id = p_sale_id;

        v_remaining_qty := v_sale_item.qty - v_refunded_qty;
        v_remaining_amount := v_sale_item.line_total_cents - v_refunded_amount;
        v_remaining_vat := v_sale_item.vat_cents - v_refunded_vat;
        IF v_qty = v_remaining_qty THEN
            v_amount := v_remaining_amount;
            v_vat := v_remaining_vat;
        ELSE
            v_amount := round(v_sale_item.line_total_cents::numeric * v_qty / v_sale_item.qty)::bigint;
            v_vat := round(v_sale_item.vat_cents::numeric * v_qty / v_sale_item.qty)::bigint;
        END IF;

        INSERT INTO public.refund_items (refund_id, sale_item_id, qty, amount_cents, vat_cents, restock)
        VALUES (v_refund_id, v_item_id, v_qty, v_amount, v_vat, v_restock);

        IF v_restock THEN
            UPDATE public.products
            SET stock_qty = stock_qty + v_qty
            WHERE id = v_sale_item.product_id
            RETURNING stock_qty INTO v_stock_qty;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Product required for restocking no longer exists';
            END IF;
            INSERT INTO public.stock_movements (product_id, delta, reason, actor_id, sale_id, refund_id)
            VALUES (
                v_sale_item.product_id,
                v_qty,
                CASE WHEN p_is_void THEN 'sale_voided' ELSE 'refund_restock' END,
                v_actor_id,
                p_sale_id,
                v_refund_id
            );
        END IF;
    END LOOP;

    FOR v_payment IN SELECT value FROM jsonb_array_elements(p_payments) AS payments(value)
    LOOP
        INSERT INTO public.refund_payments (refund_id, method, amount_cents, reference)
        VALUES (
            v_refund_id,
            (v_payment->>'method')::public.payment_method,
            (v_payment->>'amount_cents')::bigint,
            v_payment->>'reference'
        );
    END LOOP;

    SELECT COALESCE(sum(si.line_total_cents), 0)
    INTO v_merchandise_total
    FROM public.sale_items AS si
    WHERE si.sale_id = p_sale_id;
    SELECT COALESCE(sum(r.total_cents - r.rounding_cents), 0)
    INTO v_refunded_total
    FROM public.refunds AS r
    WHERE r.sale_id = p_sale_id;

    UPDATE public.sales
    SET status = CASE
        WHEN p_is_void THEN 'voided'::public.sale_status
        WHEN v_refunded_total >= v_merchandise_total THEN 'refunded'::public.sale_status
        ELSE 'partially_refunded'::public.sale_status
    END
    WHERE id = p_sale_id;

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, meta)
    VALUES (
        v_actor_id,
        CASE WHEN p_is_void THEN 'sale_voided' ELSE 'refund_recorded' END,
        CASE WHEN p_is_void THEN 'sales' ELSE 'refunds' END,
        CASE WHEN p_is_void THEN p_sale_id ELSE v_refund_id END,
        jsonb_build_object('sale_id', p_sale_id)
    );

    RETURN v_refund_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_refund(
    p_sale_id uuid,
    p_reason text,
    p_items jsonb,
    p_payments jsonb
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
    SELECT private.process_refund(p_sale_id, p_reason, p_items, p_payments, 0, false)
$$;

CREATE OR REPLACE FUNCTION public.void_sale(
    p_sale_id uuid,
    p_payments jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
    v_sale public.sales%ROWTYPE;
    v_items jsonb;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]) THEN
        RAISE EXCEPTION 'An active manager or owner account is required';
    END IF;
    SELECT * INTO v_sale
    FROM public.sales
    WHERE id = p_sale_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sale not found';
    END IF;
    IF v_sale.status <> 'completed'
       OR EXISTS (SELECT 1 FROM public.refunds WHERE sale_id = p_sale_id) THEN
        RAISE EXCEPTION 'Only a completed sale with no prior refunds can be voided';
    END IF;

    SELECT jsonb_agg(jsonb_build_object('sale_item_id', si.id, 'qty', si.qty, 'restock', true) ORDER BY si.id)
    INTO v_items
    FROM public.sale_items AS si
    WHERE si.sale_id = p_sale_id;

    RETURN private.process_refund(
        p_sale_id,
        'Voided sale',
        COALESCE(v_items, '[]'::jsonb),
        p_payments,
        v_sale.rounding_cents,
        true
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_stock(
    p_product_id uuid,
    p_delta integer,
    p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_product public.products%ROWTYPE;
    v_movement_id uuid;
BEGIN
    IF v_actor_id IS NULL OR NOT public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]) THEN
        RAISE EXCEPTION 'An active manager or owner account is required';
    END IF;
    IF p_delta IS NULL OR p_delta = 0 OR p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'A non-zero adjustment and reason are required';
    END IF;

    SELECT * INTO v_product
    FROM public.products
    WHERE id = p_product_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found';
    END IF;
    IF v_product.stock_qty::bigint + p_delta < 0 OR v_product.stock_qty::bigint + p_delta > 2147483647 THEN
        RAISE EXCEPTION 'Stock adjustment would result in an invalid quantity';
    END IF;

    UPDATE public.products
    SET stock_qty = stock_qty + p_delta
    WHERE id = p_product_id;

    INSERT INTO public.stock_movements (product_id, delta, reason, actor_id)
    VALUES (p_product_id, p_delta, 'manual_adjustment', v_actor_id)
    RETURNING id INTO v_movement_id;

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, meta)
    VALUES (v_actor_id, 'stock_adjusted', 'products', p_product_id, jsonb_build_object('delta', p_delta));

    RETURN v_movement_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_profile_role(
    p_user_id uuid,
    p_role public.app_role,
    p_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_old_role public.app_role;
    v_old_active boolean;
BEGIN
    IF v_actor_id IS NULL OR NOT public.has_role('owner') THEN
        RAISE EXCEPTION 'An active owner account is required';
    END IF;
    IF p_user_id IS NULL OR p_role IS NULL OR p_active IS NULL THEN
        RAISE EXCEPTION 'User, role, and active status are required';
    END IF;

    SELECT role, active INTO v_old_role, v_old_active
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Profile not found';
    END IF;

    IF p_user_id = v_actor_id
       AND (p_role <> 'owner' OR NOT p_active)
       AND (SELECT count(*) FROM public.profiles WHERE role = 'owner' AND active) <= 1 THEN
        RAISE EXCEPTION 'The last active owner cannot remove or deactivate their own owner access';
    END IF;

    UPDATE public.profiles
    SET role = p_role, active = p_active
    WHERE id = p_user_id;

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, meta)
    VALUES (
        v_actor_id,
        'profile_role_changed',
        'profiles',
        p_user_id,
        jsonb_build_object(
            'old_role', v_old_role,
            'new_role', p_role,
            'old_active', v_old_active,
            'new_active', p_active
        )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_feature_flag(p_key text, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
BEGIN
    IF v_actor_id IS NULL OR NOT public.has_role('dev') THEN
        RAISE EXCEPTION 'An active dev account is required';
    END IF;
    IF p_key IS NULL OR length(trim(p_key)) = 0 OR p_enabled IS NULL THEN
        RAISE EXCEPTION 'Feature key and enabled state are required';
    END IF;

    INSERT INTO public.feature_flags (key, enabled, updated_by)
    VALUES (trim(p_key), p_enabled, v_actor_id)
    ON CONFLICT (key) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, meta)
    VALUES (v_actor_id, 'feature_flag_changed', 'feature_flags', NULL, jsonb_build_object('key', trim(p_key), 'enabled', p_enabled));
END;
$$;

REVOKE ALL ON FUNCTION public.open_shift(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.close_shift(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_sale(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.process_refund(uuid, text, jsonb, jsonb, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_refund(uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.void_sale(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.adjust_stock(uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_profile_role(uuid, public.app_role, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_feature_flag(text, boolean) FROM PUBLIC, anon, authenticated;

COMMIT;
