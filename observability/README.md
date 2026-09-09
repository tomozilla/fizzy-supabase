# Local CDC + observability stack

Five containers next to the local Supabase stack:

```
Postgres --(logical replication)--> Debezium --> Kafka --> ClickHouse
Postgres --(pg_stat_*)-----------> OTel Collector --\
next dev --(OTLP)----------------> OTel Collector ---> Vector --> ClickHouse
Docker   --(container logs)------> Vector -----------/
```

Architecture and rationale: [`../docs/infrastructure.md`](../docs/infrastructure.md).
This file is the runbook.

## Start

Requires the local Supabase stack to be running first — the compose file joins
its Docker network by name.

```sh
supabase start          # from the project root, if not already up
cd observability
docker compose up -d
./scripts/bootstrap.sh  # publication + replica identity + connector
./scripts/verify.sh     # 11 checks
```

Add `--profile ui` to `docker compose up -d` for a Kafka UI on
<http://localhost:8080> (another ~400 MB of JVM; off by default).

## Where things listen

| Service | Host port | Notes |
|---|---|---|
| ClickHouse HTTP | 8123 | query UI at <http://localhost:8123/play>, `default` / `clickhouse` |
| ClickHouse native | 19000 | remapped from 9000 to avoid collisions |
| OTLP gRPC | 4317 | point your app here |
| OTLP HTTP | 4318 | point your app here |
| Kafka Connect | 8083 | Debezium REST API |
| Kafka | 29092 | external listener for CLI tools |
| Vector API | 8686 | health |

## Poking at it

```sh
# what CDC has seen
docker exec obs_clickhouse clickhouse-client --password clickhouse -q \
  "select db_table, op, count() from cdc.changes group by 1,2 order by 1,2"

# slowest spans
docker exec obs_clickhouse clickhouse-client --password clickhouse -q \
  "select name, round(duration_ns/1e6,1) ms from otel.traces order by duration_ns desc limit 10"

# which container is loudest
docker exec obs_clickhouse clickhouse-client --password clickhouse -q \
  "select service, count() from otel.logs group by 1 order by 2 desc"

# connector health
curl -s localhost:8083/connectors/fizzy-postgres/status | python3 -m json.tool

# topics
docker exec obs_kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list
```

## Sending traces from the app

`@supabase/supabase-js` propagates W3C trace context once you opt in, so spans
you create wrap the Supabase call and the resulting `trace_id` also shows up in
Supabase's own logs.

```ts
import '@supabase/supabase-js/tracing'  // required from 2.112.0
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(URL, KEY, { tracePropagation: true })
```

Point the OpenTelemetry SDK's OTLP exporter at `http://localhost:4318`.

## Stop

```sh
docker compose down            # keeps ClickHouse data
docker compose down -v         # drops it
```

Cleaning up the Postgres side matters more than the containers: an orphaned
replication slot makes Postgres retain WAL forever, which on a small volume is
an outage rather than a warning.

```sh
./scripts/teardown.sh          # drops the slot and the publication
```

## Gotchas worth knowing

- **`docker compose up -d` will not pick up a changed config file.** The
  configs are bind mounts, so compose sees no diff and does nothing. Use
  `docker compose restart <service>`. This cost real time during the build.
- **Validate Vector before restarting it:**
  `docker run --rm -v "$PWD/vector/vector.yaml:/etc/vector/vector.yaml:ro" timberio/vector:0.58.0-debian validate --no-environment /etc/vector/vector.yaml`
  A VRL error means Vector keeps running the *old* config, which looks exactly
  like a config that loaded but silently does nothing.
- **Kafka storage is ephemeral.** Restarting the broker loses topics and
  connector offsets. Re-run `bootstrap.sh`; it is idempotent.
- **ClickHouse takes ~40 s to become healthy** on first start. That is not a
  hang.
