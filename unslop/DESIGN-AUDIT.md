# Login page design audit

**Scope:** `/login` only  
**Review type:** Unslop visual and implementation checklist  
**Overall score:** 72% (18 pass, 7 fail, 4 not applicable)  
**Responsive check:** 375, 768, 1024, and 1440 px; no horizontal overflow observed.

## Summary

The login page has a clear, restrained visual identity. Its forest-green brand panel, compact login form, and mobile layout read as one product rather than a generic template. The main issues are small-scale consistency: typography uses too many weights and sizes, spacing drifts from a consistent grid, and the legal note falls just below the recommended contrast threshold. The invitation link also needs a larger touch target.

The screenshots include the Next.js development toolbar badge at bottom-left; that badge is not part of the page design and was excluded from the review.

## Checklist

### Typography — 2/5

| Check | Result | Evidence |
|---|---|---|
| T1: Restrained font-weight set | Fail | Four weights are used (400, 500, 600, 700), including in `app/globals.css`. Consolidate roles where possible. |
| T2: Intentional type pairing | Fail | Geist is used throughout. This can be a deliberate choice, but the page has no distinct type roles or documented rationale for using one family. |
| T3: Comfortable line height | Pass | Body copy is around 1.5 or greater; headings use tighter leading. |
| T4: Headings have intentional tracking | Pass | Heading styles use restrained negative letter spacing. |
| T5: Consistent type scale | Fail | The stylesheet includes many sizes from 10px through 42px without a clearly bounded scale. |

### Spacing — 0/2

| Check | Result | Evidence |
|---|---|---|
| S1: Consistent spacing grid | Fail | Several spacing values (including 7, 13, 18, 22, and 56px) depart from a consistent 4px rhythm. |
| S2: Repeated sections align consistently | N/A | The login screen is a single form surface rather than a sequence of repeated sections. |
| S3: Comfortable touch targets | Fail | The “Set up your account” invitation link is an inline target smaller than 44px high (`app/login/login-form.tsx`). |

### Color — 4/5

| Check | Result | Evidence |
|---|---|---|
| C1: Named, coherent palette | Pass | Styles use a defined palette rather than scattered utility colors. |
| C2: Restrained color use | Pass | Forest green and a light accent carry the visual identity without competing colors. |
| C3: Text contrast | Fail | `.auth-legal-note` measures 4.31:1 on its background, below the 4.5:1 target for normal text. |
| C4: Avoid pure black on pure white | Pass | Main text uses a softened dark ink color. |
| C5: Status is not conveyed by color alone | Pass | Form feedback includes text as well as color. |

### Surfaces — 3/3

| Check | Result | Evidence |
|---|---|---|
| R1: Surface treatments have hierarchy | Pass | The form card, controls, and logo use different scale and shape treatments. |
| R2: Shadows are restrained | Pass | A subtle shadow is reserved for the form card. |
| R3: Avoid stacked borders, shadows, and rings | Pass | No surface relies on all three effects at once. |

### Icons and imagery — 2/2

| Check | Result | Evidence |
|---|---|---|
| I1: Consistent icon style | Pass | The page uses its custom store mark without mixing icon families. |
| I2: No emoji as interface icons | Pass | No emoji are used as controls or status icons. |
| I3: Imagery supports the page | N/A | A login page does not need decorative photography or illustration; the brand mark is sufficient. |

### Motion — 2/3

| Check | Result | Evidence |
|---|---|---|
| M1: Motion is purposeful | N/A | No entrance animation is present. |
| M2: Transitions are specific | Pass | Transitions target particular properties instead of using `transition-all`. |
| M3: Reduced-motion preference is respected | Fail | The motion scan found transitions without a `prefers-reduced-motion` override. |
| M4: Interactive states are visible | Pass | Inputs, links, and the primary button have hover or focus feedback. |

### States and accessibility — 3/3

| Check | Result | Evidence |
|---|---|---|
| X1: Loading and error states exist | Pass | The login form exposes pending, validation, and authentication-error feedback. |
| X2: Layout works at tested widths | Pass | Screenshots at 375, 768, 1024, and 1440px show no horizontal overflow. |
| X3: Inputs have labels | Pass | Form labels are associated with their inputs. |

### Layout — 2/2

| Check | Result | Evidence |
|---|---|---|
| L1: Composition fits the task | Pass | The split brand-and-form composition gives the login task a clear focus. |
| L2: Repeated sections have consistent alignment | N/A | There are no repeated content sections to compare. |
| L3: Card grids are aligned | N/A | The page contains no card grid. |
| L4: Depth and grouping are clear | Pass | The brand panel and form card separate the two page roles. |

## Recommended fixes

1. Darken `.auth-legal-note` until it reaches at least 4.5:1 contrast against its background.
2. Give the invitation link a touch target at least 44px high, especially on mobile.
3. Define a compact type scale and a smaller set of weight roles; keep Geist if it is an intentional brand choice.
4. Normalize spacing tokens around a 4px rhythm.
5. Add a `prefers-reduced-motion: reduce` rule for transition effects.

## Screenshots

- [375px](screenshots/375.png)
- [768px](screenshots/768.png)
- [1024px](screenshots/1024.png)
- [1440px](screenshots/1440.png)

## Review method

Captured the local `/login` page at four viewport widths, inspected the screenshots, ran the Unslop `slop-scan.mjs` and `contrast-check.mjs` scripts, and reviewed the checklist. The contrast checker reported the legal note at 4.31:1. The motion scan found no reduced-motion handling for transitions. No application source files were changed as part of this review.

## Follow-up implementation

After the review, the login/auth styles were updated to darken muted text, give the account setup link a 44px minimum target, define shared type and spacing tokens, reduce font weights to 500/600 plus normal text, and respect reduced-motion preferences. These changes have not been re-captured or re-scored, so the checklist and score above remain the original review results until a new visual pass is run.
