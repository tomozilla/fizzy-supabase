-- Storage bucket for card attachments, paired with the `attachments` table
-- from the initial schema. Fizzy uses Rails Active Storage (local disk in
-- dev, S3 in production, tracked via `Storage::Entry`/`Storage::Total` for
-- per-account quota). Supabase Storage plays the same role here, with the
-- tenant boundary enforced by encoding the account id into the object path
-- (`{account_id}/{card_id}/{filename}`) and checking it in the RLS policy —
-- storage.objects doesn't have an account_id column of its own to filter on.
insert into storage.buckets (id, name, public)
values ('card-attachments', 'card-attachments', false)
on conflict (id) do nothing;

create policy "Members can read attachments in their account's folder"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'card-attachments'
    and public.is_account_member(((storage.foldername(name))[1])::uuid)
  );

create policy "Members can upload attachments into their account's folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'card-attachments'
    and public.is_account_member(((storage.foldername(name))[1])::uuid)
  );

create policy "Members can delete attachments in their account's folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'card-attachments'
    and public.is_account_member(((storage.foldername(name))[1])::uuid)
  );
