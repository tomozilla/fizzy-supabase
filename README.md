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
- 📝 **Build notes:** [`FRICTION_LOG.md`](FRICTION_LOG.md) — issues hit
  while building this, and what worked well

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
        Auth["Auth\n(email/password)"]
        DB[("Postgres\n+ Row Level Security")]
        Storage["Storage\n(card-attachments bucket)"]
        Realtime["Realtime\n(postgres_changes)"]
        EdgeFn["Edge Function\n(parse-mentions)"]
    end

    UI -->|reads/writes| SA
    SA -->|SQL over RLS| DB
    UI -->|subscribe| Realtime
    Realtime -->|WAL changes| DB
    UI -->|upload/download| Storage
    SA -->|invoke| EdgeFn
    EdgeFn -->|service-role| DB
    UI -->|sign in/up| Auth
    Auth -->|auth.uid()| DB
```

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind |
| Auth | Supabase Auth (email/password) |
| Database | Postgres, enforced with Row Level Security |
| File storage | Supabase Storage |
| Live updates | Supabase Realtime (`postgres_changes`) |
| Background logic | Supabase Edge Functions (Deno) |
| Hosting | Vercel |

## What's implemented

| Area | Details |
|---|---|
| Multi-tenancy | Accounts + membership, enforced entirely via Postgres RLS — no application-level tenant checks anywhere in the code |
| Boards | Boards → columns → cards, live realtime sync across tabs/users |
| Collaboration | Comments, tags, assignments, watches, pins, reactions, @mentions |
| Activity feed | `events` table fanning out to per-user `notifications` via a Postgres trigger |
| Attachments | Supabase Storage, tenant-isolated by object path + RLS |
| Search | Native Postgres full-text search on cards/comments (one GIN index, no external search service) |
| Server logic | A Deno Edge Function (`parse-mentions`) that re-validates @mentions against real account membership before notifying |

See `docs/comparison.md` for how each of these compares to Fizzy's actual
Rails implementation.

## Local development

```sh
npm install
npm run dev
```

Requires a `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (see `.env.example`).

## Database changes

```sh
supabase link --project-ref <ref>
supabase db push
```

Migrations live in `supabase/migrations/`.
