-- RLS policy tests: verifies account isolation is actually enforced by
-- Postgres, not just that the policy SQL "looks right". Run with
-- `supabase test db` (spins up a disposable copy of the local stack).
--
-- These exercise the same property proven manually against the live cloud
-- project earlier (role-simulation + a real REST API round trip) — codified
-- here so it's checked on every change instead of by hand.
begin;
select plan(17);

-- Two users, two accounts, entirely as postgres (bypasses RLS) — this is
-- the fixture data every test below runs against.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

insert into public.accounts (id, name, slug) values
  ('a1111111-1111-1111-1111-111111111111', 'Alice Co', 'alice-co'),
  ('a2222222-2222-2222-2222-222222222222', 'Bob Co', 'bob-co');

insert into public.account_users (account_id, user_id, role) values
  ('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('a2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'owner');

insert into public.boards (id, account_id, name) values
  ('b1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'Alice Board');

insert into public.columns (id, board_id, account_id, name, position) values
  ('c1111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'To do', 0);

-- ── is_account_member() ─────────────────────────────────────────────────
select is(
  (select public.is_account_member('a1111111-1111-1111-1111-111111111111'::uuid)
     from (select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true)) _),
  true,
  'is_account_member: true for an actual member'
);

select is(
  (select public.is_account_member('a1111111-1111-1111-1111-111111111111'::uuid)
     from (select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true)) _),
  false,
  'is_account_member: false for a non-member'
);

-- ── Boards: SELECT is scoped to membership ──────────────────────────────
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*) from public.boards where id = 'b1111111-1111-1111-1111-111111111111')::int,
  1,
  'Alice can see her own board'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*) from public.boards where id = 'b1111111-1111-1111-1111-111111111111')::int,
  0,
  'Bob cannot see Alice''s board'
);

-- ── Cards: INSERT is blocked cross-account, allowed same-account ────────
select throws_ok(
  $$insert into public.cards (board_id, column_id, account_id, title)
    values ('b1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111',
            'a1111111-1111-1111-1111-111111111111', 'hacked card')$$,
  '42501',
  null,
  'Bob cannot insert a card claiming Alice''s account_id'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok(
  $$insert into public.cards (id, board_id, column_id, account_id, title)
    values ('d1111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111',
            'c1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'Alice''s card')$$,
  'Alice can insert a card into her own board'
);

-- ── Storage: object visibility follows the {account_id}/... path convention ─
reset role;
insert into storage.buckets (id, name, public) values ('card-attachments', 'card-attachments', false)
  on conflict (id) do nothing;
insert into storage.objects (bucket_id, name, owner)
values ('card-attachments', 'a1111111-1111-1111-1111-111111111111/d1111111-1111-1111-1111-111111111111/photo.png',
        '11111111-1111-1111-1111-111111111111');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*) from storage.objects
     where bucket_id = 'card-attachments'
       and name = 'a1111111-1111-1111-1111-111111111111/d1111111-1111-1111-1111-111111111111/photo.png')::int,
  1,
  'Alice can see an attachment under her own account folder'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*) from storage.objects
     where bucket_id = 'card-attachments'
       and name = 'a1111111-1111-1111-1111-111111111111/d1111111-1111-1111-1111-111111111111/photo.png')::int,
  0,
  'Bob cannot see an attachment under Alice''s account folder'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values ('card-attachments', 'a1111111-1111-1111-1111-111111111111/some-other-card/sneaky.png',
            '22222222-2222-2222-2222-222222222222')$$,
  '42501',
  null,
  'Bob cannot upload into Alice''s account folder'
);

-- ── Personal-account bootstrap is idempotent under concurrency ──────────
-- Regression test for a real production bug: ensurePersonalAccount uses
-- INSERT ... ON CONFLICT DO NOTHING (via supabase-js .upsert with
-- ignoreDuplicates) so that two near-simultaneous calls for the same
-- brand-new user (confirmed happening for real — see FRICTION_LOG.md and
-- the migration this test file's neighbor introduces) both succeed
-- harmlessly instead of one throwing a duplicate-key error. That only works
-- if the accounts/account_users SELECT policies let a user see their own
-- not-yet-existing personal account row — otherwise Postgres's ON CONFLICT
-- probe itself gets blocked by RLS before any conflict is even found.
reset role;
insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'carol@example.com');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select lives_ok(
  $$insert into public.accounts (id, name, slug)
    values ('33333333-3333-3333-3333-333333333333', 'Carol''s Workspace', 'carol-ws')
    on conflict (id) do nothing$$,
  'A brand-new user can bootstrap their own personal account (first attempt)'
);

select lives_ok(
  $$insert into public.accounts (id, name, slug)
    values ('33333333-3333-3333-3333-333333333333', 'Carol''s Workspace', 'carol-ws')
    on conflict (id) do nothing$$,
  'Repeating the same bootstrap insert is a harmless no-op, not an error'
);

-- ── Join codes are not readable by non-members ──────────────────────────
-- The whole invite design rests on this: a stranger must not be able to
-- enumerate codes, which is why redeeming goes through a SECURITY DEFINER
-- function instead of a direct read + insert.
reset role;
insert into public.account_join_codes (id, account_id, code)
values (
  'aa111111-1111-1111-1111-111111111111',
  'a1111111-1111-1111-1111-111111111111',
  'secret-invite-code'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*) from public.account_join_codes
     where account_id = 'a1111111-1111-1111-1111-111111111111')::int,
  0,
  'Bob cannot read join codes for an account he is not in'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*) from public.account_join_codes
     where account_id = 'a1111111-1111-1111-1111-111111111111')::int,
  1,
  'Alice can read join codes for her own account'
);

-- ── Steps inherit the account boundary ──────────────────────────────────
reset role;
insert into public.steps (id, card_id, account_id, title)
values (
  'ee111111-1111-1111-1111-111111111111',
  'd1111111-1111-1111-1111-111111111111',
  'a1111111-1111-1111-1111-111111111111',
  'Alice''s step'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*) from public.steps
     where id = 'ee111111-1111-1111-1111-111111111111')::int,
  0,
  'Bob cannot see checklist steps on Alice''s card'
);

-- ── Webhooks are account-scoped too ─────────────────────────────────────
reset role;
insert into public.webhooks (id, account_id, url)
values (
  'ff111111-1111-1111-1111-111111111111',
  'a1111111-1111-1111-1111-111111111111',
  'https://example.com/alice-hook'
);

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is(
  (select count(*) from public.webhooks
     where id = 'ff111111-1111-1111-1111-111111111111')::int,
  0,
  'Bob cannot see webhooks configured on Alice''s account'
);

-- ── Webhook delivery fires on activity ──────────────────────────────────
-- The webhook row above belongs to Alice's account. Inserting an event in
-- that account should queue a delivery attempt (the HTTP call itself is
-- async via pg_net; what's assertable synchronously is the audit row).
reset role;
insert into public.events (id, account_id, board_id, card_id, actor_id, kind)
values (
  'bb111111-1111-1111-1111-111111111111',
  'a1111111-1111-1111-1111-111111111111',
  'b1111111-1111-1111-1111-111111111111',
  'd1111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  'card.created'
);

select is(
  (select count(*) from public.webhook_deliveries
     where event_id = 'bb111111-1111-1111-1111-111111111111'
       and webhook_id = 'ff111111-1111-1111-1111-111111111111')::int,
  1,
  'An event in the account queues a delivery for its registered webhook'
);

-- Bob's account has no webhooks, so an event there queues nothing.
insert into public.events (id, account_id, actor_id, kind)
values (
  'bb222222-2222-2222-2222-222222222222',
  'a2222222-2222-2222-2222-222222222222',
  '22222222-2222-2222-2222-222222222222',
  'card.created'
);

select is(
  (select count(*) from public.webhook_deliveries
     where event_id = 'bb222222-2222-2222-2222-222222222222')::int,
  0,
  'An event in an account with no webhooks queues no deliveries'
);

select * from finish();
rollback;
