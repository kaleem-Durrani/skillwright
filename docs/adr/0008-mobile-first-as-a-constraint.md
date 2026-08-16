# ADR 0008 — Mobile-first is a build constraint, not a design intention

**Status:** Accepted · **Date:** 2026-08-16

## Context

Every project claims to be mobile-first. Almost none are. The reason is mechanical: the developer builds at 1440px because that is the monitor in front of them, then adds `max-width` queries to repair the small screens afterwards. The result is a desktop layout with patches — responsive, but not mobile-first, and the difference shows the moment a form is opened on a phone.

The distinction matters here beyond aesthetics. A vocational training platform's students check timetables, enrollment status and messages on phones. Desktop is the secondary surface.

"Be disciplined about it" is not a plan. Discipline decays, and a constraint nobody can verify is a preference.

## Decision

Mobile-first is enforced by `scripts/check-mobile-first.ts`, which runs in CI and fails the build. It rejects, across `apps/web/src`:

| Rejected                                 | Because                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `max-width` media queries                | Breakpoints may only _add_, via `min-width`. A `max-width` query is desktop-first by definition.                         |
| Tailwind `max-sm:` … `max-2xl:` variants | The same query wearing a hat.                                                                                            |
| `100vw`                                  | Ignores the scrollbar gutter; produces horizontal overflow.                                                              |
| Bare `vh`                                | Wrong the moment a mobile URL bar moves. Use `dvh` / `svh` / `lvh`.                                                      |
| Raw hex colours                          | Colour is declared once, in `styles/tokens.css` — the only exempt file. A literal anywhere else cannot follow the theme. |
| Stock Tailwind palette classes           | Bypasses the design tokens entirely.                                                                                     |
| Inline `style={{ color … }}`             | Invisible to the token system and to the dark-mode audit.                                                                |

Design rules that follow from the constraint: touch targets are 44×44 CSS px minimum, not 24×24. The app shell is a bottom tab bar on mobile and a sidebar from `md` up — not a sidebar that collapses into a hamburger. Data tables are card lists by default and become tables from `md` up; the table is the enhancement. A screen is done at 375px, then 320px, then desktop. Playwright runs iPhone 13 and Pixel 7 projects alongside desktop Chromium. The Lighthouse gate is mobile ≥ 90, not desktop.

## Consequences

- `styles/tokens.css` is exempt from the colour rule, because the palette has to be written down somewhere. One file, the same shape as the brand rule — and the check is what keeps it the only one.
- Other legitimate code occasionally trips a rule: an inline SVG needing a literal fill, a third-party embed. The escape hatch is an inline `mobile-first-ignore` comment on that line, with a reason. It is deliberately visible in review.
- The token layer must exist before the first component, not after. That front-loads work into `styles/globals.css`.
- Retrofitting this rule onto an existing desktop-first codebase would be expensive. Starting with it costs nothing.
