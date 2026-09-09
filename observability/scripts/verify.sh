#!/usr/bin/env bash
# End-to-end proof that all four paths carry data. Writes a real row to
# Postgres and a real span to the collector, then polls ClickHouse for both.
set -uo pipefail

DB_CONTAINER="${DB_CONTAINER:-supabase_db_fizzy-supabase}"
CH="docker exec obs_clickhouse clickhouse-client --password clickhouse -q"
pass=0 fail=0

ok() {
  printf '  \033[32m✓\033[0m %s\n' "$1"
  pass=$((pass + 1))
}
no() {
  printf '  \033[31m✗\033[0m %s\n' "$1"
  fail=$((fail + 1))
}

# Poll rather than sleep: the pipeline is asynchronous end to end and a fixed
# sleep either flakes or wastes time.
poll() { # poll <seconds> <sql> -> succeeds when the query returns > 0
  local deadline=$((SECONDS + $1)) out
  while [ $SECONDS -lt $deadline ]; do
    out=$($CH "$2" 2>/dev/null | tr -d '[:space:]')
    [ -n "$out" ] && [ "$out" != "0" ] && return 0
    sleep 2
  done
  return 1
}

echo "containers"
for c in obs_kafka obs_connect obs_clickhouse obs_vector obs_otelcol; do
  if [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = "true" ]; then
    ok "$c running"
  else
    no "$c not running"
  fi
done

echo "debezium"
state=$(curl -sf http://localhost:8083/connectors/fizzy-postgres/status 2>/dev/null |
  python3 -c "import json,sys; d=json.load(sys.stdin); print(d['tasks'][0]['state'])" 2>/dev/null)
[ "$state" = "RUNNING" ] && ok "connector RUNNING" || no "connector state: ${state:-unreachable}"

slot=$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -tAc \
  "select active from pg_replication_slots where slot_name='dbz_fizzy'" 2>/dev/null | tr -d '[:space:]')
[ "$slot" = "t" ] && ok "replication slot active" || no "replication slot inactive"

echo "cdc: postgres -> debezium -> kafka -> clickhouse"
probe="verify-$RANDOM"
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -q -c \
  "insert into public.boards (id, account_id, name)
   select gen_random_uuid(), (select id from public.accounts limit 1), '$probe';" >/dev/null 2>&1
if poll 45 "select count() from cdc.changes where JSONExtractString(after,'name')='$probe'"; then
  ok "inserted row reached ClickHouse"
else
  no "inserted row never arrived"
fi
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -q -c \
  "delete from public.boards where name='$probe';" >/dev/null 2>&1

echo "telemetry: otel -> vector -> clickhouse"
tid=$(python3 -c "import secrets;print(secrets.token_hex(16))")
python3 - "$tid" >/tmp/verify-span.json <<'PY'
import json, sys, time
ns = int(time.time() * 1e9)
print(json.dumps({"resourceSpans": [{
    "resource": {"attributes": [{"key": "service.name", "value": {"stringValue": "verify"}}]},
    "scopeSpans": [{"spans": [{
        "traceId": sys.argv[1], "spanId": "aaaaaaaaaaaaaaaa", "parentSpanId": "",
        "name": "verify-span", "kind": 2,
        "startTimeUnixNano": str(ns), "endTimeUnixNano": str(ns + 7_000_000),
        "status": {"code": 1}}]}]}]}))
PY
curl -sf -o /dev/null -X POST http://localhost:4318/v1/traces \
  -H 'Content-Type: application/json' --data @/tmp/verify-span.json 2>/dev/null

if poll 40 "select count() from otel.traces where trace_id='$tid'"; then
  ok "span reached ClickHouse"
else
  no "span never arrived"
fi
poll 40 "select count() from otel.metrics where timestamp > now() - interval 3 minute" &&
  ok "postgres metrics flowing" || no "no recent metrics"
poll 40 "select count() from otel.logs where timestamp > now() - interval 5 minute" &&
  ok "container logs flowing" || no "no recent logs"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
