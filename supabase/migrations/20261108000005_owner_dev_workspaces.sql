BEGIN;

-- Store branding is intentionally a singleton for the first release.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;

UPDATE public.profiles AS p
SET email = u.email
FROM auth.users AS u
WHERE u.id = p.id
  AND p.email IS DISTINCT FROM u.email;

CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auth_user_email_to_profile ON auth.users;
CREATE TRIGGER auth_user_email_to_profile
AFTER UPDATE OF email ON auth.users
FOR EACH ROW
WHEN (OLD.email IS DISTINCT FROM NEW.email)
EXECUTE FUNCTION public.sync_profile_email();

CREATE TABLE public.store_settings (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    store_name text NOT NULL DEFAULT 'TrueMarket' CHECK (length(trim(store_name)) BETWEEN 2 AND 80),
    logo_path text,
    updated_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        logo_path IS NULL
        OR logo_path ~ '^store/[a-z0-9-]+\.(png|jpg|jpeg|webp)$'
    )
);

INSERT INTO public.store_settings (singleton, store_name)
VALUES (true, 'TrueMarket')
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.store_settings FROM anon, authenticated;
GRANT SELECT (store_name, logo_path) ON public.store_settings TO anon, authenticated;
GRANT SELECT (updated_at) ON public.store_settings TO authenticated;
GRANT SELECT (singleton) ON public.store_settings TO anon, authenticated;

CREATE POLICY store_settings_public_read
ON public.store_settings
FOR SELECT
TO anon, authenticated
USING (true);

CREATE TABLE public.staff_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL CHECK (email = lower(trim(email)) AND length(email) <= 254),
    role public.app_role NOT NULL CHECK (role IN ('cashier', 'manager')),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'cancelled')),
    invited_by uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
    user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    accepted_at timestamptz
);

CREATE UNIQUE INDEX staff_invitations_pending_email_idx
ON public.staff_invitations (email)
WHERE status = 'pending';
CREATE INDEX staff_invitations_created_idx
ON public.staff_invitations (created_at DESC);

ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_invitations FROM anon, authenticated;
GRANT SELECT ON public.staff_invitations TO authenticated;

CREATE POLICY staff_invitations_owner_read
ON public.staff_invitations
FOR SELECT
TO authenticated
USING (public.has_role('owner'));

CREATE OR REPLACE FUNCTION public.owner_create_staff_invitation(
    p_email text,
    p_role public.app_role
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
    v_email text := lower(trim(p_email));
    v_invitation_id uuid;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_role('owner') THEN
        RAISE EXCEPTION 'An active owner account is required';
    END IF;
    IF p_role IS NULL OR p_role NOT IN ('cashier', 'manager') THEN
        RAISE EXCEPTION 'Owners may invite cashier or manager accounts only';
    END IF;
    IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(v_email) > 254 THEN
        RAISE EXCEPTION 'Enter a valid email address';
    END IF;
    IF EXISTS (SELECT 1 FROM auth.users AS u WHERE lower(u.email) = v_email) THEN
        RAISE EXCEPTION 'An account already exists for this email';
    END IF;
    IF EXISTS (SELECT 1 FROM public.staff_invitations AS i WHERE i.email = v_email AND i.status = 'pending') THEN
        RAISE EXCEPTION 'A pending invitation already exists for this email';
    END IF;

    INSERT INTO public.staff_invitations (email, role, invited_by)
    VALUES (v_email, p_role, auth.uid())
    RETURNING id INTO v_invitation_id;

    RETURN v_invitation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_cancel_staff_invitation(p_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_role('owner') THEN
        RAISE EXCEPTION 'An active owner account is required';
    END IF;
    UPDATE public.staff_invitations
    SET status = 'cancelled'
    WHERE id = p_invitation_id AND status = 'pending';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pending invitation not found';
    END IF;
END;
$$;

-- Assign the invited role inside the auth.users trigger rather than trusting
-- user-editable auth metadata or relying on a follow-up client request.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role public.app_role := 'cashier';
    v_active boolean := false;
    v_invitation_id uuid;
BEGIN
    IF NEW.email IS NOT NULL THEN
        SELECT i.id, i.role
        INTO v_invitation_id, v_role
        FROM public.staff_invitations AS i
        WHERE i.email = lower(NEW.email)
          AND i.status = 'pending'
        ORDER BY i.created_at DESC
        LIMIT 1
        FOR UPDATE;
        IF NOT FOUND THEN
            v_invitation_id := NULL;
            v_role := 'cashier';
        ELSE
            v_active := true;
        END IF;
    END IF;

    INSERT INTO public.profiles (id, name, email, role, active)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
        NEW.email,
        v_role,
        v_active
    )
    ON CONFLICT (id) DO NOTHING;

    IF v_invitation_id IS NOT NULL THEN
        UPDATE public.staff_invitations
        SET user_id = NEW.id
        WHERE id = v_invitation_id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_staff_invitation_on_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
        UPDATE public.staff_invitations
        SET status = 'accepted', accepted_at = now()
        WHERE user_id = NEW.id AND status = 'pending';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auth_user_confirms_staff_invitation ON auth.users;
CREATE TRIGGER auth_user_confirms_staff_invitation
AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW
WHEN (OLD.email_confirmed_at IS DISTINCT FROM NEW.email_confirmed_at)
EXECUTE FUNCTION public.accept_staff_invitation_on_confirmation();

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
    IF p_user_id IS NULL OR p_role NOT IN ('cashier', 'manager') OR p_active IS NULL THEN
        RAISE EXCEPTION 'Only cashier and manager accounts can be managed here';
    END IF;

    SELECT role, active INTO v_old_role, v_old_active
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Profile not found';
    END IF;
    IF v_old_role NOT IN ('cashier', 'manager') THEN
        RAISE EXCEPTION 'Owner and dev roles must be provisioned manually';
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

CREATE OR REPLACE FUNCTION public.owner_update_store_settings(
    p_store_name text,
    p_logo_path text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
    v_old_name text;
    v_old_logo_path text;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_role('owner') THEN
        RAISE EXCEPTION 'An active owner account is required';
    END IF;
    IF p_store_name IS NULL OR length(trim(p_store_name)) NOT BETWEEN 2 AND 80 THEN
        RAISE EXCEPTION 'Store name must be between 2 and 80 characters';
    END IF;
    IF p_logo_path IS NOT NULL AND p_logo_path !~ '^store/[a-z0-9-]+\.(png|jpg|jpeg|webp)$' THEN
        RAISE EXCEPTION 'Store logo path is invalid';
    END IF;

    SELECT store_name, logo_path INTO v_old_name, v_old_logo_path
    FROM public.store_settings WHERE singleton = true FOR UPDATE;

    UPDATE public.store_settings
    SET store_name = trim(p_store_name), logo_path = p_logo_path,
        updated_by = auth.uid(), updated_at = now()
    WHERE singleton = true;

    INSERT INTO public.audit_logs (user_id, action, entity_type, meta)
    VALUES (auth.uid(), 'store_profile_updated', 'store_settings', jsonb_build_object(
        'old_store_name', v_old_name,
        'new_store_name', trim(p_store_name),
        'logo_changed', v_old_logo_path IS DISTINCT FROM p_logo_path
    ));
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
    v_start timestamptz := date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg';
    v_end timestamptz;
    v_sales_total bigint;
    v_sales_count bigint;
    v_open_shifts bigint;
    v_low_stock_count bigint;
    v_low_stock_products jsonb;
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_role('owner') THEN
        RAISE EXCEPTION 'An active owner account is required';
    END IF;
    v_end := v_start + interval '1 day';

    SELECT COALESCE(sum(s.total_cents), 0), count(*)
    INTO v_sales_total, v_sales_count
    FROM public.sales AS s
    WHERE s.status = 'completed'
      AND s.created_at >= v_start AND s.created_at < v_end;

    SELECT count(*) INTO v_open_shifts
    FROM public.shifts AS s
    WHERE s.closed_at IS NULL;

    SELECT count(*) INTO v_low_stock_count
    FROM public.products AS p
    WHERE p.active AND p.stock_qty <= p.reorder_at;

    SELECT COALESCE(jsonb_agg(to_jsonb(low_stock)), '[]'::jsonb)
    INTO v_low_stock_products
    FROM (
        SELECT p.id, p.name, p.sku, p.stock_qty, p.reorder_at
        FROM public.products AS p
        WHERE p.active AND p.stock_qty <= p.reorder_at
        ORDER BY p.stock_qty ASC, p.name ASC
        LIMIT 6
    ) AS low_stock;

    RETURN jsonb_build_object(
        'sales_total_cents', v_sales_total,
        'sales_count', v_sales_count,
        'open_shift_count', v_open_shifts,
        'low_stock_count', v_low_stock_count,
        'low_stock_products', v_low_stock_products
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.dev_activity_feed(p_limit integer DEFAULT 50)
RETURNS TABLE (id uuid, action text, entity_type text, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.has_role('dev') THEN
        RAISE EXCEPTION 'An active dev account is required';
    END IF;

    RETURN QUERY
    SELECT a.id, a.action, a.entity_type, a.created_at
    FROM public.audit_logs AS a
    ORDER BY a.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
END;
$$;

CREATE TABLE public.feature_flag_registry (
    key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,63}$'),
    description text NOT NULL CHECK (length(trim(description)) BETWEEN 3 AND 200)
);

ALTER TABLE public.feature_flag_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.feature_flag_registry FROM anon, authenticated;
GRANT SELECT ON public.feature_flag_registry TO authenticated;

CREATE POLICY feature_flag_registry_read_dev
ON public.feature_flag_registry
FOR SELECT
TO authenticated
USING (public.has_role('dev'));

CREATE OR REPLACE FUNCTION public.set_feature_flag(p_key text, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_key text := trim(p_key);
    v_description text;
BEGIN
    IF v_actor_id IS NULL OR NOT public.has_role('dev') THEN
        RAISE EXCEPTION 'An active dev account is required';
    END IF;
    IF v_key IS NULL OR v_key = '' OR p_enabled IS NULL THEN
        RAISE EXCEPTION 'Feature key and enabled state are required';
    END IF;

    SELECT r.description INTO v_description
    FROM public.feature_flag_registry AS r
    WHERE r.key = v_key;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This feature flag is not registered in the application';
    END IF;

    INSERT INTO public.feature_flags (key, enabled, description, updated_by)
    VALUES (v_key, p_enabled, v_description, v_actor_id)
    ON CONFLICT (key) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        description = EXCLUDED.description,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();

    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, meta)
    VALUES (v_actor_id, 'feature_flag_changed', 'feature_flags', NULL, jsonb_build_object('key', v_key, 'enabled', p_enabled));
END;
$$;

-- Devs must use the redacted support feed and do not need customer/staff or
-- product-price data from the raw tables.
DROP POLICY IF EXISTS profiles_select_self_or_privileged ON public.profiles;
CREATE POLICY profiles_select_self_or_privileged
ON public.profiles
FOR SELECT
TO authenticated
USING (
    auth.uid() = id
    OR public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role])
);

DROP POLICY IF EXISTS categories_read_active_users ON public.categories;
CREATE POLICY categories_read_active_users
ON public.categories
FOR SELECT
TO authenticated
USING (public.has_any_role(ARRAY['cashier'::public.app_role, 'manager'::public.app_role, 'owner'::public.app_role]));

DROP POLICY IF EXISTS products_read_active_users ON public.products;
CREATE POLICY products_read_active_users
ON public.products
FOR SELECT
TO authenticated
USING (public.has_any_role(ARRAY['cashier'::public.app_role, 'manager'::public.app_role, 'owner'::public.app_role]));

DROP POLICY IF EXISTS audit_logs_read_owner_and_dev ON public.audit_logs;
CREATE POLICY audit_logs_read_owner_and_dev
ON public.audit_logs
FOR SELECT
TO authenticated
USING (public.has_role('owner'));

DROP POLICY IF EXISTS shifts_read_own_or_managed ON public.shifts;
CREATE POLICY shifts_read_own_or_managed
ON public.shifts
FOR SELECT
TO authenticated
USING (
    (user_id = auth.uid() AND public.has_any_role(ARRAY['cashier'::public.app_role, 'manager'::public.app_role, 'owner'::public.app_role]))
    OR public.has_any_role(ARRAY['manager'::public.app_role, 'owner'::public.app_role])
);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('store-branding', 'store-branding', true, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE
SET public = true, file_size_limit = 2097152,
    allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'];

DROP POLICY IF EXISTS store_branding_public_read ON storage.objects;
CREATE POLICY store_branding_public_read
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'store-branding');

DROP POLICY IF EXISTS store_branding_owner_insert ON storage.objects;
CREATE POLICY store_branding_owner_insert
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'store-branding' AND public.has_role('owner'));

DROP POLICY IF EXISTS store_branding_owner_update ON storage.objects;
CREATE POLICY store_branding_owner_update
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'store-branding' AND public.has_role('owner'))
WITH CHECK (bucket_id = 'store-branding' AND public.has_role('owner'));

DROP POLICY IF EXISTS store_branding_owner_delete ON storage.objects;
CREATE POLICY store_branding_owner_delete
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'store-branding' AND public.has_role('owner'));

REVOKE ALL ON FUNCTION public.owner_create_staff_invitation(text, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_cancel_staff_invitation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_update_store_settings(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_dashboard_summary() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dev_activity_feed(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_feature_flag(text, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.owner_create_staff_invitation(text, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_cancel_staff_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_update_store_settings(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_dashboard_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dev_activity_feed(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_feature_flag(text, boolean) TO authenticated;

COMMIT;
