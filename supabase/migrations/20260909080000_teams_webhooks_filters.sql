-- Teams (join codes), saved filters, outgoing webhooks, web-push
-- subscriptions, and an avatars bucket. Fizzy equivalents: Account::JoinCode,
-- Filter, Webhook/Webhook::Delivery, Push::Subscription, User::Avatar.

-- ── Join codes (invite a teammate into your account) ────────────────────
create table if not exists public.account_join_codes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  code text not null unique,
  created_by uuid references public.profiles (id),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.account_join_codes enable row level security;

-- Only existing members can see or mint codes for their own account. Note
-- there is deliberately NO select policy allowing a non-member to read a
-- code row — redeeming goes through the security-definer function below
-- instead, so a stranger can never enumerate codes.
create policy "Members can view their account's join codes"
  on public.account_join_codes for select
  to authenticated using (public.is_account_member(account_id));

create policy "Members can create join codes for their account"
  on public.account_join_codes for insert
  to authenticated with check (public.is_account_member(account_id));

create policy "Members can revoke their account's join codes"
  on public.account_join_codes for delete
  to authenticated using (public.is_account_member(account_id));

-- Redeeming has the same chicken-and-egg shape as first-time account
-- bootstrap: the joiner isn't a member yet, so RLS can't let them read the
-- code or write the membership row directly. A SECURITY DEFINER function is
-- the trusted boundary — it validates the code itself and adds only the
-- calling user, so possessing a valid code is the entire authorization.
create or replace function public.redeem_join_code(join_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_account uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select account_id into target_account
  from public.account_join_codes
  where code = join_code
    and (expires_at is null or expires_at > now())
  limit 1;

  if target_account is null then
    return null;
  end if;

  insert into public.account_users (account_id, user_id, role)
  values (target_account, auth.uid(), 'member')
  on conflict (account_id, user_id) do nothing;

  return target_account;
end;
$$;

-- Same hardening as the other functions: keep it off the anon-callable
-- surface, and only expose it to signed-in users (see FRICTION_LOG #2 —
-- Supabase's default privileges grant EXECUTE to anon+authenticated on every
-- new public function, so revoking from `public` alone is not enough).
revoke execute on function public.redeem_join_code(text) from public, anon, authenticated;
grant execute on function public.redeem_join_code(text) to authenticated;

-- ── Saved filters (Fizzy's Filter model) ────────────────────────────────
create table if not exists public.filters (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  query text not null default '',
  created_at timestamptz not null default now()
);

alter table public.filters enable row level security;

create policy "Users can view their own filters" on public.filters for select
  to authenticated using (user_id = auth.uid());
create policy "Users can manage their own filters" on public.filters for all
  to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_account_member(account_id));

-- ── Outgoing webhooks (Fizzy's Webhook / Webhook::Delivery) ─────────────
create table if not exists public.webhooks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  url text not null,
  active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references public.webhooks (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  event_id uuid references public.events (id) on delete set null,
  status_code int,
  error text,
  delivered_at timestamptz not null default now()
);

create index if not exists webhook_deliveries_webhook_idx
  on public.webhook_deliveries (webhook_id, delivered_at desc);

alter table public.webhooks enable row level security;
alter table public.webhook_deliveries enable row level security;

create policy "Members can view webhooks" on public.webhooks for select
  to authenticated using (public.is_account_member(account_id));
create policy "Members can manage webhooks" on public.webhooks for all
  to authenticated using (public.is_account_member(account_id))
  with check (public.is_account_member(account_id));

create policy "Members can view webhook deliveries" on public.webhook_deliveries for select
  to authenticated using (public.is_account_member(account_id));

-- ── Web push subscriptions (Fizzy's Push::Subscription) ─────────────────
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy "Users can view their own push subscriptions"
  on public.push_subscriptions for select
  to authenticated using (user_id = auth.uid());
create policy "Users can manage their own push subscriptions"
  on public.push_subscriptions for all
  to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── Avatars bucket (Fizzy's User::Avatar) ───────────────────────────────
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "Anyone can view avatars"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "Users can upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can replace their own avatar"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own avatar"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
