# Testing

Three layers, each covering what it's actually good at — mirroring the
*rigor* of Fizzy's Minitest/Capybara/Mocha suite, with tooling appropriate
to this stack rather than porting Ruby test code directly.

| Layer | Tool | What it covers | Command |
|---|---|---|---|
| Unit | Vitest | Pure logic (`lib/kanban.ts`): position math, slugs, @mention parsing, event descriptions | `npm run test:unit` |
| Database / RLS | pgTAP | Row Level Security actually blocks cross-account access (boards, cards, storage, join codes, steps, webhooks), bootstrap idempotency, webhook delivery firing | `npm run test:db` |
| End-to-end | Playwright | Real user flows through the actual UI: kanban + drag-and-drop, card workflow states, two-user invites and notifications, import/export, saved searches, push subscription, passkeys | `npm run test:e2e` |

The e2e suites, by file:

| File | Covers |
|---|---|
| `kanban.spec.ts` | Sign-up, boards/columns/cards, drag-and-drop, comments, tags, cross-tab realtime |
| `card-features.spec.ts` | Checklists, golden, pin, watch, reactions, postpone, close, triage |
| `collaboration.spec.ts` | Invite links across two real users, notification inbox, search, "my stuff", export, webhooks |
| `data-features.spec.ts` | JSON import round-trip, saved searches, activity-spike flagging |
| `push.spec.ts` | Service worker registration + push subscription storage |
| `passkeys.spec.ts` | Full WebAuthn register → sign-out → sign-in-with-passkey, via Chromium's virtual authenticator |

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
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<any P-256 public key; push tests only need it to be well-formed>
NEXT_PUBLIC_PASSKEYS_ENABLED=true
```

The local stack also reads `.env` (not committed) for WebAuthn, because
`rp_id` has to match the origin and therefore can't be shared between local
and production:

```
# .env
WEBAUTHN_RP_ID=localhost
WEBAUTHN_RP_ORIGINS=http://localhost:3000,http://localhost:3100,http://127.0.0.1:3000
```

Changing `[auth.*]` config needs `supabase stop && supabase start` to take
effect — `supabase db reset` restarts Postgres but not the Auth container,
which is a genuinely confusing 10 minutes if you don't know it.

Then:

```sh
npm run test:e2e
```

The suite is a single serial flow (sign up → create a board → create/move a
card → comment/tag → verify realtime sync across two authenticated browser
contexts) rather than independent isolated tests, because the steps
genuinely build on each other — see the comment at the top of
`tests/e2e/kanban.spec.ts`.

### What these tests can't prove

Two things are deliberately asserted narrowly, because the environment
can't honestly verify more:

- **Push delivery.** The subscription round trip is real, and `send-push`
  signs a valid VAPID JWT, but headless Chromium has no push service to
  accept it. The test asserts the service worker registers and the
  subscription persists, not that a notification arrives.
- **Webhook HTTP.** `pg_net` fires asynchronously, so the pgTAP test asserts
  the `webhook_deliveries` audit row is written, not that a remote endpoint
  received the POST.

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

Later rounds caught more of the same kind: an invite link that was silently
dropped when the invited user chose "Sign up" instead of "Login"; membership
queries that returned teammates' rows too, rendering a shared workspace once
per member; and comment events written without a `board_id`, which made them
invisible to board-scoped queries and unlinkable from the notification
inbox. None of those were visible by reading the code — each one needed a
test that actually walked the flow.
