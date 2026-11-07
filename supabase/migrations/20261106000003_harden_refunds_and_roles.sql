BEGIN;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.held_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.held_sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

-- Remove implicit/default API privileges, then grant only the operations used by the app.
REVOKE ALL ON TABLE
    public.profiles,
    public.categories,
    public.products,
    public.shifts,
    public.held_sales,
    public.held_sale_items,
    public.sales,
    public.sale_items,
    public.payments,
    public.refunds,
    public.refund_items,
    public.refund_payments,
    public.stock_movements,
    public.audit_logs,
    public.feature_flags
FROM anon, authenticated;

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (name) ON public.profiles TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT SELECT ON public.products TO authenticated;
GRANT INSERT (sku, barcode, name, price_cents, tax_category, reorder_at, active, category_id)
    ON public.products TO authenticated;
GRANT UPDATE (sku, barcode, name, price_cents, tax_category, reorder_at, active, category_id)
    ON public.products TO authenticated;

GRANT SELECT ON public.shifts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.held_sales TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.held_sale_items TO authenticated;
GRANT SELECT ON public.sales TO authenticated;
GRANT SELECT ON public.sale_items TO authenticated;
GRANT SELECT ON public.payments TO authenticated;
GRANT SELECT ON public.refunds TO authenticated;
GRANT SELECT ON public.refund_items TO authenticated;
GRANT SELECT ON public.refund_payments TO authenticated;
GRANT SELECT ON public.stock_movements TO authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT SELECT ON public.feature_flags TO authenticated;

CREATE POLICY profiles_select_self_or_privileged
ON public.profiles
FOR SELECT
TO authenticated
USING (
    auth.uid() = id
    OR public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role, 'dev'::public.app_role])
);

CREATE POLICY profiles_update_own_name
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id AND public.has_any_role(ARRAY['cashier'::public.app_role, 'manager'::public.app_role, 'owner'::public.app_role, 'dev'::public.app_role]))
WITH CHECK (auth.uid() = id AND public.has_any_role(ARRAY['cashier'::public.app_role, 'manager'::public.app_role, 'owner'::public.app_role, 'dev'::public.app_role]));

CREATE POLICY categories_read_active_users
ON public.categories
FOR SELECT
TO authenticated
USING (public.has_any_role(ARRAY['cashier'::public.app_role, 'manager'::public.app_role, 'owner'::public.app_role, 'dev'::public.app_role]));

CREATE POLICY categories_write_managers
ON public.categories
FOR ALL
TO authenticated
USING (public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]))
WITH CHECK (public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]));

CREATE POLICY products_read_active_users
ON public.products
FOR SELECT
TO authenticated
USING (public.has_any_role(ARRAY['cashier'::public.app_role, 'manager'::public.app_role, 'owner'::public.app_role, 'dev'::public.app_role]));

CREATE POLICY products_insert_managers
ON public.products
FOR INSERT
TO authenticated
WITH CHECK (public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]));

CREATE POLICY products_update_managers
ON public.products
FOR UPDATE
TO authenticated
USING (public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]))
WITH CHECK (public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]));

CREATE POLICY shifts_read_own_or_managed
ON public.shifts
FOR SELECT
TO authenticated
USING (
    user_id = auth.uid()
    OR public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role])
);

CREATE POLICY held_sales_read_own_or_managed
ON public.held_sales
FOR SELECT
TO authenticated
USING (
    (cashier_id = auth.uid() AND public.has_role('cashier'))
    OR public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role])
);

CREATE POLICY held_sales_write_own_open_shift
ON public.held_sales
FOR ALL
TO authenticated
USING (
    cashier_id = auth.uid()
    AND public.has_role('cashier')
    AND EXISTS (
        SELECT 1 FROM public.shifts AS s
        WHERE s.id = held_sales.shift_id
          AND s.user_id = auth.uid()
          AND s.closed_at IS NULL
    )
)
WITH CHECK (
    cashier_id = auth.uid()
    AND public.has_role('cashier')
    AND EXISTS (
        SELECT 1 FROM public.shifts AS s
        WHERE s.id = held_sales.shift_id
          AND s.user_id = auth.uid()
          AND s.closed_at IS NULL
    )
);

CREATE POLICY held_sale_items_read_parent
ON public.held_sale_items
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.held_sales AS hs
        WHERE hs.id = held_sale_items.held_sale_id
          AND (
              (hs.cashier_id = auth.uid() AND public.has_role('cashier'))
              OR public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role])
          )
    )
);

CREATE POLICY held_sale_items_write_own_open_shift
ON public.held_sale_items
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.held_sales AS hs
        JOIN public.shifts AS s ON s.id = hs.shift_id AND s.user_id = hs.cashier_id
        WHERE hs.id = held_sale_items.held_sale_id
          AND hs.cashier_id = auth.uid()
          AND s.closed_at IS NULL
          AND public.has_role('cashier')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.held_sales AS hs
        JOIN public.shifts AS s ON s.id = hs.shift_id AND s.user_id = hs.cashier_id
        WHERE hs.id = held_sale_items.held_sale_id
          AND hs.cashier_id = auth.uid()
          AND s.closed_at IS NULL
          AND public.has_role('cashier')
    )
);

CREATE POLICY sales_read_own_or_managed
ON public.sales
FOR SELECT
TO authenticated
USING (
    (cashier_id = auth.uid() AND public.has_role('cashier'))
    OR public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role])
);

CREATE POLICY sale_items_read_own_or_managed
ON public.sale_items
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.sales AS s
        WHERE s.id = sale_items.sale_id
          AND (
              (s.cashier_id = auth.uid() AND public.has_role('cashier'))
              OR public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role])
          )
    )
);

CREATE POLICY payments_read_own_or_managed
ON public.payments
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.sales AS s
        WHERE s.id = payments.sale_id
          AND (
              (s.cashier_id = auth.uid() AND public.has_role('cashier'))
              OR public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role])
          )
    )
);

CREATE POLICY refunds_read_managers
ON public.refunds
FOR SELECT
TO authenticated
USING (public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]));

CREATE POLICY refund_items_read_managers
ON public.refund_items
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.refunds AS r
        WHERE r.id = refund_items.refund_id
          AND public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role])
    )
);

CREATE POLICY refund_payments_read_managers
ON public.refund_payments
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.refunds AS r
        WHERE r.id = refund_payments.refund_id
          AND public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role])
    )
);

CREATE POLICY stock_movements_read_managers
ON public.stock_movements
FOR SELECT
TO authenticated
USING (public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role]));

CREATE POLICY audit_logs_read_owner_and_dev
ON public.audit_logs
FOR SELECT
TO authenticated
USING (public.has_any_role(ARRAY['owner'::public.app_role, 'dev'::public.app_role]));

CREATE POLICY feature_flags_read_dev
ON public.feature_flags
FOR SELECT
TO authenticated
USING (public.has_role('dev'));

GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(public.app_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_shift(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_shift(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_sale(uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_refund(uuid, text, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_sale(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_stock(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_profile_role(uuid, public.app_role, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_feature_flag(text, boolean) TO authenticated;

COMMIT;
