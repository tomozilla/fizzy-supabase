-- Actually deliver webhooks. Until now `webhooks` rows could be registered
-- but nothing ever called them.
--
-- Fizzy does this with Solid Queue jobs (Webhook::Triggerable ->
-- Webhook::Delivery, with a DelinquencyTracker for endpoints that keep
-- failing). The Postgres-native equivalent is pg_net: fire-and-forget async
-- HTTP straight from a trigger, with the attempt recorded in
-- webhook_deliveries so there's still an audit trail — the piece the
-- friction log called out as missing when invoking an Edge Function
-- directly from a server action.
create extension if not exists pg_net with schema extensions;

create or replace function public.deliver_event_webhooks()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  hook record;
  payload jsonb;
  request_id bigint;
begin
  payload := jsonb_build_object(
    'event_id', new.id,
    'kind', new.kind,
    'account_id', new.account_id,
    'board_id', new.board_id,
    'card_id', new.card_id,
    'actor_id', new.actor_id,
    'data', new.data,
    'created_at', new.created_at
  );

  for hook in
    select id, url from public.webhooks
    where account_id = new.account_id and active
  loop
    -- pg_net queues the request and returns immediately; the trigger never
    -- blocks the originating write on a slow or dead endpoint.
    select net.http_post(
      url := hook.url,
      body := payload,
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 5000
    ) into request_id;

    insert into public.webhook_deliveries (webhook_id, account_id, event_id)
    values (hook.id, new.account_id, new.id);
  end loop;

  return new;
end;
$$;

revoke execute on function public.deliver_event_webhooks() from public, anon, authenticated;

create trigger on_event_deliver_webhooks
  after insert on public.events
  for each row execute procedure public.deliver_event_webhooks();

-- Deliveries are written by the trigger (security definer), but members
-- still need to be able to see their own account's attempts — the select
-- policy for that already exists from the previous migration.
