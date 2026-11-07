BEGIN;

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
    v_reason text := nullif(trim(p_reason), '');
BEGIN
    IF v_actor_id IS NULL OR NOT public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]) THEN
        RAISE EXCEPTION 'An active manager or owner account is required';
    END IF;
    IF p_delta IS NULL OR p_delta = 0 OR v_reason IS NULL OR length(v_reason) > 250 THEN
        RAISE EXCEPTION 'A non-zero adjustment and reason of at most 250 characters are required';
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
    VALUES (
        v_actor_id,
        'stock_adjusted',
        'products',
        p_product_id,
        jsonb_build_object('delta', p_delta, 'reason', v_reason)
    );

    RETURN v_movement_id;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_stock(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_stock(uuid, integer, text) TO authenticated;

COMMIT;
