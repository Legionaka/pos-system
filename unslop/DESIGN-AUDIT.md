# TrueMarket interface design audit

**Scope:** Public routes `/login` and `/register`; protected workspace routes `/pos` and `/catalog`; `/` redirect; `/auth/confirm` handler.  
**Review:** Unslop checklist, source review, responsive screenshots, static slop scan, and contrast scan.  
**Initial score:** **77% — 20 pass, 6 fail, 4 not applicable** (26 applicable checks).  
**Screenshot widths:** 375, 768, 1024, and 1440 px. Public pages have no horizontal overflow at these widths.

## Summary

TrueMarket has a coherent visual direction: the forest-green brand, lime accent, white workspace, and restrained surface treatments read consistently across the app. The login page follows the supplied split-panel reference. The main design gap is that registration still uses the earlier branded shell, so the two related account pages feel like different products. On small screens, the login layout also reserves a large blank area above its header and leaves a green strip below the content.

The POS and product catalog were reviewed in source, but could not be captured as authenticated pages: a fresh browser session is redirected to login and no test account/session was available. Their findings are therefore implementation-level, not visual claims. The development toolbar bubble visible in screenshots is Next.js tooling and is excluded from the audit.

## Remediation update

The six failed checklist items have been addressed in source. Registration now shares the login shell; the mobile login brand panel is flush to the viewport and the form uses the full mobile viewport; catalog metadata has darker colors and a more readable type size; POS/catalog controls have larger hit areas; the slash key hint now focuses POS search; typography weights and dense text sizes are consolidated; spacing outliers were normalized; and interface symbols were replaced with matching SVG icons.

Login and the invite-required registration state were recaptured at 375, 768, 1024, and 1440px. Both routes still have no horizontal overflow. Authenticated POS/catalog visual review remains outstanding because this audit has no authenticated browser session, so their updated layout and touch targets have not been visually checked. The initial 77% score above records the pre-fix audit; it has not been replaced with a post-fix score.

## Route inventory

| Route | Purpose | Review evidence |
|---|---|---|
| `/` | Redirects to login | Source reviewed |
| `/login` | Staff sign-in | Captured at all four widths; contrast and static scans |
| `/register` | Invite-only account setup | Invite-required state captured at all four widths; invite acceptance state source-reviewed |
| `/pos` | Cashier checkout | Source-reviewed; unauthenticated browser redirects to login |
| `/catalog` | Manager/owner product and inventory management | Source-reviewed; unauthenticated browser redirects to login |
| `/auth/confirm` | Authentication callback/redirect handler | Non-visual handler; source-reviewed |

## Checklist score

| Category | Score | Main evidence |
|---|---:|---|
| Typography | 3/5 | T1, T5 fail: multiple weights and a broad, unbounded size scale in `app/globals.css`. Arimo/Geist pairing and heading line-height/tracking are otherwise purposeful. |
| Spacing | 0/2 | S1 fail: 7px/9px gaps and other off-grid values appear in POS/catalog styles. S3 fail: POS quantity controls are 20×24px; catalog row actions are 30px high and category/payment controls 34px high. |
| Color | 4/5 | C3 fail: catalog supporting text is too low contrast at normal small-text sizes. Login/register solid-color pairs pass; photo overlays were manually inspected. |
| Surfaces | 3/3 | Panels, cards, borders, and shadows have a clear hierarchy without stacking effects excessively. |
| Icons and imagery | 2/3 | I1 fail: inline SVG icons are mixed with text glyphs such as `＋`, `▤`, `×`, and `✓`. No emoji-as-icon issue; cashier imagery supports the login brand panel. |
| Motion | 3/3 | Specific transitions, reduced-motion handling, and interactive feedback are present. M1 is not applicable where no entrance animation is used. |
| States and robustness | 3/3 | Loading/error/empty states and labels exist. Public screenshots show no overflow. Protected routes were not visually exercised. |
| Layout | 2/2 | Login composition and surface grouping suit the task. Repeated section/card-grid checks are not applicable. |

## Findings

### 1. Login and registration use different visual systems

Login opts into `AuthShell`'s `figma` variant, while registration uses the default `branded` variant (`app/login/page.tsx:14`, `app/register/page.tsx:13`). The default shell uses a 520px brand column (`app/globals.css:68`); the login reference uses a wide image-led split panel. At desktop widths, this makes registration look like an older product page rather than the next step in the same invite flow. Apply the same shell and brand treatment to registration, then check the invite-required, expired-link, and invite-acceptance states.

### 2. Mobile login has an oversized top gap and trailing green strip

At 375px and 768px, the login screenshot shows a large blank area above the compact brand header and a dark-green band below the white form area. The mobile login main sets `min-height: calc(100vh - 92px)` and top padding of `clamp(48px, 12vh, 104px)` (`app/globals.css:859–861`), while the header is inside that main. Rebalance the header and form spacing and let the page background reach the viewport edge. Confirm short and tall mobile heights after adjustment.

### 3. Small catalog text misses normal-text contrast

Catalog supporting copy uses muted colors including `#89948d`, `#839087`, and `#7f8c83` (`app/globals.css:1210`, `1240`, `1276`). Against their light surfaces these produce about 2.95:1, 3.21:1, and 3.51:1 respectively, below the 4.5:1 target for small normal text. The contrast script found no failures on the captured login/register solid-color pairs; it cannot fully evaluate image/gradient regions, which were manually checked.

### 4. POS and catalog controls are small for touch use

POS quantity buttons are 20×24px (`app/globals.css:1066`); catalog row actions are 30px high (`1256`), and POS category/payment buttons are 34px high (`1032`). These are compact even for pointer use and difficult to target on touchscreens. Increase hit areas to at least 40–44px while preserving compact visual styling, especially for quantity changes and row actions.

### 5. POS search suggests a shortcut that is not implemented

The search field displays a `/` key hint (`app/pos/pos-screen.tsx:202`), but source review found no key listener that focuses the search input. Either implement the advertised shortcut with a focusable input reference and sensible typing guards, or remove the hint.

### 6. Typography and spacing need fewer one-off values

Styles use several weights including 400, 500, 550, 600, 650, and 700, along with text sizes ranging from 9px upward. POS/catalog styles also contain 7px and 9px gaps. This makes dense operational screens feel more delicate than necessary and creates avoidable visual inconsistency. Consolidate around named type and spacing tokens, while keeping small labels readable.

## Recommended fixes (priority order)

1. Make registration visually continuous with login; review all invite states.
2. Correct the mobile login vertical layout and remove the trailing background strip.
3. Darken catalog metadata and helper text to meet 4.5:1 for small text.
4. Enlarge touch targets in POS and catalog, including product quantity controls.
5. Implement the `/` search shortcut or remove the hint.
6. Consolidate the typography weights/sizes and spacing values into a compact scale.
7. Use one consistent icon treatment instead of mixing custom SVGs and text glyphs.

## Screenshots

### Login

- [375px](screenshots/login/375.png)
- [768px](screenshots/login/768.png)
- [1024px](screenshots/login/1024.png)
- [1440px](screenshots/login/1440.png)

### Registration (invite-required state)

- [375px](screenshots/register/375.png)
- [768px](screenshots/register/768.png)
- [1024px](screenshots/register/1024.png)
- [1440px](screenshots/register/1440.png)

## Review method and limits

Captured `/login` and `/register` at 375, 768, 1024, and 1440px with the Unslop screenshot script and inspected the rendered images. Both public pages reported 0px horizontal overflow at each width. The Unslop static slop scan scanned 25 files and reported no static slop tells. Contrast scans reported no failing solid-color pairs on login or registration; image/gradient combinations were flagged for manual review. Reviewed the app routes and styles for protected pages and interaction hints. After applying the listed fixes, recaptured the two public routes at all four widths.

`/pos` and `/catalog` require authentication and redirect a fresh screenshot session to `/login`. Since no test account/session was available, this audit does not claim visual verification of their rendered responsive states.
