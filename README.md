# fizzy-supabase

A Supabase dogfooding project: a from-scratch, Supabase-native reimagining
of [Fizzy](https://github.com/basecamp/fizzy) — 37signals' kanban tracker —
built on Next.js + TypeScript instead of Rails, to compare the two
approaches feature by feature.

- **Feature comparison:** [`docs/comparison.md`](docs/comparison.md) —
  Database/multi-tenancy, Auth, Storage, Realtime, and Edge Functions,
  Fizzy's Rails implementation vs this project's Supabase-native one.
- **Friction log:** [`FRICTION_LOG.md`](FRICTION_LOG.md) — concrete issues
  hit while building this, for the Supabase team.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind
- Supabase: Postgres + RLS, Auth, Storage, Realtime, Edge Functions
- Deployed on Vercel

## What's implemented

- Multi-tenant accounts, enforced entirely via Postgres RLS (no
  application-level tenant checks)
- Boards → columns → cards, with live realtime sync across
  tabs/users via `postgres_changes`
- Comments, tags, assignments, watches, pins, reactions, mentions
- An activity feed (`events`) fanning out to per-user `notifications` via a
  Postgres trigger
- File attachments via Supabase Storage, tenant-isolated by path + RLS
- Native Postgres full-text search on cards/comments (replacing Fizzy's
  hand-rolled MySQL-sharded / SQLite-FTS5 split with one GIN index)
- A Deno Edge Function (`parse-mentions`) that server-side validates
  @mentions against real account membership before fanning out
  notifications

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
