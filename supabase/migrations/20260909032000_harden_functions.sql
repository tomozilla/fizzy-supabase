-- Address findings from `get_advisors` (security lints) on the initial schema:
--   1. function_search_path_mutable — is_account_member had no fixed search_path.
--   2/3. security-definer functions callable directly via PostgREST RPC by
--      anon/authenticated, when they're only meant to be used by triggers or
--      by RLS policies internally.

create or replace function public.is_account_member(target_account_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.account_users
    where account_id = target_account_id and user_id = auth.uid()
  );
$$;

-- Trigger-only functions: never meant to be called directly over the API.
-- Triggers still fire regardless of these grants (trigger execution isn't
-- gated by the invoking role's EXECUTE privilege), so this only closes off
-- the accidental /rest/v1/rpc/... exposure.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.fan_out_notifications() from public;

-- is_account_member IS meant to be evaluated as part of RLS policies for
-- authenticated users, so it must stay executable by that role — that half
-- of the advisor warning is expected. We only close the anon-callable gap.
revoke execute on function public.is_account_member(uuid) from public;
grant execute on function public.is_account_member(uuid) to authenticated;
