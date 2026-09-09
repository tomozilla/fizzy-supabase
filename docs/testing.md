# Testing

Three layers, each covering what it's actually good at — mirroring the
*rigor* of Fizzy's Minitest/Capybara/Mocha suite, with tooling appropriate
to this stack rather than porting Ruby test code directly.

| Layer | Tool | What it covers | Command |
|---|---|---|---|
| Unit | Vitest | Pure logic (`lib/kanban.ts`): position math, slugs, @mention parsing | `npm run test:unit` |
| Database / RLS | pgTAP | Row Level Security actually blocks cross-account access, not just "looks right" in the SQL | `npm run test:db` |
| End-to-end | Playwright | Real user flows through the actual UI, including live realtime sync across two browser tabs | `npm run test:e2e` |

Run everything: `npm test`.

## Unit tests (Vitest)

`tests/unit/*.test.ts`. No network, no database — these test the framework-
free helpers extracted into `lib/kanban.ts` specifically so they *can* be
tested this way (see the comment at the top of that file).

## Database tests (pgTAP)

`supabase/tests/*.sql`, run via `supabase test db` — spins up a disposable
copy of the local stack, seeds fixture rows directly as `postgres` (bypassing
RLS), then re-runs queries as `authenticated` with a specific user's JWT
claims (`set local role authenticated; set local "request.jwt.claims" = ...`)
to prove the policies actually restrict what they're supposed to.

This is the same technique used to verify RLS isolation against the live
cloud project by hand (see `FRICTION_LOG.md`) — codified here so it runs on
every change instead of once, manually.

## End-to-end tests (Playwright)

`tests/e2e/*.spec.ts`. **Always run against the local Supabase stack, never the cloud project** —
`playwright.config.ts` loads `.env.test.local` (gitignored, not committed —
create it yourself, see below) and passes it as real process env vars to the
dev server it spawns, which take priority over whatever `.env.local` (the
cloud project) declares.

Setup, once per session:

```sh
supabase start        # local Postgres/Auth/Storage/Realtime in Docker
supabase db reset     # fresh schema + no leftover data from a previous run
supabase status        # copy API_URL and PUBLISHABLE_KEY from the output into:
```

```
# .env.test.local
NEXT_PUBLIC_SUPABASE_URL=<API_URL from `supabase status`>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY from `supabase status`>
```

Then:

```sh
npm run test:e2e
```

The suite is a single serial flow (sign up → create a board → create/move a
card → comment/tag → verify realtime sync across two authenticated browser
contexts) rather than independent isolated tests, because the steps
genuinely build on each other — see the comment at the top of
`tests/e2e/kanban.spec.ts`.

### A genuine bug this suite caught

Building this test caught a real concurrency bug, not a hypothetical one:
`ensurePersonalAccount`'s "check membership, then insert" pattern isn't
atomic, and a router prefetch racing the real navigation triggered it twice
for the same brand-new user, colliding on the generated slug. The fix (a
deterministic account id instead of a random one, so a genuine race becomes
a safely-recoverable primary-key conflict instead of two independent
successes) is in `app/actions.ts`. It also caught a Realtime auth-timing
issue — subscribing before the browser client finishes hydrating its
session from cookies can silently under-authorize that subscription for
RLS-gated `postgres_changes` for its whole lifetime (fixed by awaiting
`supabase.auth.getSession()` before calling `.channel().subscribe()`).
