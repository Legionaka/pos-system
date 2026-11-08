BEGIN;

-- The app filters the singleton settings row when loading its public branding.
GRANT SELECT (singleton) ON public.store_settings TO anon, authenticated;

COMMIT;
