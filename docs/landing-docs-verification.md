# Public landing and developer guide

Date: 31 October 2026.

## Delivered

- Redesigned / with a dark sci-fi visual system, lime accents, CSS/SVG orbital architecture
  illustration, moving connection signals, floating nodes, section reveals and hover states.
- A motion pause/resume control and prefers-reduced-motion styles. Initial hero content
  remains visible without reveal scripting; the page uses no external animation library.
- Responsive navigation, native FAQ disclosures, platform feature sections, availability
  roadmap, integration walkthrough and account/developer calls to action.
- Public /docs: onboarding, server environments/URLs, key management, live GET /usage,
  future event contracts, idempotency, failure preservation, errors/rate limits, localhost
  networking and webhook/email capability boundaries.
- Copyable Node.js, NestJS, Next.js, PHP and cURL examples with language tabs and keyboard
  tab navigation. Verification is available; POST /events examples are labeled planned
  both beside the code and inside copied code comments.
- Public examples contain only placeholders, never actual platform keys or private config.

## Scope

Changes are in users/app/page.tsx, users/app/marketing.css, users/app/docs/page.tsx,
users/components/marketing/*, users/lib/integration-examples.ts and layout metadata.
Marketing styles are scoped to .astro so account/admin styling remains separate.
Supporting README/integration documentation was updated. No business endpoint was added.
Top level remains exactly admin, backend and users.

## Checks observed

- User frontend lint, TypeScript, production build and formatting passed.
- Six JS/TS helpers were transpiled and exercised with controlled fetch responses:
  verification success, rejected keys, missing configuration, network failure,
  planned-event acceptance/rejection, stable retry payload and idempotency key.
- Both PHP examples passed PHP syntax checks. No live PHP/provider integration is claimed.
- cURL examples were checked for bounded timeouts and preserved multiline continuations.
- Landing, /docs, login and registration returned HTTP 200.
- Internal anchor targets and CSS resource delivery passed checks.
- The delivered CSS includes orbital animation, reduced-motion and pause rules.
- The Docker image rebuilt successfully; only the user frontend was recreated.
- Existing PostgreSQL/API/Redis/BullMQ/frontend infrastructure smoke test passed.
- Hidden-inclusive root assertion confirmed exactly the required three directories.

## Visual review limitation

Computer Use blocked native Chrome review because it could not confidently determine
the current browser URL. No further browser-control attempt was made. Interactive
copy/tab/motion behavior and visual desktop/mobile rendering were not browser-tested;
the implementation was checked through source, compilation and HTTP verification.

## Current local URLs

- Landing: http://localhost:3100
- Developer guide: http://localhost:3100/docs

The frontend remains running. Event ingestion, queued communications, live providers,
billing and production readiness retain their previously documented pending status.
