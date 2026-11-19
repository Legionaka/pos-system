# TrueMarket POS

TrueMarket POS is a single-store point-of-sale and store operations app built with Next.js and Supabase. It supports cashier checkout and gives managers and owners tools to manage products, stock, staff, shifts, and sales.

## Features

- Role-based workspaces for cashiers, managers, owners, and developers.
- POS checkout with barcode or text search, discounts, cash/card/EFT/QR payments, VAT and cash rounding, shift management, and held carts.
- Local offline sale queue with later synchronization.
- Product catalog with categories, variants, images, CSV import/export, stock adjustments, and reorder levels.
- Inventory delivery receiving, purchase orders, and reviewed stock counts.
- Sales history, receipts, partial or full refunds, and date-range reports with CSV export.
- Owner tools for team invitations, staff access, store branding, POS settings, promotions, sales targets, shifts, and activity history.
- Developer workspace for activity history and registered feature flags.

## Tech stack

- Next.js 16 App Router, React 19, and TypeScript
- Supabase Auth, PostgreSQL, Row Level Security, and Storage
- Tailwind CSS 4
- Zod for input validation

## Run locally

### Requirements

- Node.js 20.9 or later
- A Supabase project

### Install and configure

```bash
npm ci
```

Copy `.env.example` to `.env.local` and set the values for your Supabase project:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Keep `SUPABASE_SERVICE_ROLE_KEY` private and out of client-side code. Apply the SQL migrations in `supabase/migrations` to the project in filename order using the Supabase CLI or dashboard SQL editor. The app depends on those migrations for its schema, policies, functions, and storage buckets.

Create the initial owner account through a trusted Supabase Auth/admin workflow and assign its `profiles.role` as `owner`. Owners can then invite cashier and manager accounts from the app. Do not expose service-role credentials to users.

### Start the development server

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000); the root route redirects to `/login`.

## Other commands

```bash
npm run lint
npm run build
npm run start
```

## Project structure

- `app/` — App Router pages, server actions, and UI for authentication, POS, catalog, inventory, sales, reports, and role workspaces.
- `lib/` — Supabase clients, database types, and shared settings/time helpers.
- `supabase/migrations/` — PostgreSQL schema changes, business functions, and access policies.
- `supabase/seed_supermarket_demo.sql` — Optional demo data script; review and run it only in a non-production database.
- `docs/OPERATIONS.md` — Operational guidance, backup/recovery notes, and a launch acceptance checklist.

## Operational notes

The app records refunds and payment references but does not process card transactions or move money. Offline checkout depends on a later successful sync. The operations guide includes a launch checklist for the store's browser, barcode scanner, receipt printer, and role restrictions; those checks should be completed in the target environment before relying on the app in a live store.
