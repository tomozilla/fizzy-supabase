-- Prepares the LOCAL Supabase database for Debezium.
--
-- Intentionally not a Supabase migration: `replica identity full` roughly
-- doubles WAL volume for updates and deletes, which is a cost you do not want
-- to pay on the hosted project just to run a demo CDC pipeline locally.
-- Run it with observability/scripts/bootstrap.sh instead.

-- Our own publication. Never reuse `supabase_realtime` — Realtime manages
-- that one, and adding tables to it changes what clients receive.
drop publication if exists dbz_fizzy;
create publication dbz_fizzy
  for table public.cards,
            public.comments,
            public.boards,
            public.columns,
            public.events;

-- Debezium needs the full pre-image to emit a usable `before` on updates and
-- deletes. With the default (primary-key) replica identity, `before` is null
-- and you cannot tell what actually changed.
alter table public.cards    replica identity full;
alter table public.comments replica identity full;
alter table public.boards   replica identity full;
alter table public.columns  replica identity full;
alter table public.events   replica identity full;

select 'publication' as kind, pubname as name from pg_publication where pubname = 'dbz_fizzy'
union all
select 'table', schemaname || '.' || tablename from pg_publication_tables where pubname = 'dbz_fizzy';
