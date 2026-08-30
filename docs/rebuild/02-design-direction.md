# Design Direction — Millat Vocational Training Portal

**Author:** Design lead
**Scope:** Full visual system, component library decision, tokens, layout, art direction, a11y, demo strategy
**Status:** Proposal for approval. Buildable as written.

---

## 0. The problem in one paragraph

The app currently has no visual identity — it has Ant Design's defaults with Tailwind sprayed over them, plus six other styling mechanisms. Grounded facts from the codebase: `src/index.css:13` sets `font-family: 'Times New Roman', Times, serif` on the `*` selector, so **the entire product renders in a serif system font**; `tailwind.config.js:22` declares `Inter var` which is never loaded by any `@font-face`; the one custom token ramp (`primary.50–950`) has **zero usages** across 120 `.tsx` files; `ThemeContext.tsx:34-36` has the theme token block commented out and `useTheme` is consumed by nothing, so dark mode is unreachable dead code; `AppLayout.tsx:96,103,159` hardcodes `from-blue-50 to-indigo-50`, `rgba(255,255,255,0.8)`, and a `from-blue-700 to-blue-300` sidebar that no theme could ever override. There are 213 hardcoded hex values across 32 files and 166 inline `style={{}}` objects.

So this is not a "polish pass." There is nothing to polish. **We are building a design system where there wasn't one**, and the good news is that means we get to choose a point of view instead of inheriting one.

---

## 1. Visual direction

### The strategic constraint

Every education product on the internet is blue. Coursera, Udemy, Blackboard, Moodle, Canvas, Google Classroom, and roughly 100% of "institute portal" capstone projects on GitHub — all blue, all rounded, all soft-shadowed, all Inter. The current app is blue-to-purple gradients with glassmorphism, which reads as 2021 dribbble.

The differentiator available to *this specific product* is its subject: **vocational training**. This is not a university. It is trades, technical skills, apprenticeship, certification — people learning to make and fix physical things. That is a genuinely distinct emotional register from academia, and no education software uses it. Taking it is free differentiation.

---

### Direction A — **"Workshop"** (Precision Craft) ← recommended

**Mood:** Well-made equipment. The interface of a good machine — a Leica, a Festool case, a Braun calculator, a technical manual printed properly. Warm graphite neutrals, a single confident amber accent, hairline rules instead of soft shadows, monospaced numerals for anything that is a code or a count. Precision without coldness.

**Reference points:**
- Dieter Rams / Braun product graphics — dark text on amber, functional labeling
- Engineering drawings and shop manuals — hairline rules, corner ticks, tabular figures
- Linear's information density and keyboard-first restraint, without Linear's dark-purple developer-tool skin
- Stripe Dashboard's data legibility
- Physical trade signage: hi-vis amber, stencil-precise, unpretentious

**What makes it memorable:** (1) The **amber-with-dark-text primary button** — `#171412` on `#E88C05`. Nobody in education does this. It reads as a physical equipment label, it's warm, and it happens to be an 8.5:1 contrast ratio, so it's *more* accessible than white-on-blue. (2) **Corner ticks** — a 1px L-bracket in the top-left and bottom-right of key panels, a signature borrowed from technical drawings, implemented in ~6 lines of CSS. (3) **Tabular monospace numerals** everywhere a number is data (enrollment counts, capacity `18/30`, course codes, timestamps), which makes tables scan like instrument readouts. (4) Content sits on warm paper (`#FCFBF9`), not clinical white — the whole product feels a few degrees warmer than everything it will be compared to.

**Risk:** Amber is close to the conventional "warning" color. Handled explicitly in §3.4.

---

### Direction B — **"Almanac"** (Editorial Institution)

**Mood:** A serious institution's printed prospectus. High-contrast serif display (Instrument Serif / Newsreader), generous measure, cream paper, deep ink, restrained ornament. Content-forward: course descriptions read like magazine features, the landing page reads like a Stripe Press book page.

**Reference points:** Stripe Press, MIT Press website, Are.na, The Browser Company's writing, university viewbooks.

**Where it wins:** the marketing site and course catalog would be genuinely beautiful, and it signals institutional credibility and taste.

**Where it loses:** it fights the product. Three role dashboards, a 30-column admin table, an enrollment approval queue, and a real-time chat are dense utility surfaces. Editorial serif systems get thin and precious at 13px in a data grid, and the generous measure that makes the landing page sing wastes horizontal space in an admin table. You end up building two design systems.

---

### Direction C — **"Signal"** (Dark-First Control Room)

**Mood:** Dark by default. Near-black slate, high-contrast cyan/lime accent, tight 4px grid, dense tables, keyboard-first, command palette as the primary navigation.

**Reference points:** Linear, Vercel, Raycast, Railway, Planetscale.

**Where it wins:** it screenshots extremely well and it is what engineers currently find attractive.

**Where it loses:** two things. First, it is *the* house style of 2024–2026 developer tools — a reviewer sees dark-slate-plus-neon and correctly identifies it as a template aesthetic, which undercuts the "I designed this" claim. Second, it is wrong for the audience: a vocational student on a mid-range Android phone in daylight, and a 55-year-old administrator, are not the Linear user. Dark-first would be a designer optimizing for their portfolio rather than for the product, which is exactly the thing a senior reviewer notices.

---

### ✅ Recommendation: **Direction A — "Workshop"**

**Why it fits an education/training product specifically:**

1. **It is honest about the domain.** Vocational training is craft. An interface that feels like well-made equipment is thematically coherent in a way that generic-SaaS-blue is not. That coherence is defensible in an interview: "the accent is amber because this is a trades school, and I wanted the primary action to read like a machine label rather than a web button."
2. **It survives density.** The system is neutral-dominant with a single accent used sparingly. That is precisely what a 12-column admin table with 20 rows, a filter bar, and a bulk-action toolbar needs. Direction B does not survive that; Direction C survives it but only in dark.
3. **It solves the accessibility problem instead of fighting it.** Dark-on-amber is high contrast by construction. Most education products fight a 3.2:1 white-on-blue button their entire life.
4. **Both themes work.** Warm graphite inverts cleanly to a warm near-black (`#0E0C0B`) — dark mode is a genuine second theme, not a filtered afterthought, and amber is one of the few accents that stays vivid and legible on both.
5. **It differentiates in the 5 seconds that matter.** A reviewer scrolling a portfolio has seen forty blue LMS screenshots. Warm paper, amber, and mono numerals stops the scroll.

**Naming the system:** call it **Forge** in code (`--forge-*` is optional; I use semantic names below). Ramps are named **Iron** (neutral), **Ember** (brand), **Blueprint** (informational/data), plus semantic status ramps.

---

## 2. Component library decision

### The call: **migrate to shadcn/ui + Radix Primitives + Tailwind v4**, with **TanStack Table v8** for data grids and **Recharts** (via shadcn's chart wrapper) for charts.

### What each option signals to an engineer reading the repo

| Option | Signal sent | Reality here |
|---|---|---|
| **Keep Ant Design 5** | "I picked a batteries-included kit and accepted its look." Neutral-to-negative for a *design*-led portfolio piece, because the visual identity is visibly the vendor's. | The repo already proves this fails: `AuthLayout.tsx:90-119` injects a runtime `<style>` block of `!important` overrides fighting `.ant-menu` internals, and there are 24 `!important` declarations. That is the sound of losing a fight with a component library. |
| **Mantine 7** | "I know there's more than one option." Better theming API than Ant, real CSS-variable theming, good hooks. But still a vendor look, and a smaller ecosystem. | Would be a lateral move — same category of problem, one migration's worth of cost, and the identity is still Mantine's. |
| **Headless + fully custom** | "I can build a component library." Highest ceiling, highest cost, and highest risk of shipping accessible-looking-but-not-accessible dialogs, comboboxes, and menus. | Wrong tradeoff for one person. Focus trapping, roving tabindex, and typeahead in a listbox are weeks you should not spend. |
| **✅ shadcn/ui + Radix + Tailwind** | "I own my component source, I understand accessible primitives, and the visual identity is mine." This is the strongest signal available, because the components land in `src/components/ui/*` as **readable code in your repo that a reviewer can open**. | Radix gives WAI-ARIA-correct behavior for Dialog, Popover, Select, Tabs, Tooltip, DropdownMenu, Toast; shadcn gives you styled source you edit freely. The system in §3 becomes authoritative rather than an override layer. |

**The decisive argument:** for a portfolio project whose stated top priority is UI, the reviewer must be able to *read the design system*. With Ant, the design system is in `node_modules` and your contribution is a pile of overrides. With shadcn, `src/components/ui/button.tsx` and `src/styles/tokens.css` **are** the contribution, and they are 200 lines a reviewer can skim in two minutes and be impressed by.

**Secondary argument:** Ant Design 5 uses CSS-in-JS with a runtime theme algorithm. The dark mode strategy in §7 (semantic CSS custom properties, one `.dark` block) is fundamentally cleaner and is not expressible through AntD's `algorithm` without also owning every token — at which point you've done the work anyway, in a worse place.

### Migration cost, honestly

Current Ant surface: `<Table>` in 5 files, `<Form>` in 31 files, `<Modal>` in 13, `<Button>` in ~144 call sites, `<Card>`, `<Statistic>`, `<Tag>`, `<Empty>` in 19, `<Spin>` in 22, `<Steps>`, `<Tabs>`, `<Menu>`, `<Layout>`, `<Dropdown>`, `<Avatar>`, `App.useApp()` notifications. Plus 84 files importing `@ant-design/icons` (which, note, **is not declared in `frontend/package.json`** — it resolves transitively through antd, so it breaks the moment antd's tree changes or you switch to pnpm).

Realistic estimate, **assuming the role-deduplication in the audit happens first** (it must — otherwise you migrate every screen twice):

| Phase | Work | Est. |
|---|---|---|
| 0 | Tailwind 3 → 4, token file, fonts, delete `index.css:7-14`, delete `login/styles.css`, kill the injected `<style>` block | 1 day |
| 1 | Install shadcn + Radix + lucide-react; build 18 primitives (§5) against the tokens; Storybook-less but with a `/design` route showing every component in both themes | 4–5 days |
| 2 | App shell: `AppLayout` + `AuthLayout` + nav + command palette + toast host | 2 days |
| 3 | Admin CRUD triads → one config-driven `CrudPage` + `DataTable` (TanStack) + `FilterBar` (this is where 4 near-identical pages, 7 filters, and 5 tables collapse to ~700 lines) | 4 days |
| 4 | Dashboards ×3 + charts | 3 days |
| 5 | Chat (unified, role-parameterized) | 3 days |
| 6 | Auth flows + marketing landing + catalog + course detail | 4 days |
| 7 | A11y pass, dark-mode audit, motion, empty/loading states, screenshots | 3 days |
| | **Total** | **~24 working days / 5 weeks** for one person |

Removing Ant also deletes `date-fns` vs `dayjs` duplication (keep `dayjs`, and **declare it** — it's currently imported in 22 files and absent from `package.json`), `react-icons` (unused), and `@hookform/resolvers` (declared with no `react-hook-form` installed).

**Keep from the current frontend:** `services/api.ts` (the single-flight refresh interceptor is the best file in the repo), `hooks/useWebSocket.ts` logic, `router/routes.ts` structure, `context/DepartmentContext.tsx`, the folder convention. Everything visual goes.

### Final stack

```
tailwindcss@4                 CSS-first @theme, no config file
shadcn/ui (CLI, latest)       owned component source
@radix-ui/react-*             behavior + a11y
lucide-react                  one icon system (replaces @ant-design/icons + emoji)
@tanstack/react-table@8       headless data grid
@tanstack/react-query@5       replaces hooks/useApi.ts (310 lines, double-fetches)
react-hook-form + zod         forms (zod already a dependency)
motion (framer-motion v11+)   transitions, AnimatePresence
recharts@2                    charts via shadcn chart wrapper
cmdk                          command palette
sonner                        toasts
@fontsource-variable/*        self-hosted fonts
```

---

## 3. Design tokens

Three tiers. **Primitives** (raw ramps, never used directly in components) → **semantic** (what components reference) → **component tokens** (rare, only where a component needs its own knob). Dark mode redefines **only the semantic tier**.

### 3.1 Primitive ramps

**Iron** — warm graphite neutral, hue ≈ 35°, low chroma. This is 85% of every screen.

| Step | Hex | Use |
|---|---|---|
| 0 | `#FFFFFF` | raised surfaces (light) |
| 25 | `#FCFBF9` | app canvas (light) — warm paper |
| 50 | `#F7F5F2` | sunken / table stripe |
| 100 | `#EFECE7` | hover fill, skeleton base |
| 200 | `#E2DDD6` | hairline borders |
| 300 | `#CBC4BA` | strong borders, disabled fill |
| 400 | `#A9A096` | placeholder, disabled text (non-essential only) |
| 500 | `#857C72` | icons, ≥18.66px text only (4.3:1 on Iron-25) |
| 600 | `#6A625A` | secondary text (6.3:1) |
| 700 | `#524B45` | strong secondary |
| 800 | `#3A3531` | headings on light |
| 900 | `#262220` | body text (≈14:1) |
| 950 | `#171412` | **text on Ember fills**, dark-mode elevated surface |
| 1000 | `#0E0C0B` | dark-mode canvas |

**Ember** — brand amber.

| Step | Hex | | Step | Hex |
|---|---|---|---|---|
| 50 | `#FFF8EB` | | 500 | `#E88C05` |
| 100 | `#FFEDC7` | | 600 | `#C86F03` |
| 200 | `#FED88A` | | 700 | `#A15307` |
| 300 | `#FCBF4D` | | 800 | `#83420D` |
| 400 | `#F8A81C` | | 900 | `#6E370F` |
| | | | 950 | `#401B03` |

**Blueprint** — informational / links / focus / primary data series.

| Step | Hex | | Step | Hex |
|---|---|---|---|---|
| 50 | `#EEF4FF` | | 500 | `#3667EF` |
| 100 | `#DAE6FF` | | 600 | `#244BD4` |
| 200 | `#BDD2FF` | | 700 | `#1E3CAB` |
| 300 | `#90B4FF` | | 800 | `#1E3486` |
| 400 | `#5C8CFA` | | 900 | `#1E2F6B` |
| | | | 950 | `#151E42` |

**Verdant** (success): `50 #ECFDF3` · `100 #D1FADF` · `200 #A6F4C5` · `300 #6CE9A6` · `400 #32D583` · `500 #12B76A` · `600 #039855` · `700 #027A48` · `800 #05603A` · `900 #054F31` · `950 #032D1E`

**Rust** (danger): `50 #FEF2F2` · `100 #FEE2E2` · `200 #FECACA` · `300 #FCA5A5` · `400 #F87171` · `500 #EF4444` · `600 #DC2626` · `700 #B4231C` · `800 #921B18` · `900 #7A1B18` · `950 #450A0A`

**Slate-blue is deliberately absent.** No purple, no gradient-to-indigo. The current `from-blue-500 to-purple-600` hero is the first thing to delete.

### 3.2 The Ember/warning collision — resolved

Brand amber and conventional warning amber occupy the same hue. Rather than pretend otherwise:

**Rule:** *Ember solid fills are reserved exclusively for the primary action in a given surface — one per view.* Warning states never use a solid fill. A warning is always **tinted surface (`Ember-50` light / `Ember-950` dark) + 3px left rule in `Ember-600` + `AlertTriangle` icon + a text label**. Because a warning is always accompanied by an icon and never by a solid fill, the two are never confusable, and the meaning never depends on color alone (which is also WCAG 1.4.1).

### 3.3 The full CSS custom property block

```css
/* ============================================================
   src/styles/tokens.css
   Tier 1: primitives  ·  Tier 2: semantic  ·  Tier 3: component
   Only Tier 2 is redefined for dark.
   ============================================================ */

@layer base {
  :root {
    /* ---------- TIER 1 — PRIMITIVES (never used in components) ---------- */
    --iron-0:#FFFFFF;   --iron-25:#FCFBF9;  --iron-50:#F7F5F2;
    --iron-100:#EFECE7; --iron-200:#E2DDD6; --iron-300:#CBC4BA;
    --iron-400:#A9A096; --iron-500:#857C72; --iron-600:#6A625A;
    --iron-700:#524B45; --iron-800:#3A3531; --iron-900:#262220;
    --iron-950:#171412; --iron-1000:#0E0C0B;

    --ember-50:#FFF8EB;  --ember-100:#FFEDC7; --ember-200:#FED88A;
    --ember-300:#FCBF4D; --ember-400:#F8A81C; --ember-500:#E88C05;
    --ember-600:#C86F03; --ember-700:#A15307; --ember-800:#83420D;
    --ember-900:#6E370F; --ember-950:#401B03;

    --blueprint-50:#EEF4FF;  --blueprint-100:#DAE6FF; --blueprint-200:#BDD2FF;
    --blueprint-300:#90B4FF; --blueprint-400:#5C8CFA; --blueprint-500:#3667EF;
    --blueprint-600:#244BD4; --blueprint-700:#1E3CAB; --blueprint-800:#1E3486;
    --blueprint-900:#1E2F6B; --blueprint-950:#151E42;

    --verdant-50:#ECFDF3; --verdant-100:#D1FADF; --verdant-300:#6CE9A6;
    --verdant-400:#32D583; --verdant-500:#12B76A; --verdant-600:#039855;
    --verdant-700:#027A48; --verdant-900:#054F31; --verdant-950:#032D1E;

    --rust-50:#FEF2F2; --rust-100:#FEE2E2; --rust-300:#FCA5A5;
    --rust-400:#F87171; --rust-500:#EF4444; --rust-600:#DC2626;
    --rust-700:#B4231C; --rust-900:#7A1B18; --rust-950:#450A0A;

    /* ---------- TIER 2 — SEMANTIC (LIGHT) ---------- */

    /* surfaces */
    --surface-canvas:        var(--iron-25);   /* page background      */
    --surface-default:       var(--iron-0);    /* cards, panels        */
    --surface-raised:        var(--iron-0);    /* popovers, dropdowns  */
    --surface-overlay:       var(--iron-0);    /* dialogs, sheets      */
    --surface-sunken:        var(--iron-50);   /* wells, code, stripes */
    --surface-hover:         var(--iron-100);
    --surface-active:        var(--iron-200);
    --surface-selected:      var(--ember-50);
    --surface-disabled:      var(--iron-100);
    --surface-scrim:         rgb(23 20 18 / 0.45);

    /* text */
    --text-primary:          var(--iron-900);
    --text-secondary:        var(--iron-600);
    --text-tertiary:         var(--iron-500);  /* ≥18.66px or non-text only */
    --text-disabled:         var(--iron-400);
    --text-inverse:          var(--iron-25);
    --text-on-brand:         var(--iron-950);  /* dark-on-amber, 8.5:1     */
    --text-link:             var(--blueprint-600);
    --text-link-hover:       var(--blueprint-700);
    --text-brand:            var(--ember-700); /* amber text on light, 5.0:1 */

    /* borders */
    --border-subtle:         var(--iron-200);
    --border-default:        var(--iron-300);
    --border-strong:         var(--iron-400);
    --border-brand:          var(--ember-500);
    --border-focus:          var(--blueprint-500);

    /* brand / interactive */
    --brand-solid:           var(--ember-500);
    --brand-solid-hover:     var(--ember-600);
    --brand-solid-active:    var(--ember-700);
    --brand-subtle:          var(--ember-50);
    --brand-subtle-hover:    var(--ember-100);
    --brand-border:          var(--ember-300);
    --brand-text:            var(--ember-700);

    /* status — surface / border / text / solid */
    --success-surface:var(--verdant-50);  --success-border:var(--verdant-300);
    --success-text:var(--verdant-700);    --success-solid:var(--verdant-600);
    --warning-surface:var(--ember-50);    --warning-border:var(--ember-300);
    --warning-text:var(--ember-800);      --warning-solid:var(--ember-600);
    --danger-surface:var(--rust-50);      --danger-border:var(--rust-300);
    --danger-text:var(--rust-700);        --danger-solid:var(--rust-600);
    --info-surface:var(--blueprint-50);   --info-border:var(--blueprint-200);
    --info-text:var(--blueprint-700);     --info-solid:var(--blueprint-600);

    /* enrollment status (domain-specific, maps to schema enum) */
    --status-pending:   var(--ember-600);
    --status-approved:  var(--verdant-600);
    --status-rejected:  var(--rust-600);
    --status-withdrawn: var(--iron-500);

    /* data-viz — ordered, hue-distinct, AA on canvas, colorblind-safe */
    --viz-1:#244BD4; --viz-2:#E88C05; --viz-3:#039855; --viz-4:#7A5AF8;
    --viz-5:#DC2626; --viz-6:#0E9384; --viz-7:#B4231C; --viz-8:#857C72;
    --viz-grid: var(--iron-200);
    --viz-axis: var(--iron-500);

    /* ---------- TYPOGRAPHY ---------- */
    --font-display: "Bricolage Grotesque Variable", "Inter Variable",
                    system-ui, sans-serif;
    --font-sans:    "Inter Variable", system-ui, -apple-system,
                    "Segoe UI", sans-serif;
    --font-mono:    "IBM Plex Mono", ui-monospace, "SF Mono",
                    Menlo, monospace;

    --text-2xs:  0.6875rem; /* 11 — table micro-labels, uppercase eyebrows */
    --text-xs:   0.75rem;   /* 12 — badges, captions, table meta           */
    --text-sm:   0.8125rem; /* 13 — dense table cells, secondary UI        */
    --text-base: 0.875rem;  /* 14 — DEFAULT UI SIZE                        */
    --text-md:   1rem;      /* 16 — body copy, form inputs, chat messages  */
    --text-lg:   1.125rem;  /* 18 — card titles, lead-in                   */
    --text-xl:   1.375rem;  /* 22 — section headings                       */
    --text-2xl:  1.75rem;   /* 28 — page titles                            */
    --text-3xl:  2.25rem;   /* 36 — marketing sub-heads                    */
    --text-4xl:  3rem;      /* 48 — marketing heads                        */
    --text-5xl:  4rem;      /* 64 — hero (desktop)                         */

    --leading-tight:1.15; --leading-snug:1.3; --leading-normal:1.5;
    --leading-relaxed:1.65;

    --tracking-tighter:-0.03em; /* display ≥36px */
    --tracking-tight:-0.015em;  /* headings 20–32px */
    --tracking-normal:0em;
    --tracking-wide:0.06em;     /* uppercase eyebrows / table headers */

    --weight-regular:400; --weight-medium:500;
    --weight-semibold:600; --weight-bold:700;

    /* ---------- SPACING (4px base) ---------- */
    --space-0:0; --space-px:1px;
    --space-1:0.25rem;  --space-2:0.5rem;  --space-3:0.75rem;
    --space-4:1rem;     --space-5:1.25rem; --space-6:1.5rem;
    --space-8:2rem;     --space-10:2.5rem; --space-12:3rem;
    --space-16:4rem;    --space-20:5rem;   --space-24:6rem;
    --space-32:8rem;

    /* ---------- RADII (Workshop = tight, machined) ---------- */
    --radius-xs:2px;   /* chips, tag corners      */
    --radius-sm:4px;   /* inputs, small buttons   */
    --radius-md:6px;   /* buttons, selects        */
    --radius-lg:8px;   /* cards, table container  */
    --radius-xl:12px;  /* dialogs, sheets         */
    --radius-2xl:16px; /* marketing feature cards */
    --radius-full:9999px;

    /* ---------- ELEVATION (crisp + warm-tinted, not soft blue blur) ---------- */
    --shadow-0:none;
    --shadow-1:0 1px 2px 0 rgb(23 20 18 / 0.05);
    --shadow-2:0 1px 3px 0 rgb(23 20 18 / 0.07),
               0 1px 2px -1px rgb(23 20 18 / 0.06);
    --shadow-3:0 4px 8px -2px rgb(23 20 18 / 0.08),
               0 2px 4px -2px rgb(23 20 18 / 0.05);
    --shadow-4:0 12px 20px -6px rgb(23 20 18 / 0.12),
               0 4px 8px -4px rgb(23 20 18 / 0.06);
    --shadow-5:0 24px 48px -12px rgb(23 20 18 / 0.18);
    --shadow-focus:0 0 0 2px var(--surface-canvas),
                   0 0 0 4px var(--border-focus);

    /* ---------- MOTION ---------- */
    --dur-instant:80ms;   /* hover/active color                       */
    --dur-fast:140ms;     /* tooltips, chips, checkbox                */
    --dur-normal:200ms;   /* dropdowns, popovers, tabs                */
    --dur-slow:280ms;     /* dialogs, sheets, drawers                 */
    --dur-slower:420ms;   /* page/route transitions, hero reveals     */

    --ease-standard:cubic-bezier(0.2,0,0,1);      /* default in/out */
    --ease-out:cubic-bezier(0.16,1,0.3,1);        /* enter — decelerate hard */
    --ease-in:cubic-bezier(0.5,0,0.75,0);         /* exit */
    --ease-spring:cubic-bezier(0.34,1.4,0.64,1);  /* chat bubble, toast */

    /* ---------- LAYOUT ---------- */
    --shell-topbar-h:56px;
    --shell-sidebar-w:264px;
    --shell-rail-w:72px;
    --content-max-w:1440px;
    --content-gutter:var(--space-6);
    --prose-max-w:68ch;

    /* ---------- DENSITY (swapped by [data-density="compact"]) ---------- */
    --row-h:44px;
    --control-h:36px;
    --control-h-sm:28px;
    --control-h-lg:44px;
    --cell-px:var(--space-4);
  }

  [data-density="compact"] {
    --row-h:36px;
    --control-h:32px;
    --cell-px:var(--space-3);
  }

  /* ============ TIER 2 — SEMANTIC (DARK) ============
     Only semantic tokens are redefined. Primitives never change.
     Guarded so an explicit light choice always wins.               */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { /* @apply dark tokens */ }
  }

  :root[data-theme="dark"],
  .dark {
    --surface-canvas:   var(--iron-1000);
    --surface-default:  #161311;      /* +1 elevation via lightness  */
    --surface-raised:   #1D1917;
    --surface-overlay:  #221D1A;
    --surface-sunken:   #100E0D;
    --surface-hover:    #262220;
    --surface-active:   #2F2A27;
    --surface-selected: #2A1F10;      /* ember-tinted */
    --surface-disabled: #1D1917;
    --surface-scrim:    rgb(0 0 0 / 0.65);

    --text-primary:   #F4F1ED;
    --text-secondary: #B3ABA1;
    --text-tertiary:  #8B8279;
    --text-disabled:  #5C554F;
    --text-inverse:   var(--iron-950);
    --text-on-brand:  var(--iron-1000);
    --text-link:      var(--blueprint-300);
    --text-link-hover:var(--blueprint-200);
    --text-brand:     var(--ember-300);

    --border-subtle:  #2A2522;
    --border-default: #383230;
    --border-strong:  #4A433F;
    --border-brand:   var(--ember-400);
    --border-focus:   var(--blueprint-400);

    --brand-solid:       var(--ember-400);  /* brighter in dark */
    --brand-solid-hover: var(--ember-300);
    --brand-solid-active:var(--ember-500);
    --brand-subtle:      #2A1F10;
    --brand-subtle-hover:#382812;
    --brand-border:      #5A431A;
    --brand-text:        var(--ember-300);

    --success-surface:#0B2A1B; --success-border:#1C5136;
    --success-text:var(--verdant-300); --success-solid:var(--verdant-500);
    --warning-surface:#2A1F10; --warning-border:#5A431A;
    --warning-text:var(--ember-300);    --warning-solid:var(--ember-500);
    --danger-surface:#2C1414;  --danger-border:#5B2320;
    --danger-text:var(--rust-300);      --danger-solid:var(--rust-500);
    --info-surface:#14203F;    --info-border:#25386E;
    --info-text:var(--blueprint-300);   --info-solid:var(--blueprint-500);

    --status-pending:var(--ember-300);   --status-approved:var(--verdant-300);
    --status-rejected:var(--rust-300);   --status-withdrawn:var(--iron-500);

    --viz-1:#7EA2FF; --viz-2:#F8A81C; --viz-3:#4ADE9B; --viz-4:#A78BFA;
    --viz-5:#F87171; --viz-6:#2DD4BF; --viz-7:#FB923C; --viz-8:#A9A096;
    --viz-grid:#2A2522; --viz-axis:#8B8279;

    /* dark elevation comes from lightness, not shadow */
    --shadow-1:0 1px 2px 0 rgb(0 0 0 / 0.4);
    --shadow-2:0 1px 3px 0 rgb(0 0 0 / 0.5);
    --shadow-3:0 4px 10px -2px rgb(0 0 0 / 0.55);
    --shadow-4:0 12px 24px -6px rgb(0 0 0 / 0.6);
    --shadow-5:0 24px 56px -12px rgb(0 0 0 / 0.7);
  }

  /* ---------- BASE RESET (replaces index.css:7-14) ---------- */
  html { -webkit-text-size-adjust:100%; }
  body {
    background: var(--surface-canvas);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: var(--text-md);
    line-height: var(--leading-normal);
    font-feature-settings:"cv05" 1,"ss01" 1; /* Inter: single-storey g, alt a */
    -webkit-font-smoothing:antialiased;
  }
  /* NEVER put font-family or transition on *  */

  h1,h2,h3,h4 { font-family:var(--font-display); letter-spacing:var(--tracking-tight); }
  .tabular    { font-family:var(--font-mono); font-variant-numeric:tabular-nums; }

  :where(a,button,input,select,textarea,[tabindex]):focus-visible {
    outline:none; box-shadow:var(--shadow-focus); border-radius:var(--radius-sm);
  }

  @media (prefers-reduced-motion: reduce) {
    *,*::before,*::after {
      animation-duration:0.01ms !important; animation-iteration-count:1 !important;
      transition-duration:0.01ms !important; scroll-behavior:auto !important;
    }
  }
}

/* Signature detail: technical-drawing corner ticks on key panels */
.panel-ticks { position:relative; }
.panel-ticks::before,.panel-ticks::after{
  content:""; position:absolute; width:10px; height:10px; pointer-events:none;
  border-color:var(--border-brand);
}
.panel-ticks::before{ top:-1px; left:-1px; border-top:1.5px solid; border-left:1.5px solid; }
.panel-ticks::after { bottom:-1px; right:-1px; border-bottom:1.5px solid; border-right:1.5px solid; }
```

### 3.4 Tailwind v4 wiring

```css
/* src/styles/index.css */
@import "tailwindcss";
@import "./tokens.css";

@theme inline {
  --color-canvas:   var(--surface-canvas);
  --color-surface:  var(--surface-default);
  --color-raised:   var(--surface-raised);
  --color-sunken:   var(--surface-sunken);
  --color-fg:       var(--text-primary);
  --color-fg-muted: var(--text-secondary);
  --color-fg-subtle:var(--text-tertiary);
  --color-line:     var(--border-subtle);
  --color-line-strong: var(--border-default);
  --color-brand:    var(--brand-solid);
  --color-on-brand: var(--text-on-brand);
  --font-sans:      var(--font-sans);
  --font-display:   var(--font-display);
  --font-mono:      var(--font-mono);
  --radius-lg:      var(--radius-lg);
  /* …etc */
}
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *, .dark, .dark *));
```

**Lint rule to enforce:** ban raw hex, `bg-blue-*`, `text-gray-*`, and inline `style={{color|background}}` in `src/**` via `eslint-plugin-tailwindcss` + a small custom rule. The 213 hardcoded hexes came back once; don't let them come back twice.

### 3.5 Typography — the actual pairing

| Role | Family | Why | Source |
|---|---|---|---|
| **Display** (≥28px only) | **Bricolage Grotesque Variable** | Variable width + optical size. Slightly industrial, a touch of character in the `a`/`g`/`R`, and it does *not* look like every other Inter headline. Tighten to `--tracking-tighter` at hero sizes. | `@fontsource-variable/bricolage-grotesque` (OFL) |
| **UI + body** | **Inter Variable** | The correct boring choice for a dense product. Enable `cv05` (single-storey g) + `ss01` for a slightly warmer, less-default Inter. | `@fontsource-variable/inter` (OFL) |
| **Data / codes / time** | **IBM Plex Mono** | Tabular figures for capacity `18/30`, enrollment IDs, timestamps, course codes. This is the detail that makes tables read like instrument panels. | `@fontsource/ibm-plex-mono` (OFL) |

Self-host all three via `@fontsource*`. **No Google Fonts `<link>`** — it's a render-blocking third-party request on the login page, and the audit already flags an Unsplash hotlink at `AuthLayout.tsx:126` that must also die.

*If a quieter display face is preferred:* swap Bricolage for **Instrument Sans** (also free, OFL). If budget exists later, **Söhne** or **Untitled Sans** for display is the upgrade path — the token indirection means it's a one-line change.

**Type scale in use:**

| Token | px | Family / weight / tracking | Where |
|---|---|---|---|
| `--text-5xl` | 64 | Display 700 / tighter | landing hero (desktop) |
| `--text-4xl` | 48 | Display 700 / tighter | landing section heads |
| `--text-3xl` | 36 | Display 600 / tighter | course detail title |
| `--text-2xl` | 28 | Display 600 / tight | page titles in app |
| `--text-xl` | 22 | Display 600 / tight | card group headings |
| `--text-lg` | 18 | Sans 600 / normal | card titles, stat values |
| `--text-md` | 16 | Sans 400 / normal | body, inputs, chat |
| `--text-base` | 14 | Sans 400/500 | default UI, buttons, nav |
| `--text-sm` | 13 | Sans 400 | dense table cells |
| `--text-xs` | 12 | Sans 500 | badges, captions |
| `--text-2xs` | 11 | Sans 600 / wide / uppercase | table headers, eyebrows |

Fluid hero: `font-size: clamp(2.5rem, 6vw, 4rem)`.

---

## 4. Layout system

### 4.1 App shell

```
┌───────────────────────────────────────────────────────────────────┐
│ TOPBAR  56px  · surface-default · border-bottom: 1px border-subtle │
│ [☰]  Millat ▸ Courses ▸ Web Dev   [⌘K search…]   [🔔3] [◐] [avatar]│
├──────────────┬────────────────────────────────────────────────────┤
│ SIDEBAR 264  │ CONTENT                                            │
│ surface-     │ background: surface-canvas                         │
│ default      │ ┌────────────────────────────────────────────────┐ │
│ border-right │ │ PAGE HEADER                                    │ │
│              │ │  H1 (28px display)          [secondary][primary]│ │
│ ▸ workspace  │ │  description (14px, fg-muted)                  │ │
│   chip       │ ├────────────────────────────────────────────────┤ │
│              │ │ content — max-width 1440, gutter 24            │ │
│ Dashboard    │ │                                                │ │
│ My Courses   │ │                                                │ │
│ Resources ⁵  │ │                                                │ │
│ Messages  ³  │ │                                                │ │
│ ──────────   │ │                                                │ │
│ Profile      │ └────────────────────────────────────────────────┘ │
│              │                                                    │
│ [user card]  │                                                    │
└──────────────┴────────────────────────────────────────────────────┘
```

**Concrete rules:**
- Topbar is `position: sticky; top: 0`. **Not** `position: fixed` with `width: 100vw` — the current `AppLayout.scss:11-16` does exactly that, and `100vw` includes the scrollbar gutter, which is why there's horizontal overflow on desktop today.
- Sidebar: `surface-default` with a `1px solid var(--border-subtle)` right edge. **Delete the `from-blue-700 to-blue-300` gradient.** A colored sidebar is the single loudest "template" signal in the current UI, it can't theme, and it fights every piece of content next to it.
- Nav item: 36px tall, 8px radius, `--text-base`/500, 18px lucide icon, 10px gap. Active = `--surface-selected` fill + `--text-brand` label + **3px Ember left bar** (inset 6px top/bottom, radius 2px). Hover = `--surface-hover`.
- Nav counts (unread messages, pending approvals) as right-aligned `--text-2xs` mono pills.
- Sidebar footer: user card (avatar 32 + name + role chip) opening a Radix DropdownMenu (Profile / Theme / Density / Sign out).
- Content region gets `--surface-canvas`; cards get `--surface-default` + `1px --border-subtle` + `--shadow-1`. **Elevation comes from the border, not the blur** — that's the Workshop discipline. Reserve `--shadow-3` and up for genuinely floating things (popovers, dialogs, drag).

### 4.2 Navigation across three roles

**Decision: identical chrome for all three roles. Do not color-code roles.** Role-tinting the shell fragments the brand, doubles the QA surface, and looks like an unfinished multi-tenant product. Role is expressed by:

1. **A workspace chip** at the top of the sidebar: a 24px square Ember-tinted tile with an initial + the role word in `--text-2xs` uppercase wide (`STUDENT` / `INSTRUCTOR` / `ADMINISTRATION`).
2. **Different nav content** (driven by the existing `menus.tsx`, which is already data-driven and worth keeping).
3. **Different default landing route.**

| | Student | Teacher | Admin |
|---|---|---|---|
| Nav | Dashboard · My Courses · Browse Catalog · Resources · Messages · Profile | Dashboard · My Courses · Resources · Enrollment Requests · Messages · Profile | Overview · Departments · Courses · Instructors · Students · News & Events · Messages · Settings |
| Topbar extra | — | "Pending approvals" count pill | Density toggle, global search scoped to all entities |
| Primary CTA color | Ember (Enroll) | Ember (New resource) | Ember (New department/course) |

Admin gets a **secondary nav group** with a `--text-2xs` uppercase `--tracking-wide` "MANAGE" label above the CRUD entities, separated by a hairline — because admin has 8 items and unlabeled 8-item lists scan badly.

### 4.3 Breakpoints and what changes

| Token | Width | Shell | Content |
|---|---|---|---|
| `xs` | <480 | No sidebar. Bottom tab bar (4 items + More) OR hamburger → Radix `Sheet` from left. Topbar 52px, wordmark only. | Single column. **Tables become card lists** — never a horizontally scrolling table on phones. Filter bar collapses to a single "Filters (2)" button opening a bottom Sheet. Dialogs become full-height bottom sheets. |
| `sm` | 480–767 | Same as xs, 2-col stat grid. | Stat cards 2-up. |
| `md` | 768–1023 | Sidebar hidden, opens as overlay Sheet. Topbar shows breadcrumb. | 2-column content. Tables show 4–5 priority columns with a "…" row-expander for the rest. |
| `lg` | 1024–1279 | **72px icon rail** persistent, labels in tooltip on hover, expands to 264px on click (state persisted). | 3-column stat grids. Tables show 6–7 columns. |
| `xl` | 1280–1535 | Full 264px sidebar, expanded by default. | 4-column stat grid. Full tables. Chat = 3 panes (list / thread / detail). |
| `2xl` | ≥1536 | Same; content centered at `--content-max-w` 1440 with symmetric gutters. | Course catalog goes 4-up. |

**Chat responsive rule specifically:** ≥1280 = list + thread side by side (360 / flex). 1024–1279 = list 300 + thread. <1024 = **single pane with a stack transition** — list is the route, tapping a conversation pushes the thread with a back arrow. Do not try to fit two panes on a phone.

### 4.4 Density

Two modes, `data-density="comfortable" | "compact"` on `<html>`, persisted per user. Comfortable is default everywhere; admin table pages default to compact and expose the toggle in the topbar. This is a 3-token swap (`--row-h`, `--control-h`, `--cell-px`) and it makes the admin screens look like a tool someone uses for eight hours rather than a demo.

---

## 5. Component inventory

**Legend:** 🟢 exists in usable form · 🟡 exists but must be rebuilt · 🔴 does not exist

### Foundations

| Component | Status today | Build notes |
|---|---|---|
| **Button** | 🟡 144 AntD call sites + 1 raw `<button>` at `ExploreCourses.tsx:327` | 5 variants (`primary` Ember/dark-text, `secondary` outline, `ghost`, `destructive`, `link`), 3 sizes, `loading` with spinner replacing the icon slot, `icon-only` requires `aria-label` (enforce via TS: `IconButtonProps` makes it required). |
| **Input / Textarea / Select / Combobox** | 🟡 AntD Form in 31 files | Radix Select + `cmdk` Combobox for department pickers. 36px height, `--radius-sm`, `--border-default`, focus = `--shadow-focus`. Prefix/suffix slots. |
| **Checkbox / Radio / Switch** | 🟡 | Radix. Ember fill when checked, dark check glyph. |
| **Label / FormField / FormError** | 🔴 **zero `<label>` or `htmlFor` in 120 tsx files** | `FormField` wrapper wires `id`/`aria-describedby`/`aria-invalid` automatically. Error = `--danger-text` + 14px `AlertCircle`, `role="alert"`. |
| **Tooltip / Popover / DropdownMenu** | 🟡 AntD Dropdown | Radix. 140ms fade+2px rise. |
| **Dialog / Sheet / AlertDialog** | 🟡 13 AntD Modals | Radix Dialog; below `md` a Dialog auto-swaps to a bottom Sheet (85vh, drag handle). AlertDialog for destructive confirms — replaces the hand-rolled `showDeleteConfirm` duplicated in `TeacherTable`/`StudentTable`. |
| **Tabs / Accordion / Separator** | 🟡 `Tabs.TabPane` deprecated in `StudentProfile` | Radix. Tab indicator is a 2px Ember underline animated via `layoutId` (motion). |

### Data & feedback

| Component | Status today | Build notes |
|---|---|---|
| **DataTable** | 🟡 `components/common/Table/Table.tsx` exists but its column map at `:25-29` is a pure type cast and **no page imports it**; all 5 tables use AntD directly | TanStack Table v8. Sticky header (`--surface-sunken`, `--text-2xs` uppercase wide), 44/36px rows, zebra via `--surface-sunken` at 50% or off (prefer hairlines), row hover, checkbox column, sortable headers with chevron, column visibility menu, sticky first + last column, pinned bulk-action bar sliding up from the bottom when rows are selected. **Numeric cells use `.tabular`.** |
| **FilterBar** | 🟡 7 near-identical `*Filter.tsx` (575 LOC); `TeacherFilter` and `StudentFilter` differ by 6 of 77 lines | One config-driven component: `fields: [{type:'search'|'select'|'daterange'|'toggle', ...}]`. Active filters render as removable chips beneath. "Clear all" appears only when ≥1 filter active. |
| **Pagination** | 🟡 | Page-size select + range readout (`21–40 of 187`) in mono + prev/next + jump. |
| **EmptyState** | 🟡 19 files use AntD `<Empty>` with a bare string and no CTA | Illustration slot (a small inline-SVG technical line drawing — a caliper, a blueprint sheet, an empty tray — 96px, stroked in `--border-strong`), heading 16/600, body 14 muted, one primary CTA, one secondary link. **Three variants:** `empty` (nothing yet), `no-results` (filters too narrow → "Clear filters" CTA), `error` (retry CTA). Today all three collapse to "No data available" — that conflation is why a failed request currently looks identical to an empty table. |
| **Skeleton** | 🟡 `<Spin>` in 22 files, `<Skeleton>` in only 7, plus a bespoke spinner at `Router.tsx:10-14` | Skeletons must **mirror the final layout** — `TableSkeleton(rows, cols)`, `CardGridSkeleton(n)`, `StatRowSkeleton`, `ChatSkeleton`. Shimmer = 1.4s linear gradient sweep, disabled under `prefers-reduced-motion`. Replace the full-page `<Spin>` on `ExploreCourses.tsx:198-202` — it currently collapses a 9-card grid to a centered spinner and back, which is severe CLS on the main public page. |
| **Toast** | 🟡 `App.useApp()` notification (correctly the modern AntD API — good instinct) | `sonner`. Bottom-right desktop / top mobile, 8px radius, left status rule, icon, optional Undo action. Never for form validation (that's inline). |
| **AsyncBoundary** | 🔴 | `<AsyncBoundary query={q} skeleton={<TableSkeleton/>} empty={<EmptyState/>}>` — one wrapper handling loading/error/empty so pages stop doing `?.data?.items \|\| []`, which silently converts "request failed" into "no data" (currently the case in `AdminDashboard.tsx:44-53`). |
| **ErrorBoundary** | 🔴 zero in the app | Top-level + per-route. Renders the existing `ServerError` page component, which today is only reachable by manually typing `/500`. |

### Identity & status

| Component | Status | Notes |
|---|---|---|
| **Avatar** | 🟡 AntD | Image → initials fallback on a deterministic tint derived from a name hash (pick from a 6-color muted set, never Ember). Sizes 20/24/32/40/64. `AvatarGroup` with `+N` overflow. |
| **Badge / Chip** | 🟡 `<Tag>`; note `RecentNewsEvents.tsx:81` passes an invalid `size` prop | `StatusChip` maps the `EnrollmentStatus` enum → `--status-*` tokens. Dot + label, never color alone. Also `CountBadge` (mono, nav counts) and `RoleChip`. |
| **PresenceDot** | 🔴 | 8px dot, 2px canvas-colored ring, on avatars in chat. |

### Domain

| Component | Status | Notes |
|---|---|---|
| **Chart primitives** | 🔴 **zero charting library installed** | Recharts + shadcn `ChartContainer`. Four primitives: `AreaTrend` (enrollments over time), `BarCompare` (per-department), `DonutBreakdown` (enrollment status mix), `Sparkline` (inline in stat cards). Grid `--viz-grid`, axis `--viz-axis`, series `--viz-1..8`, **no gradient fills, no 3D, no drop shadows**. Tooltip is the same popover surface as everywhere else. |
| **StatCard** | 🟡 `StatisticsCard.tsx` exists **twice, byte-identical**, in admin and teacher dashboards | One component. Label (`--text-2xs` uppercase wide, muted), value (`--text-2xl` display, or mono if it's a count), delta chip (`↑ 12%` in `--success-text`), 40px sparkline. Optional Ember left rule for the "primary" metric. |
| **CourseCard** | 🟡 | 16:9 cover (or a generated blueprint-pattern placeholder keyed off department), department chip, title (18/600, 2-line clamp), instructor row (24px avatar + name), meta row in mono (`12 weeks · 18/30 seats`), capacity progress bar, footer CTA. |
| **MessageThread / Composer / ConversationList** | 🟡 built **three times** — student, teacher, and an orphaned admin set; `MessageInput.scss` is byte-identical between student and teacher, `conversations.scss` differs in 4 of 252 lines | One role-parameterized module. Detail in §6.6. Drop the WhatsApp palette (`#dcf8c6`, `#111b21`, `#667781`) — it has no relationship to this brand. |
| **CommandPalette** | 🔴 | `cmdk` on `⌘K`/`Ctrl+K`. Groups: Navigate, Courses, People (admin), Actions, Theme. This is the single cheapest "this is a real product" signal in the whole list — half a day of work, and it's the first thing a reviewer tries. |
| **PageHeader** | 🔴 — every page hand-rolls `<div className="p-6">` + Title + flex row (compare `AdminDashboard.tsx:56-59` with `AdminNewsEvents.tsx:223-231`) | Breadcrumb + H1 + description + action slot + optional tabs row. |
| **CrudPage / useCrudResource** | 🔴 | The container that collapses `AdminDepartments`(176) + `AdminTeachers`(174) + `AdminStudents`(153) + `AdminNewsEvents`(263) into one. Owns filter state, dialog state, and the create/update/delete mutation trio. |
| **ThemeToggle** | 🟡 `ThemeContext` exists; **no UI anywhere calls it** | Segmented Light/Dark/System control in the user menu. |

**~26 components. About 18 are shadcn `add` + retheme; ~8 are genuinely custom.**

---

## 6. Page-by-page art direction

### 6.1 Marketing landing (`/`) — highest priority, it's the README hero

Currently: a `from-blue-500 to-purple-600` full-viewport hero with a 226 KB JPEG at 20% opacity, emoji badges (🎓🌟🌱), an IntersectionObserver that fades sections *back out* on scroll-away (`Home.tsx:60-78`) so content flickers, ~80 lines of commented-out contact form leaving a lopsided half-empty row, and placeholder contact data (`+92 123 456 7890`, `info@millatvocational.edu`).

**New structure, top to bottom:**

1. **Sticky nav, 64px.** Transparent over the hero → on scroll past 80px, gains `--surface-default` + `backdrop-blur(8px)` + hairline bottom border (animate, 200ms). Left: wordmark (Bricolage 18/700) + a 20px Ember mark. Right: Programs · About · News · [Sign in] · [**Apply now** — Ember].

2. **Hero — asymmetric split, not centered.** 60/40 grid, **not** full-viewport-height (full-height heroes push everything below the fold and are the #1 template tell).
   - Left: eyebrow `--text-2xs` uppercase wide Ember `EST. 2015 · 12 TRADE PROGRAMS`; H1 `clamp(2.5rem,6vw,4rem)` Bricolage 700 tracking-tighter, two lines max — *"Learn a trade. Earn a certificate. Get to work."* ; sub 18/relaxed muted, `--prose-max-w`; two CTAs (Ember primary "Browse programs", ghost "How enrolment works"); below, a hairline-separated stat strip in **mono**: `1,200+ graduates · 12 programs · 94% placement`.
   - Right: a **stacked product screenshot** — the student dashboard at a slight rotation with a real device-frame shadow (`--shadow-5`), partially bleeding off the right edge. Behind it, a very low-opacity blueprint grid SVG (1px `--border-subtle` lines, 32px pitch) as the only background texture. This one move does more than any illustration: it shows the product on the landing page.
   - Background: `--surface-canvas` warm paper. **No gradient. No purple.**

3. **Trust strip.** 56px, hairline top+bottom, grayscale partner/accreditation marks at 60% opacity. If real logos don't exist, use text lozenges (`ACCREDITED · TVET AUTHORITY`) rather than fake logos.

4. **Programs — 3-up card grid.** Real course data from the seed. Cards use the `CourseCard` component so the landing and the catalog visibly share a system. Section head 48px Bricolage, left-aligned, with a 40px Ember rule above it.

5. **How it works — 3 numbered steps**, horizontal on desktop. Big mono numerals (`01` `02` `03`) in `--text-4xl` `--border-strong`, connected by a 1px dashed rule. Titles: *Choose a program · Request enrolment · Start learning*. Replaces the emoji badges entirely.

6. **Feature split ×2, alternating.** Left screenshot / right copy, then reversed. Feature 1: "Everything for a course in one place" (resources + threaded comments screenshot). Feature 2: "Talk to your instructor" (chat screenshot with a typing indicator visible). Copy blocks max `--prose-max-w`, each with a 3-item checklist using 16px `Check` icons in `--success-text`.

7. **News & Events — 3-up.** *This finally gives the fully-built-but-unreachable news API a UI.* Date in mono, type chip, title, 2-line excerpt.

8. **CTA band.** Full-bleed `--iron-900` (dark, even in light theme — a deliberate contrast beat), reversed text, Ember button. Blueprint grid at 4% opacity.

9. **Footer.** 4 columns + a bottom hairline row. Real contact data or clearly-labeled demo data — never `123 Education Street`.

**Motion:** `motion` `whileInView` with `viewport={{ once: true }}`, 24px rise + fade, 60ms stagger, `--ease-out`. `once: true` structurally fixes the flicker bug. Nav scroll state via `useScroll`. All of it disabled under `prefers-reduced-motion`.

**Images:** convert the 5 JPEGs (~989 KB) to AVIF+WebP with `<picture>`, add explicit `width`/`height` and `loading="lazy"` below the fold. The 226 KB hero image displayed at 20% opacity gets deleted outright.

---

### 6.2 Course catalog (`/explore-courses`)

**Layout:** left rail filters (240px, sticky, `--surface-default`, hairline right) + results grid. Below `lg`, filters collapse to a `Filters (2)` button → bottom Sheet.

- **Toolbar row:** search input (with a `Search` icon prefix and a debounced clear), result count in mono (`24 programs`), sort select, and a grid/list view toggle.
- **Filter rail:** Department (checkbox list with counts), Duration (range), Availability (Open seats / Waitlist), Level. Each group collapsible; applied filters mirror as removable chips above the grid.
- **Grid:** 3-up at `xl`, 2-up at `md`, 1-up below. 24px gap. `CourseCard` with:
  - 16:9 cover; when a course has no image, generate a **department-keyed blueprint pattern** (diagonal hatch / grid / dot in a muted department tint) rather than a gray box. Deterministic from `departmentId` so it's stable.
  - Department chip top-left over the cover, `--surface-overlay` with blur.
  - Title 18/600 clamped to 2 lines; instructor row; mono meta `12 weeks · Starts 4 Mar`.
  - **Capacity bar:** 4px track, `--brand-solid` fill, label `18/30 seats` in mono. Turns `--warning-solid` at ≥90%, and the card shows a `Nearly full` chip.
  - Footer: `View details` ghost + `Request enrolment` Ember (for signed-in students) / `Sign in to enrol` for guests.
- **Loading:** `CardGridSkeleton(9)` preserving exact card dimensions. **No layout collapse.**
- **Empty:** `no-results` variant with the caliper illustration, "No programs match these filters", and a `Clear all filters` button.
- Hover: `translateY(-2px)` + `--shadow-3`, 140ms. Fix the broken `styles.courseCard` reference (`ExploreCourses.module.css` defines `.course-card` kebab-case, so `styles.courseCard` is `undefined` today and the lift never fires — delete the CSS module entirely).

---

### 6.3 Course detail

Two-column, 8/4 at `xl`, stacked below `lg`.

- **Hero band:** full-width, `--surface-default`, 32px padding, hairline bottom. Breadcrumb → H1 (36px Bricolage) → instructor row (40px avatar, name, designation) → meta row of mono chips (`WEB-201 · 12 weeks · Mon/Wed 18:00 · 18/30`). Right-aligned action stack: primary enrolment button whose state is derived from `EnrollmentStatus` — `Request enrolment` / `Request pending` (disabled, Ember chip) / `Enrolled ✓` (Verdant) / `Rejected` (Rust, with a "Contact instructor" link).
- **Left column:** Radix Tabs — `Overview` · `Resources` · `Discussion` · `Classmates` (instructor also gets `Requests`). Tab indicator = 2px Ember underline animated with `layoutId`.
  - *Overview:* prose at `--prose-max-w`, `--text-md`/relaxed. Syllabus as a downloadable file row.
  - *Resources:* a **file row list**, not cards — 56px rows, 32px type icon on a tinted square keyed to type (PDF Rust-tint, video Blueprint-tint, link Iron-tint), title + size + uploaded-by + relative date, right-aligned comment count + kebab menu. Private resources get a `Lock` icon and a `Enrolled only` chip.
  - *Discussion:* threaded comments (the schema already has `parentId`/`replies`) — 32px avatar, name + role chip + relative time, body, `Reply · Edit · Delete` on hover only. Nesting max depth 2, indented 40px with a 1px left rule. Composer pinned at top.
- **Right rail (sticky, 24px top):** capacity card (donut + seats in mono), schedule card, instructor card (avatar 64, bio 3 lines, `Message instructor` button that deep-links into chat), department card.

---

### 6.4 Dashboards

Shared skeleton for all three: `PageHeader` (greeting + date in mono) → stat row → primary panel → secondary panels. **All three use the same `StatCard` and the same grid.** Differences are content, not chrome.

**Student** — currently the only page in the app that handles loading/error/empty correctly (`StudentDashboard.tsx:38-52`); keep that behavior, restyle.
- Stat row (3): Enrolled courses · Pending requests · Unread messages.
- **"Continue" panel** — the emotional center. Wide card per active course: cover thumb 96×54, title, capacity/schedule mono meta, and a "Latest resource" row with a `Open` button. This is what makes the dashboard feel like a place you return to rather than a stats readout.
- Right rail: `Upcoming` (news/events by date, mono dates) + `Your instructors` (avatar list with quick-message buttons).

**Teacher**
- Stat row (4): Active courses · Total students · **Pending approvals** (Ember-ruled, the priority metric) · Unread messages.
- **Approval queue panel** — the highest-value screen in the whole app for a screenshot. A compact table: avatar + student name + enrollment no. (mono) + course + requested-at + inline `Approve` (Verdant ghost) / `Reject` (Rust ghost). Row approves with an optimistic strike-through + collapse, and a toast with **Undo**.
- `Enrollment trend` — 30-day `AreaTrend`, `--viz-1`, 1.5px stroke, 8% fill, no gradient.
- `Recent activity` — comments on your resources, newest first.

**Admin**
- Stat row (4): Students · Instructors · Courses · Departments, each with a 30-day sparkline and a delta chip. (Today these are four paginated list calls made only to read `.total` — replace with a real `/admin/stats` endpoint.)
- **Two charts side by side:** `Enrollments by month` (AreaTrend) and `Students per department` (horizontal BarCompare, sorted desc, value labels in mono at bar end).
- **Capacity table:** courses sorted by fill %, with an inline capacity bar per row — the most information-dense, most "real product" element on the page.
- Right rail: `Recent registrations` (avatar list) + `Draft news` (with publish toggles).

---

### 6.5 Auth (`/login`, `/register`, `/forgot-password`, `/verify-email`)

Currently: a hotlinked Unsplash background (`AuthLayout.tsx:126`), a runtime-injected `<style>` block of `!important` menu overrides including two malformed `// comment` lines in CSS, and a `setTimeout(300)/setTimeout(900)` classList animation whose magic numbers don't match the CSS durations they shadow.

**New:** 50/50 split. **Delete the Unsplash URL and the injected `<style>` block.**

- **Left (form), 480px max, vertically centered on `--surface-canvas`:** wordmark → H1 28px Bricolage ("Welcome back") → 14px muted sub → **role selector as a 3-up segmented control** (Student / Instructor / Administration) — keep the role-tinting *concept* from `Login.tsx:94-103`, but express it as an Ember-filled active segment rather than three different gradients → email + password (with a show/hide toggle) → "Forgot password?" right-aligned → full-width Ember submit → hairline `or` divider → "New here? Create an account".
- **Right (brand panel), hidden below `lg`:** `--iron-900` in both themes. Blueprint grid SVG at 6% opacity. A single rotating testimonial or program stat, set in Bricolage 28px, with a hairline-bordered attribution row. **Plus, in the demo build, the demo-account buttons** — `View as Student` / `View as Instructor` / `View as Administrator`, each a bordered row with an avatar and a role chip. Non-negotiable for the live demo (see §9).
- **Role switch animation:** `AnimatePresence` cross-fade + 8px horizontal slide, 200ms `--ease-out`, driven by the role key. Delete `login/styles.css` (223 lines, containing three character-identical rule pairs and a duplicated media block).
- **Register:** Radix-based stepper, 3 steps, with a mono progress readout `STEP 2 OF 3` and a 2px Ember progress rule. Replaces the deprecated `Steps.Step` children API.
- **Verify email:** centered card, 6 individual OTP boxes (48×56, mono, 24px), auto-advance, paste-to-fill, resend with a live countdown in mono.

---

### 6.6 Chat

The most technically impressive feature in the repo, currently the worst-served visually (WhatsApp's palette, three forked implementations, stale-closure bugs that break unread counts).

**Three panes at `xl`:**

| List (360) | Thread (flex) | Detail (280, toggle) |
|---|---|---|

- **List:** search + `New message` icon button at top. Rows 68px: 40px avatar with presence dot · name (15/600) · role chip · last-message preview (13, muted, 1 line, truncated) · right column: relative time in mono + unread count pill (Ember fill, dark text). Unread rows get a 2px Ember left bar and a `--surface-selected` tint. Active row `--surface-active`.
- **Thread header:** 56px, avatar + name + role + presence text (`Active now` / `Last seen 2h ago`), right: info toggle + kebab.
- **Message list:** `--surface-canvas` with the blueprint grid at 3% opacity — the one place a texture earns its keep.
  - **Bubbles:** own messages = `--brand-subtle` fill, `--text-primary`, right-aligned, `--radius-lg` with the bottom-right corner at `--radius-xs`. Others = `--surface-default` + `1px --border-subtle`, left-aligned, bottom-left corner at `--radius-xs`. **No tails** — the corner asymmetry does the job and removes the 149-vs-85-line `::before`/`::after` divergence between the two forked SCSS files. Max width `min(65%, 560px)`.
  - **Grouping:** consecutive messages from the same sender within 5 minutes collapse — avatar shown only on the first, 2px gap between grouped, 12px between groups, 24px + a centered hairline date divider between days.
  - **Meta:** time (mono, 11px) + read state inside the bubble's bottom-right, muted. Read = double `Check`, tinted `--text-brand` (not blue) at 14px.
  - **Send states:** optimistic bubble at 60% opacity → full on ack. Failure = Rust left rule + `Retry` inline.
- **Typing indicator:** three 6px dots, staggered 1.2s ease-in-out scale+opacity loop, in a bubble at the thread bottom. Announced via `aria-live="polite"` as "Sarah is typing".
- **Composer:** auto-growing textarea (1→6 rows), `--surface-default`, `--radius-lg`, 1px border that becomes `--border-brand` on focus. Attach + emoji on the left, send on the right (Ember circle, disabled when empty). `Enter` sends, `Shift+Enter` newlines, with a `--text-2xs` hint below on first use.
- **Detail rail:** participant card, shared course, shared resources list, `Search in conversation`.
- **Empty states:** no conversation selected → centered illustration + "Select a conversation" + `Start a new one`; no conversations at all → contacts derived from approved enrollments listed directly.
- **Accessibility:** the message list is `role="log" aria-live="polite" aria-relevant="additions"`, each message `role="article"` with an `aria-label` of "`{sender}, {time}`". This is currently zero — no `aria-live` in a real-time chat means screen readers never announce an incoming message.

---

## 7. Accessibility standards

**Target: WCAG 2.2 Level AA, verified in CI.** Current state is 0 `aria-*`, 0 `role=`, 0 `<label>`, 0 `htmlFor`, 0 `tabIndex`, and 0 `focus-visible` styles across 120 components — so this is a from-zero build, which is actually easier than a retrofit because Radix supplies most of it.

**Non-negotiables:**

1. **Contrast.** Body text ≥4.5:1, large text (≥18.66px or ≥14px bold) and UI components/graphics ≥3:1. Enforced by the token choices: `--text-primary` ≈14:1, `--text-secondary` ≈6.3:1, `--text-on-brand` on `--brand-solid` ≈8.5:1. **`--text-tertiary` (`Iron-500`, ~4.3:1) is not permitted for body text** — large text and icons only; the lint rule and the token comment both say so.
2. **Never color alone (1.4.1).** Every status chip = dot/icon + text label. Every chart series gets a direct label or a distinct dash pattern, not just a legend swatch. Form errors get an icon and text, not a red border alone.
3. **Focus visible (2.4.7 / 2.4.11).** A 2px `--border-focus` (Blueprint) ring with a 2px canvas-colored offset, on every interactive element, always. Blueprint is deliberately *not* the brand color so a focus ring is never mistaken for a selected/brand state. Focus is never removed, only restyled.
4. **Target size (2.5.8).** 24×24 CSS px minimum with adequate spacing; **44×44 is the design default** for anything primary. Table row kebab menus and chat action icons get a 40px hit area even if the glyph is 16px.
5. **Keyboard.** Everything reachable and operable. Radix handles Dialog focus trap + restore, DropdownMenu roving tabindex + typeahead, Tabs arrow keys. We add: skip-to-content link (first tab stop, visually hidden until focused), `⌘K` palette, `Esc` closes any overlay, `/` focuses search, arrow-key navigation in the conversation list.
6. **Semantics.** `<header>` / `<nav>` / `<main>` / `<aside>` / `<footer>` in the shell — `<main>` wraps `<Outlet/>`. One `<h1>` per page (the `PageHeader` owns it), no skipped levels. Currently the whole app has 9 semantic tags total.
7. **Names on icon-only controls.** Enforced at the type level: `IconButton` requires `aria-label`. This alone fixes the sidebar collapse toggle, the chat send button, and every table row action.
8. **Forms.** Every input has a `<label for>`. `aria-describedby` links help text and errors. `aria-invalid` on error. Errors summarized at the top of long forms with anchor links. Errors announced via `role="alert"`.
9. **Live regions.** Chat message list `aria-live="polite"`; toasts announced by sonner; table filter results announce "24 results" to a visually hidden live region.
10. **Motion (2.3.3).** All transform/opacity motion respects `prefers-reduced-motion` (the global block in §3.3). No parallax, no autoplaying carousels, nothing flashing >3Hz.
11. **Zoom / reflow (1.4.10, 1.4.4).** Usable at 320px width and 400% zoom without horizontal scroll. Requires `rem` sizing, no fixed pixel widths on content containers, and killing the `width: 100vw` in `AppLayout.scss:11-16`.
12. **Language & titles.** `<html lang="en">`, per-route `<title>` via a `useDocumentTitle` hook (currently `index.html:7` is still `Vite + React + TS`).

**Enforcement:**
- `eslint-plugin-jsx-a11y` at `error` in the shared config.
- `@axe-core/react` in dev — logs violations to console during development.
- `@axe-core/playwright` in CI on 6 key routes, both themes, failing the build on any serious/critical violation.
- Manual keyboard-only walkthrough of the 6 golden paths before each release, documented as a checklist in `docs/a11y.md`. **Put that document in the repo** — an a11y checklist is a differentiator almost no portfolio project has.

---

## 8. Dark mode strategy

**Principles:**

1. **Semantic tokens only.** A component never references `--iron-900` or a hex. It references `--text-primary`. Dark mode is then exactly one `[data-theme="dark"]` block (§3.3) — ~45 declarations — not an audit of 120 files. This is the entire reason the token tiering exists.
2. **Three states, not two.** `light` / `dark` / `system`. Stored in `localStorage` as `theme`; `system` means no `data-theme` attribute and `@media (prefers-color-scheme: dark)` decides. The media query is guarded `:root:not([data-theme="light"])` so an explicit light choice always wins.
3. **No flash.** A blocking inline script in `index.html` `<head>` sets `data-theme` before first paint:
   ```html
   <script>try{var t=localStorage.getItem('theme');
   if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches))
   document.documentElement.dataset.theme='dark';}catch(e){}</script>
   ```
4. **Never pure black.** Canvas is `#0E0C0B` — warm near-black that matches the warm-paper light theme. Pure `#000` causes halation against light text and looks cheap on OLED.
5. **Elevation inverts.** In light, higher = whiter + shadow. In dark, **higher = lighter surface**, shadow contributes almost nothing. Hence `--surface-default #161311` → `--surface-raised #1D1917` → `--surface-overlay #221D1A`.
6. **Accents brighten, backgrounds desaturate.** `--brand-solid` goes `Ember-500 → Ember-400`; `--text-link` goes `Blueprint-600 → Blueprint-300`. Status *surfaces* become deep desaturated tints (`--danger-surface: #2C1414`), never the light-mode `-50` values.
7. **Borders carry more weight.** In dark, `--border-subtle` must be visible (`#2A2522`) since shadows can't separate surfaces.
8. **Images and media.** Photographs get `filter: brightness(0.9) contrast(1.05)` in dark to stop them glowing. Illustrations are inline SVG using `currentColor` and token strokes, so they theme automatically. Logos need a dark variant.
9. **Charts.** `--viz-*` has a dark set (§3.3) — lighter, slightly desaturated series that hold ≥3:1 against `#0E0C0B`. Grid lines drop to `#2A2522`.
10. **The toggle must exist and be visible.** Segmented Light/Dark/System in the user dropdown. The current app has a fully-built `ThemeContext` with **zero consumers and no UI** — the single most common "half-built feature" tell.

**Verification:** every component's `/design` route entry renders in both themes side by side; Playwright takes both-theme screenshots of the 6 key routes; axe runs in both.

---

## 9. Screenshot & demo strategy

The README and the live demo are where 90% of the evaluation happens. Design for them explicitly.

### The six hero shots (in README order)

| # | Screen | Format | Why it's here | What must be true |
|---|---|---|---|---|
| 1 | **Student dashboard** (light) | Full-width PNG, 2400×1350 @2x, in a subtle browser frame | First impression. Shows the shell, nav, stat cards, the "Continue" panel, and the type system all at once. | Real seeded data: 4 enrolled courses with real trade names (*Industrial Electrical · CNC Machining · Automotive Diagnostics · Welding Level 2*), a real person name and avatar, non-zero counts, one unread message badge. No `Test User`, no zeros. |
| 2 | **Chat, mid-conversation** | Animated GIF/WebM, ~6s loop, ≤1.5 MB | The only technically hard thing in the repo. Motion proves it's real-time, which a static shot cannot. | Two seeded users, ~12 messages of plausible instructor↔student dialogue, a visible typing indicator, a message arriving, a read receipt flipping. Record at 1280×800, 24fps. |
| 3 | **Light/dark pair** — admin dashboard | Two half-width images side by side | Proves the token system is real, not a filter. Charts in both themes is the flex. | Both charts render, both use the theme-appropriate `--viz-*` sets, and the sidebar/card/table all read correctly. Identical data and scroll position in both. |
| 4 | **Course catalog** | Full-width | Shows the design system applied to a content surface, plus filters + capacity bars. | ≥12 seeded courses across 4 departments, at least one at 90%+ capacity showing the warning treatment, real cover images or the generated blueprint placeholders (consistent, not a mix of both). |
| 5 | **Teacher approval queue** | Cropped panel, ~1200×700 | The best "this is a real workflow, not CRUD" shot. | 5–6 pending requests with real names, avatars, mono enrollment numbers, and visible Approve/Reject affordances. |
| 6 | **Command palette open** | Cropped, ~1000×620, dark theme | 3 seconds of work for the reviewer to notice; it's the strongest "product, not project" tell in the list. | Query typed (`weld`), showing grouped results across Courses / People / Actions. |

Plus a **1200×630 OG image** for link previews — wordmark, one-line positioning, and the hero screenshot on the warm-paper background.

### What must be true before *any* screenshot is taken

1. **Rich seed data exists** and runs from `npm run db:seed`: 4 departments, 8 instructors, 60 students, 15 courses with realistic capacity fill (one at 29/30), 40 resources, threaded comments, 6 published news items, and 5 conversations with 10–20 messages each and mixed read state. *A reviewer who runs this and sees empty tables forms a worse impression than one who never runs it.*
2. **Avatars are real.** Generate deterministic ones (DiceBear `notionists` or `initials` with the muted tint set) at seed time and store the URL. Never a gray placeholder grid.
3. **Names are plausible and locale-appropriate.** No `John Doe` (currently hardcoded at `DashboardNavigation.tsx:187`), no `Test User`, no `asdf`.
4. **Zero console errors** in the recording, and **no debug logging** — the 47 frontend `console.log`s and the five `console.log('printing status code')` calls in `errorMiddleware.ts:37-42` must be gone. Reviewers open devtools.
5. **The build passes.** 131 TypeScript errors means `npm run build` fails; a broken build invalidates every screenshot below it.
6. **Demo accounts on the login screen.** Three one-click buttons that bypass the OTP flow in demo mode. Nobody registers an account and waits for an email — this is the difference between a demo that gets seen and one that doesn't.
7. **Consistent capture rig.** 1440×900 viewport, `deviceScaleFactor: 2`, no browser chrome, no scrollbars, identical zoom. Automate it: a Playwright script (`npm run screenshots`) that logs in as each role, navigates, and captures — so screenshots regenerate on demand and never go stale.
8. **Favicon and title.** `index.html:5,7` currently ship `/vite.svg` and `Vite + React + TS`. Design a mark — an Ember-filled square with a chamfered corner and a mono `M`, or a simple caliper glyph — and export 32/180/512 + `site.webmanifest`.

### README shape

```
[wordmark]  ← 400px, on the warm canvas
One-sentence positioning
[live demo] [screenshots] [architecture] [design system]   ← anchor pills
Badges: CI passing · TypeScript strict · a11y (axe) · License

▸ HERO SHOT #1 (student dashboard)

## What it is — 3 sentences

▸ CHAT GIF #2

## Design system              ← the section that differentiates this repo
Direction, palette swatch strip, type specimen, token architecture diagram,
LIGHT/DARK PAIR #3, link to /design route in the live demo

▸ CATALOG #4  ▸ APPROVAL QUEUE #5  ▸ COMMAND PALETTE #6

## Architecture — mermaid diagram
## Running locally — docker compose up (3 commands, demo credentials)
## Decisions — 5–8 short ADRs, incl. "why not Ant Design"
```

**Ship a `/design` route in the live demo.** A single page showing every token, every component in every variant and state, in both themes. It costs half a day, it doubles as your visual regression surface, and it is the most directly persuasive artifact you can hand a reviewer who asks "did you actually design this?"

---

## 10. Execution order (what to do first)

1. **Delete `index.css:7-14`** and load the three fonts. One hour. The single highest visual return available — it stops the entire product rendering in Times New Roman.
2. Land `tokens.css` + Tailwind v4 + the theme script + a working theme toggle. Now everything downstream is themeable.
3. Fix the 131 TS errors so `npm run build` passes, and wire CI. Nothing below this is visible if the build is red.
4. Build the 18 primitives against the tokens, plus the `/design` route.
5. Shell → CRUD primitives → dashboards → chat → auth → landing.
6. A11y pass, Playwright screenshot rig, README.

**Delete list, no ceremony:** `DashboardNavigation.tsx` (436 lines of self-described mock UI), `navigationDesignGuide.txt` (338 lines of prose inside `src/`), `ExploreCourses.module.css` (dead — its one referenced class doesn't exist), `login/styles.css`, both `conversations.scss` forks, `common/constants/theme.ts` (0 imports), `common/constants/api.ts` (0 imports, already drifted), `create-pages.js`, the injected `<style>` block in `AuthLayout.tsx:90-119`, the Unsplash hotlink at `AuthLayout.tsx:126`, all 24 `!important` declarations, all 166 inline style objects, and all 213 hardcoded hexes.