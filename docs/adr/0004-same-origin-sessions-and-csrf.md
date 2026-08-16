# ADR 0004 — Same-origin deployment, cookie sessions, and explicit CSRF defence

**Status:** Accepted · **Date:** 2026-08-16

## Context

Two decisions are entangled and are recorded together because neither makes sense alone.

**Where the token lives.** `localStorage` is readable by any script on the page, so a single XSS becomes a permanent credential theft. A cookie the browser refuses to hand to JavaScript is not.

**Where the SPA is served from.** A separate static host means a cross-origin API, which means CORS with credentials, which means `SameSite=None`, which surrenders the cheapest CSRF defence available and adds a preflight to every mutation.

## Decision

**Single origin in production.** The API process serves the built SPA. `/api/v1/*` is the API; everything else falls through to `index.html`. There is no CORS configuration in production because there is no cross-origin request.

**The session cookie is `__Host-sw_session`:** `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`. The `__Host-` prefix is enforced by the browser — the cookie cannot be set without `Secure`, cannot carry a `Domain`, and cannot be planted by a subdomain. A subdomain takeover cannot forge a session.

**`SameSite=Lax` is treated as insufficient on its own.** It does not cover top-level `POST` navigations in every browser and it is not a defence a security reviewer should have to take on faith. So every state-changing route also verifies origin: `Origin` (falling back to `Sec-Fetch-Site`) must be present and in `ALLOWED_ORIGINS`, or the request is rejected with `403 FORBIDDEN`. Roughly fifteen lines of middleware.

No CSRF token, no double-submit cookie, no token rotation to get wrong.

## Consequences

- A CDN cannot serve the SPA directly. Static assets are cache-headered and fronted by a CDN in front of the origin instead.
- Deploying the frontend requires deploying the API. For one artifact with one version, that is a simplification.
- Development runs Vite on a different port, so `ALLOWED_ORIGINS` is environment-specific and the dev server proxies `/api` to keep the cookie same-origin locally.
- An integration test posts a mutation with a foreign `Origin` and asserts `403`. Without it, this ADR is only a claim.
