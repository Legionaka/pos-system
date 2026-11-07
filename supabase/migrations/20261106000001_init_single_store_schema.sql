BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TYPE public.app_role AS ENUM ('cashier', 'manager', 'owner', 'dev');
CREATE TYPE public.tax_category AS ENUM ('standard', 'zero_rated', 'exempt');
CREATE TYPE public.payment_method AS ENUM ('cash', 'card', 'eft', 'qr');
CREATE TYPE public.sale_status AS ENUM ('completed', 'voided', 'refunded', 'partially_refunded');

CREATE TABLE public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    name text,
    role public.app_role NOT NULL DEFAULT 'cashier',
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sku text NOT NULL UNIQUE,
    barcode text UNIQUE,
    name text NOT NULL,
    price_cents bigint NOT NULL CHECK (price_cents >= 0),
    tax_category public.tax_category NOT NULL,
    stock_qty integer NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
    reorder_at integer NOT NULL DEFAULT 0 CHECK (reorder_at >= 0),
    active boolean NOT NULL DEFAULT true,
    category_id uuid REFERENCES public.categories (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.shifts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    opened_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz,
    opening_cash_cents bigint NOT NULL CHECK (opening_cash_cents >= 0),
    expected_cash_cents bigint CHECK (expected_cash_cents >= 0),
    counted_cash_cents bigint CHECK (counted_cash_cents >= 0),
    cash_variance_cents bigint,
    UNIQUE (id, user_id),
    CHECK (closed_at IS NULL OR closed_at >= opened_at),
    CHECK (
        (closed_at IS NULL AND expected_cash_cents IS NULL AND counted_cash_cents IS NULL AND cash_variance_cents IS NULL)
        OR
        (closed_at IS NOT NULL AND expected_cash_cents IS NOT NULL AND counted_cash_cents IS NOT NULL AND cash_variance_cents IS NOT NULL)
    ),
    CHECK (
        cash_variance_cents IS NULL
        OR cash_variance_cents = counted_cash_cents - expected_cash_cents
    )
);

CREATE UNIQUE INDEX shifts_one_open_per_cashier_idx
    ON public.shifts (user_id)
    WHERE closed_at IS NULL;

CREATE TABLE public.held_sales (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cashier_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    shift_id uuid NOT NULL,
    label text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (shift_id, cashier_id) REFERENCES public.shifts (id, user_id) ON DELETE CASCADE
);

CREATE TABLE public.held_sale_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    held_sale_id uuid NOT NULL REFERENCES public.held_sales (id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
    qty integer NOT NULL CHECK (qty > 0),
    unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
    tax_category public.tax_category NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sales (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    cashier_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    shift_id uuid NOT NULL,
    status public.sale_status NOT NULL DEFAULT 'completed',
    subtotal_cents bigint NOT NULL CHECK (subtotal_cents >= 0),
    vat_cents bigint NOT NULL CHECK (vat_cents >= 0),
    discount_cents bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0 AND discount_cents <= subtotal_cents),
    rounding_cents integer NOT NULL DEFAULT 0 CHECK (rounding_cents BETWEEN -2 AND 2),
    total_cents bigint NOT NULL CHECK (total_cents >= 0),
    cash_received_cents bigint NOT NULL DEFAULT 0 CHECK (cash_received_cents >= 0),
    change_cents bigint NOT NULL DEFAULT 0 CHECK (change_cents >= 0 AND change_cents <= cash_received_cents),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (shift_id, cashier_id) REFERENCES public.shifts (id, user_id) ON DELETE RESTRICT,
    CHECK (vat_cents <= subtotal_cents - discount_cents),
    CHECK (total_cents = subtotal_cents - discount_cents + rounding_cents),
    CHECK (rounding_cents = 0 OR cash_received_cents > 0)
);

CREATE TABLE public.sale_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id uuid NOT NULL REFERENCES public.sales (id) ON DELETE RESTRICT,
    product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
    product_name text NOT NULL,
    sku text NOT NULL,
    qty integer NOT NULL CHECK (qty > 0),
    unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
    discount_cents bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
    line_total_cents bigint NOT NULL CHECK (line_total_cents >= 0),
    tax_category public.tax_category NOT NULL,
    vat_cents bigint NOT NULL CHECK (vat_cents >= 0 AND vat_cents <= line_total_cents),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (discount_cents <= unit_price_cents * qty),
    CHECK (line_total_cents = unit_price_cents * qty - discount_cents)
);

CREATE TABLE public.payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id uuid NOT NULL REFERENCES public.sales (id) ON DELETE RESTRICT,
    method public.payment_method NOT NULL,
    amount_cents bigint NOT NULL CHECK (amount_cents > 0),
    received_cents bigint,
    change_cents bigint,
    reference text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (method = 'cash' AND received_cents IS NOT NULL AND change_cents IS NOT NULL AND received_cents >= amount_cents
            AND change_cents = received_cents - amount_cents)
        OR
        (method <> 'cash' AND received_cents IS NULL AND change_cents IS NULL)
    )
);

CREATE TABLE public.refunds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    sale_id uuid NOT NULL REFERENCES public.sales (id) ON DELETE RESTRICT,
    approved_by uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    reason text NOT NULL CHECK (length(trim(reason)) > 0),
    total_cents bigint NOT NULL CHECK (total_cents >= 0),
    vat_cents bigint NOT NULL DEFAULT 0 CHECK (vat_cents >= 0 AND vat_cents <= total_cents),
    rounding_cents integer NOT NULL DEFAULT 0 CHECK (rounding_cents BETWEEN -2 AND 2),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.refund_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    refund_id uuid NOT NULL REFERENCES public.refunds (id) ON DELETE RESTRICT,
    sale_item_id uuid NOT NULL REFERENCES public.sale_items (id) ON DELETE RESTRICT,
    qty integer NOT NULL CHECK (qty > 0),
    amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
    vat_cents bigint NOT NULL DEFAULT 0 CHECK (vat_cents >= 0 AND vat_cents <= amount_cents),
    restock boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.refund_payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    refund_id uuid NOT NULL REFERENCES public.refunds (id) ON DELETE RESTRICT,
    method public.payment_method NOT NULL,
    amount_cents bigint NOT NULL CHECK (amount_cents > 0),
    reference text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.stock_movements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE RESTRICT,
    delta integer NOT NULL CHECK (delta <> 0),
    reason text NOT NULL CHECK (reason IN ('sale_completed', 'refund_restock', 'manual_adjustment', 'sale_voided')),
    actor_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    sale_id uuid REFERENCES public.sales (id) ON DELETE RESTRICT,
    refund_id uuid REFERENCES public.refunds (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    action text NOT NULL,
    entity_type text,
    entity_id uuid,
    meta jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.feature_flags (
    key text PRIMARY KEY,
    enabled boolean NOT NULL DEFAULT false,
    description text,
    updated_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profiles (id, name, role, active)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
        'cashier',
        true
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER products_set_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER held_sales_set_updated_at
BEFORE UPDATE ON public.held_sales
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER feature_flags_set_updated_at
BEFORE UPDATE ON public.feature_flags
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
    SELECT p.role
    FROM public.profiles AS p
    WHERE p.id = (SELECT auth.uid())
      AND p.active
$$;

CREATE OR REPLACE FUNCTION public.has_role(p_role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles AS p
        WHERE p.id = (SELECT auth.uid())
          AND p.active
          AND p.role = p_role
    )
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(p_roles public.app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles AS p
        WHERE p.id = (SELECT auth.uid())
          AND p.active
          AND p.role = ANY (p_roles)
    )
$$;

CREATE OR REPLACE FUNCTION public.log_product_price_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
BEGIN
    IF OLD.price_cents IS DISTINCT FROM NEW.price_cents THEN
        INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, meta)
        VALUES (
            auth.uid(),
            'product_price_changed',
            'products',
            NEW.id,
            jsonb_build_object('sku', NEW.sku, 'price_changed', true)
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER products_audit_price_change
AFTER UPDATE OF price_cents ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.log_product_price_change();

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_role(public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_any_role(public.app_role[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_product_price_change() FROM PUBLIC, anon, authenticated;

COMMIT;
