-- fizzy-supabase: initial schema
--
-- This mirrors the core of Fizzy's Rails/MySQL data model (see basecamp/fizzy
-- db/schema.rb) but re-expressed as native Postgres + RLS, to compare the two
-- approaches feature-by-feature. Notable differences called out inline.

-- ── Profiles ────────────────────────────────────────────────────────────────
-- Fizzy: `User` model, tied to an `Identity` (email) that can belong to many
-- `Account`s. Here we keep it simple: one Supabase auth.users row = one
-- profile, and account membership is the many-to-many layer (account_users).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profiles are viewable by any authenticated user"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid());

-- Auto-create a profile row whenever a new Supabase Auth user signs up.
-- Fizzy does the analogous thing in `Signup` + `Identity#joinable`.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── Accounts & membership ───────────────────────────────────────────────────
-- Fizzy: multi-tenancy is URL-based (`Account::MultiTenantable`, external
-- decimal account ids in the path). Here we use Postgres RLS instead of an
-- application-level `Current.account` + middleware — the database itself
-- enforces the tenant boundary rather than a Rack middleware.
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create type public.account_role as enum ('owner', 'admin', 'member');

create table public.account_users (
  account_id uuid not null references public.accounts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.account_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);

alter table public.accounts enable row level security;
alter table public.account_users enable row level security;

-- Helper used by every downstream policy — mirrors what `Current.account`
-- checks do in Fizzy's controllers, but enforced at the data layer.
create function public.is_account_member(target_account_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.account_users
    where account_id = target_account_id and user_id = auth.uid()
  );
$$;

create policy "Members can view their accounts"
  on public.accounts for select
  to authenticated
  using (public.is_account_member(id));

create policy "Any authenticated user can create an account"
  on public.accounts for insert
  to authenticated
  with check (true);

create policy "Members can view account membership"
  on public.account_users for select
  to authenticated
  using (public.is_account_member(account_id));

create policy "Users can add themselves to an account they're creating"
  on public.account_users for insert
  to authenticated
  with check (user_id = auth.uid());

-- ── Boards, columns, cards ──────────────────────────────────────────────────
-- Fizzy: Board -> Column -> Card, positioned via a custom "Entropic" concern
-- (fractional/entropy-based ordering to avoid renumbering on every move).
-- We use a plain float8 `position` column — a simpler version of the same
-- fractional-indexing idea, reordered client-side by averaging neighbors.
create table public.boards (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null,
  description text,
  archived_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null,
  position float8 not null default 0,
  created_at timestamptz not null default now()
);

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  column_id uuid not null references public.columns (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  title text not null,
  description text,
  position float8 not null default 0,
  color text,
  closed_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Native Postgres full-text search, replacing Fizzy's hand-rolled
  -- Search::Record::Trilogy (16-way sharded on MySQL) / Search::Record::Sqlite
  -- (FTS5) split. One index, one code path, no adapter branching.
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) stored
);

create index cards_search_idx on public.cards using gin (search_vector);
create index cards_column_position_idx on public.cards (column_id, position);

alter table public.boards enable row level security;
alter table public.columns enable row level security;
alter table public.cards enable row level security;

create policy "Members can view boards" on public.boards for select
  to authenticated using (public.is_account_member(account_id));
create policy "Members can manage boards" on public.boards for all
  to authenticated using (public.is_account_member(account_id))
  with check (public.is_account_member(account_id));

create policy "Members can view columns" on public.columns for select
  to authenticated using (public.is_account_member(account_id));
create policy "Members can manage columns" on public.columns for all
  to authenticated using (public.is_account_member(account_id))
  with check (public.is_account_member(account_id));

create policy "Members can view cards" on public.cards for select
  to authenticated using (public.is_account_member(account_id));
create policy "Members can manage cards" on public.cards for all
  to authenticated using (public.is_account_member(account_id))
  with check (public.is_account_member(account_id));

-- ── Comments ─────────────────────────────────────────────────────────────
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  author_id uuid references public.profiles (id),
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_vector tsvector generated always as (to_tsvector('english', coalesce(body, ''))) stored
);

create index comments_search_idx on public.comments using gin (search_vector);
create index comments_card_idx on public.comments (card_id);

alter table public.comments enable row level security;

create policy "Members can view comments" on public.comments for select
  to authenticated using (public.is_account_member(account_id));
create policy "Members can manage comments" on public.comments for all
  to authenticated using (public.is_account_member(account_id))
  with check (public.is_account_member(account_id));

-- ── Tags & taggings ──────────────────────────────────────────────────────
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null,
  color text,
  unique (account_id, name)
);

create table public.taggings (
  card_id uuid not null references public.cards (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  primary key (card_id, tag_id)
);

alter table public.tags enable row level security;
alter table public.taggings enable row level security;

create policy "Members can view tags" on public.tags for select
  to authenticated using (public.is_account_member(account_id));
create policy "Members can manage tags" on public.tags for all
  to authenticated using (public.is_account_member(account_id))
  with check (public.is_account_member(account_id));

create policy "Members can view taggings" on public.taggings for select
  to authenticated using (
    exists (select 1 from public.cards c where c.id = taggings.card_id and public.is_account_member(c.account_id))
  );
create policy "Members can manage taggings" on public.taggings for all
  to authenticated using (
    exists (select 1 from public.cards c where c.id = taggings.card_id and public.is_account_member(c.account_id))
  )
  with check (
    exists (select 1 from public.cards c where c.id = taggings.card_id and public.is_account_member(c.account_id))
  );

-- ── Assignments, watches, pins, reactions, mentions ─────────────────────
-- Fizzy: Card::Assignable, Card::Watchable, Pin, Reaction, Mention concerns.
create table public.assignments (
  card_id uuid not null references public.cards (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (card_id, user_id)
);

create table public.watches (
  card_id uuid not null references public.cards (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (card_id, user_id)
);

create table public.pins (
  card_id uuid not null references public.cards (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (card_id, user_id)
);

create table public.reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (comment_id, user_id, emoji)
);

create table public.mentions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments (id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.assignments enable row level security;
alter table public.watches enable row level security;
alter table public.pins enable row level security;
alter table public.reactions enable row level security;
alter table public.mentions enable row level security;

create policy "Members can view assignments" on public.assignments for select
  to authenticated using (
    exists (select 1 from public.cards c where c.id = assignments.card_id and public.is_account_member(c.account_id))
  );
create policy "Members can manage assignments" on public.assignments for all
  to authenticated using (
    exists (select 1 from public.cards c where c.id = assignments.card_id and public.is_account_member(c.account_id))
  )
  with check (
    exists (select 1 from public.cards c where c.id = assignments.card_id and public.is_account_member(c.account_id))
  );

create policy "Members can view watches" on public.watches for select
  to authenticated using (
    exists (select 1 from public.cards c where c.id = watches.card_id and public.is_account_member(c.account_id))
  );
create policy "Users can manage their own watches" on public.watches for all
  to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Members can view pins" on public.pins for select
  to authenticated using (
    exists (select 1 from public.cards c where c.id = pins.card_id and public.is_account_member(c.account_id))
  );
create policy "Users can manage their own pins" on public.pins for all
  to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Members can view reactions" on public.reactions for select
  to authenticated using (
    exists (select 1 from public.comments cm where cm.id = reactions.comment_id and public.is_account_member(cm.account_id))
  );
create policy "Users can manage their own reactions" on public.reactions for all
  to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Members can view mentions" on public.mentions for select
  to authenticated using (
    exists (select 1 from public.comments cm where cm.id = mentions.comment_id and public.is_account_member(cm.account_id))
  );
create policy "Members can create mentions" on public.mentions for insert
  to authenticated with check (
    exists (select 1 from public.comments cm where cm.id = mentions.comment_id and public.is_account_member(cm.account_id))
  );

-- ── Events & notifications ───────────────────────────────────────────────
-- Fizzy: `Event` (+ per-model `Eventable` concern) drives an activity feed,
-- fanned out to `Notification`s via `Notifier` subclasses and delivered
-- through Solid Queue jobs. Here the same fan-out happens with a Postgres
-- trigger instead of a background job queue (see the Edge Function comparison
-- doc for where we *do* use async processing instead).
create table public.events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  board_id uuid references public.boards (id) on delete cascade,
  card_id uuid references public.cards (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  kind text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index events_card_idx on public.events (card_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

alter table public.events enable row level security;
alter table public.notifications enable row level security;

create policy "Members can view events" on public.events for select
  to authenticated using (public.is_account_member(account_id));
create policy "Members can create events" on public.events for insert
  to authenticated with check (public.is_account_member(account_id));

create policy "Users can view their own notifications" on public.notifications for select
  to authenticated using (user_id = auth.uid());
create policy "Users can update their own notifications" on public.notifications for update
  to authenticated using (user_id = auth.uid());

-- Fan out a notification to every watcher of a card whenever an event fires
-- against that card (mirrors Fizzy's Notifier::CardEventNotifier).
create function public.fan_out_notifications()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.card_id is not null then
    insert into public.notifications (user_id, event_id)
    select w.user_id, new.id
    from public.watches w
    where w.card_id = new.card_id and w.user_id != coalesce(new.actor_id, '00000000-0000-0000-0000-000000000000'::uuid);
  end if;
  return new;
end;
$$;

create trigger on_event_created
  after insert on public.events
  for each row execute procedure public.fan_out_notifications();

-- ── Attachments (paired with a Supabase Storage bucket — see next migration) ─
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  uploaded_by uuid references public.profiles (id),
  storage_path text not null,
  filename text not null,
  content_type text,
  byte_size bigint,
  created_at timestamptz not null default now()
);

alter table public.attachments enable row level security;

create policy "Members can view attachments" on public.attachments for select
  to authenticated using (public.is_account_member(account_id));
create policy "Members can manage attachments" on public.attachments for all
  to authenticated using (public.is_account_member(account_id))
  with check (public.is_account_member(account_id));

-- ── Realtime ──────────────────────────────────────────────────────────────
-- Fizzy broadcasts card/column changes over Turbo Streams (ActionCable +
-- Solid Cable). The Supabase equivalent: opt these tables into the
-- `supabase_realtime` publication and subscribe from the client with
-- postgres_changes.
alter publication supabase_realtime add table public.boards;
alter publication supabase_realtime add table public.columns;
alter publication supabase_realtime add table public.cards;
alter publication supabase_realtime add table public.comments;
alter publication supabase_realtime add table public.notifications;
