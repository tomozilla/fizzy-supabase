-- Fixes a real production bug: `ensurePersonalAccount` used
-- `upsert(..., { ignoreDuplicates: true })` (INSERT ... ON CONFLICT DO
-- NOTHING) to make first-time account bootstrap safe under concurrency.
-- That's the right idea, but Postgres's ON CONFLICT clause needs to probe
-- for an existing conflicting row, which itself requires SELECT visibility
-- under RLS — and the existing "members can view their accounts" policy
-- requires an account_users row that, for a first-time user, doesn't exist
-- yet. Result: the ON CONFLICT check itself gets blocked by RLS with
-- `new row violates row-level security policy for table "accounts"`,
-- regardless of whether an actual conflict exists.
--
-- Fix: a user can always see the account row whose id equals their own —
-- correct because a personal account's id *is* its owning user's id by our
-- bootstrap convention (see ensurePersonalAccount in app/actions.ts), so
-- this doesn't grant visibility into anyone else's account.
drop policy if exists "Members can view their accounts" on public.accounts;

create policy "Members can view their accounts" on public.accounts for select
  to authenticated
  using (public.is_account_member(id) or id = auth.uid());

-- Same problem, one level down: account_users' own SELECT policy required
-- is_account_member(account_id) — which itself queries account_users — so a
-- user's very first membership row hit the identical ON-CONFLICT-needs-
-- SELECT issue. A user can always see their own membership rows regardless
-- of the account-roster check (which is for seeing *other* members of an
-- account you already belong to — a different, still-valid access pattern
-- kept alongside this one).
drop policy if exists "Members can view account membership" on public.account_users;

create policy "Members can view account membership" on public.account_users for select
  to authenticated
  using (public.is_account_member(account_id) or user_id = auth.uid());
