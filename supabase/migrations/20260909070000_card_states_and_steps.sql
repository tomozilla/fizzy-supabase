-- Card workflow states + checklists, closing the gap against Fizzy's
-- Card::Closeable, Card::Golden/Goldness, Card::NotNow/Postponable, and
-- Card::Multistep (its `Step` model).

-- ── Card states ─────────────────────────────────────────────────────────
-- `closed_at` already existed but nothing ever set it; the rest are new.
alter table public.cards
  add column if not exists closed_by uuid references public.profiles (id),
  -- "Golden" = Fizzy's way of marking a card as standout/important. Stored as
  -- a timestamp rather than a boolean so the activity feed can say *when*.
  add column if not exists golden_at timestamptz,
  add column if not exists golden_by uuid references public.profiles (id),
  -- Postpone / "not now": hide the card from the board until this time.
  add column if not exists not_now_until timestamptz,
  -- Triage: new cards arrive untriaged and get processed via the triage view.
  add column if not exists triaged_at timestamptz;

create index if not exists cards_not_now_idx on public.cards (board_id, not_now_until);
create index if not exists cards_triage_idx on public.cards (board_id, triaged_at);

-- ── Steps (per-card checklist) ──────────────────────────────────────────
create table if not exists public.steps (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  title text not null,
  position float8 not null default 0,
  completed_at timestamptz,
  completed_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists steps_card_idx on public.steps (card_id, position);

alter table public.steps enable row level security;

create policy "Members can view steps" on public.steps for select
  to authenticated using (public.is_account_member(account_id));
create policy "Members can manage steps" on public.steps for all
  to authenticated using (public.is_account_member(account_id))
  with check (public.is_account_member(account_id));

-- Live-sync steps and reactions the same way cards/comments already are, so
-- a checklist ticked by one person shows up for everyone watching the card.
alter publication supabase_realtime add table public.steps;
alter publication supabase_realtime add table public.reactions;
