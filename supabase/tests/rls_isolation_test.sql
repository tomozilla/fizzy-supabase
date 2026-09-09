-- RLS policy tests: verifies account isolation is actually enforced by
-- Postgres, not just that the policy SQL "looks right". Run with
-- `supabase test db` (spins up a disposable copy of the local stack).
--
-- These exercise the same property proven manually against the live cloud
-- project earlier (role-simulation + a real REST API round trip) — codified
-- here so it's checked on every change instead of by hand.
begin;
select plan(9);

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

select * from finish();
rollback;
