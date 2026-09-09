#!/usr/bin/env bash
# Brings the stack from "containers running" to "data flowing".
# Idempotent: safe to re-run.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_CONTAINER="${DB_CONTAINER:-supabase_db_fizzy-supabase}"
CONNECT_URL="${CONNECT_URL:-http://localhost:8083}"

say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m /!\\\033[0m %s\n' "$*"; }
die() {
  printf '\033[1;31mxxx\033[0m %s\n' "$*" >&2
  exit 1
}

# --- 1. the local Supabase stack has to be up first -----------------------
docker inspect "$DB_CONTAINER" >/dev/null 2>&1 ||
  die "$DB_CONTAINER is not running. Run 'supabase start' in the project root first."

say "Preparing Postgres (publication + replica identity)"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  <"$HERE/debezium/prepare-postgres.sql"

# --- 2. wait for Kafka Connect -------------------------------------------
say "Waiting for Kafka Connect at $CONNECT_URL"
for i in $(seq 1 60); do
  if curl -sf "$CONNECT_URL/connectors" >/dev/null 2>&1; then break; fi
  [ "$i" = 60 ] && die "Kafka Connect never came up. Check: docker compose logs connect"
  sleep 3
done

# --- 3. register (or update) the Debezium connector -----------------------
say "Registering Debezium connector"
# PUT .../config is the idempotent form: create if absent, update if present.
config=$(python3 -c "
import json,sys
print(json.dumps(json.load(open('$HERE/debezium/postgres-connector.json'))['config']))
")
curl -sf -X PUT -H 'Content-Type: application/json' \
  --data "$config" \
  "$CONNECT_URL/connectors/fizzy-postgres/config" >/dev/null ||
  die "Connector registration failed. Check: docker compose logs connect"

# --- 4. wait for it to actually reach RUNNING -----------------------------
say "Waiting for the connector to reach RUNNING"
for i in $(seq 1 40); do
  status=$(curl -sf "$CONNECT_URL/connectors/fizzy-postgres/status" 2>/dev/null || echo '{}')
  state=$(printf '%s' "$status" | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
    tasks = d.get('tasks', [])
    print(tasks[0]['state'] if tasks else d.get('connector', {}).get('state', 'PENDING'))
except Exception:
    print('PENDING')
")
  case "$state" in
  RUNNING)
    say "Connector RUNNING"
    break
    ;;
  FAILED)
    # Recoverable case: the connector's stored LSN points into a replication
    # slot that no longer exists (someone ran teardown.sh, or the slot was
    # dropped by hand). Clearing the Connect-managed offsets makes it take a
    # fresh snapshot instead. Anything else is a real failure.
    if printf '%s' "$status" | grep -q "no longer available on the server"; then
      warn "Stored offsets point at a dropped slot; resetting and re-snapshotting"
      curl -sf -X PUT "$CONNECT_URL/connectors/fizzy-postgres/stop" >/dev/null 2>&1 || true
      sleep 3
      curl -sf -X DELETE "$CONNECT_URL/connectors/fizzy-postgres/offsets" >/dev/null 2>&1 ||
        die "Could not reset connector offsets"
      curl -sf -X PUT "$CONNECT_URL/connectors/fizzy-postgres/resume" >/dev/null 2>&1 || true
      sleep 5
      continue
    fi
    printf '%s\n' "$status" | python3 -m json.tool >&2
    die "Connector FAILED"
    ;;
  esac
  [ "$i" = 40 ] && warn "Connector still $state after 2 minutes; check its status"
  sleep 3
done

say "Done. Try: ./scripts/verify.sh"
