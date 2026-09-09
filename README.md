# fizzy-supabase

**Live demo:** https://fizzy-supabase.vercel.app

A personal learning project: a from-scratch reimagining of the *idea* of
[Fizzy](https://github.com/basecamp/fizzy) — 37signals' kanban tracker — as
a Next.js + TypeScript app built on Supabase, written to learn the Supabase
stack by comparing it feature-by-feature against a real, well-designed
Rails application.

> **This is not Fizzy, and not affiliated with 37signals/Basecamp.** No
> Fizzy source code was copied — only its publicly documented data model
> and feature set were used as a reference point for comparison, credited
> throughout `docs/comparison.md`. Fizzy itself is licensed under 37signals'
> [O'Saasy License](https://github.com/basecamp/fizzy/blob/main/LICENSE.md),
> which this project doesn't use or need since none of its code is reused.
> This repo exists purely as a personal exercise in learning Next.js and
> Supabase — it is **not a commercial product**, is not for sale, and is not
> offered as a hosted or managed service to anyone.

- 📊 **Feature comparison:** [`docs/comparison.md`](docs/comparison.md) —
  Database/multi-tenancy, Auth, Storage, Realtime, and Edge Functions,
  with diagrams
- 🏗️ **Infrastructure:** [`docs/infrastructure.md`](docs/infrastructure.md) —
  production and local architecture, plus an optional local CDC +
  observability stack (Debezium → Kafka → ClickHouse, OpenTelemetry →
  Vector → ClickHouse)
- 📝 **Build notes:** [`FRICTION_LOG.md`](FRICTION_LOG.md) — issues hit
  while building this, and what worked well
- ✅ **Testing:** [`docs/testing.md`](docs/testing.md) — unit (Vitest),
  RLS policy tests (pgTAP), and end-to-end (Playwright) against a local
  Supabase stack

## Architecture

```mermaid
flowchart LR
    subgraph Client["Browser"]
        UI["Next.js App Router\n(Server Components + Client Components)"]
    end

    subgraph Vercel["Vercel"]
        UI
        SA["Server Actions\n(app/actions.ts)"]
    end

    subgraph Supabase["Supabase"]
        Auth["Auth\n(password + passkeys)"]
        DB[("Postgres\n+ Row Level Security\n+ triggers, pg_net")]
        Storage["Storage\n(attachments, avatars)"]
        Realtime["Realtime\n(postgres_changes)"]
        EdgeFn["Edge Functions\n(parse-mentions, send-push)"]
    end

    Hooks["Your webhook endpoint"]
    Push["Browser push service"]

    UI -->|reads/writes| SA
    SA -->|SQL over RLS| DB
    UI -->|subscribe| Realtime
    Realtime -->|WAL changes| DB
    UI -->|upload/download| Storage
    SA -->|invoke| EdgeFn
    EdgeFn -->|service-role| DB
    UI -->|sign in/up| Auth
    Auth -->|auth.uid()| DB
    DB -->|pg_net trigger| Hooks
    EdgeFn -->|VAPID| Push
```

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind |
| Auth | Supabase Auth (email/password, passkeys/WebAuthn) |
| Database | Postgres, enforced with Row Level Security |
| File storage | Supabase Storage |
| Live updates | Supabase Realtime (`postgres_changes`) |
| Background logic | Supabase Edge Functions (Deno), `pg_net` triggers |
| Hosting | Vercel |

## Design

Styled with a Supabase-inspired palette rather than the create-next-app
starter's default black-and-white theme: their signature brand green
(`hsl(153 60% 53%)`, ~`#3ECF8E`) as the accent/primary color for buttons,
links, focus rings, and active states, layered over neutral gray/near-black
surfaces — matching how Supabase's own dashboard uses green as an accent
against grayscale, rather than a green-tinted background. This is palette
and tone inspiration only, not any of Supabase's actual design system code
or trademarked assets. All theme tokens live in `app/globals.css` (light +
dark mode); UI is built from the same small set of components throughout
(`components/ui/*` — Button, Card, Input, Badge) rather than one-off styled
markup per page.

## What's implemented

| Area | Details |
|---|---|
| Multi-tenancy | Accounts + membership, enforced entirely via Postgres RLS — no application-level tenant checks anywhere in the code |
| Teams | Invite links (join codes) redeemed through a `SECURITY DEFINER` function, member roster, leave-workspace, multi-workspace boards/settings |
| Boards | Boards → columns → cards with drag-and-drop, live realtime sync across tabs/users |
| Card workflow | Close/reopen, golden cards, postpone ("not now"), checklists (steps), triage inbox, activity-spike flagging |
| Collaboration | Comments, tags, assignments, watches, pins, emoji reactions, @mentions |
| Notifications | In-app inbox with unread badge, fed by a Postgres trigger; optional web push via service worker + VAPID |
| Attachments | Supabase Storage, tenant-isolated by object path + RLS; avatars in a separate public bucket |
| Search | Native Postgres full-text search on cards/comments (one GIN index, no external search service) + saved searches |
| Data | JSON export and import (ids remapped so a re-import duplicates rather than clobbers) |
| Integrations | Outgoing webhooks delivered by a `pg_net` trigger, with a delivery audit trail |
| Auth | Email/password plus passkeys (WebAuthn) where the project has them enabled |
| Server logic | Deno Edge Functions: `parse-mentions` (re-validates @mentions server-side) and `send-push` (VAPID-signed web push) |

See `docs/comparison.md` for how each of these compares to Fizzy's actual
Rails implementation.

## Local development

```sh
npm install
npm run dev
```

Requires a `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (see `.env.example` for the optional
push/passkey variables too).

### Web push

Generate a P-256 VAPID keypair, put the public half in
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` and the private half in the project's Edge
Function secrets (`supabase secrets set VAPID_PRIVATE_KEY=…`). Pushes are
sent bodyless — VAPID-authenticated but with no encrypted payload — so the
service worker shows a generic nudge and the inbox loads the real content.

### Passkeys

Passkeys need `[auth.passkey]` enabled on the project *and*
`[auth.webauthn]` `rp_id`/`rp_origins` matching the domain being served.
`supabase config push` doesn't manage these yet, so on a hosted project
enable them in the dashboard first, then set
`NEXT_PUBLIC_PASSKEYS_ENABLED=true` so the UI appears.

## Database changes

```sh
supabase link --project-ref <ref>
supabase db push
```

Migrations live in `supabase/migrations/`.
