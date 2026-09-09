#!/usr/bin/env bash
# Removes the Postgres-side footprint. Run this before `docker compose down`
# if you are done with CDC for a while.
#
# The replication slot is the part that actually matters: an inactive slot
# makes Postgres retain WAL indefinitely, which fills the volume and takes the
# database down. Deleting the containers does NOT remove it.
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-supabase_db_fizzy-supabase}"
CONNECT_URL="${CONNECT_URL:-http://localhost:8083}"

say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }

# Order matters. Kafka Connect stores the last-read LSN in a Kafka topic that
# outlives both the connector and the replication slot. Dropping the slot
# without clearing those offsets leaves a landmine: the next bootstrap
# registers cleanly, then fails with "the connector is trying to read change
# stream starting at LSN{...}, but this is no longer available on the server".
say "Stopping the connector and clearing its stored offsets"
curl -sf -X PUT "$CONNECT_URL/connectors/fizzy-postgres/stop" >/dev/null 2>&1 || true
sleep 3
curl -sf -X DELETE "$CONNECT_URL/connectors/fizzy-postgres/offsets" >/dev/null 2>&1 || true

say "Removing the Debezium connector (releases the slot)"
curl -sf -X DELETE "$CONNECT_URL/connectors/fizzy-postgres" >/dev/null 2>&1 ||
  echo "    connector already gone"

sleep 3

say "Dropping the replication slot and publication"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres <<'SQL'
select pg_drop_replication_slot('dbz_fizzy')
where exists (select 1 from pg_replication_slots where slot_name = 'dbz_fizzy');

drop publication if exists dbz_fizzy;

-- Back to the default. Full replica identity is only needed for CDC and it
-- costs WAL volume on every update and delete.
alter table public.cards    replica identity default;
alter table public.comments replica identity default;
alter table public.boards   replica identity default;
alter table public.columns  replica identity default;
alter table public.events   replica identity default;

select slot_name, active from pg_replication_slots;
SQL

say "Done. 'docker compose down' now leaves nothing behind in Postgres."
