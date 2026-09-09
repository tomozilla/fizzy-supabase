-- Follow-up to 20260909032000: Supabase's default project setup grants
-- EXECUTE on every new `public` schema function directly to `anon` and
-- `authenticated` (via ALTER DEFAULT PRIVILEGES), separate from the implicit
-- PUBLIC grant revoked in the previous migration. Revoke those explicitly.

revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.fan_out_notifications() from anon, authenticated;

revoke execute on function public.is_account_member(uuid) from anon, authenticated;
grant execute on function public.is_account_member(uuid) to authenticated;
