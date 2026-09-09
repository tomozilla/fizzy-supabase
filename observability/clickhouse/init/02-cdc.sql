-- CDC landing tables, fed straight from Kafka by ClickHouse itself
-- (Kafka table engine + materialized view). No extra sink process.
--
-- Debezium is configured with schemas.enable=false, so each message is the
-- bare envelope:
--   {"before":{...}|null,"after":{...}|null,"source":{...},"op":"c|u|d|r","ts_ms":N}
--
-- The Kafka table reads it as one opaque String (JSONAsString) rather than
-- mapping columns. That means a Postgres schema change can never break
-- ingestion — it just changes what's inside `after`. Shredding happens in the
-- materialized view, where it is cheap to change.

CREATE DATABASE IF NOT EXISTS cdc;

CREATE TABLE IF NOT EXISTS cdc.kafka_raw
(
    raw String
)
ENGINE = Kafka
SETTINGS
    kafka_broker_list = 'kafka:9092',
    kafka_topic_list = 'fizzy.public.cards,fizzy.public.comments,fizzy.public.boards,fizzy.public.columns,fizzy.public.events',
    kafka_group_name = 'clickhouse_cdc',
    kafka_format = 'JSONAsString',
    kafka_num_consumers = 1,
    kafka_flush_interval_ms = 2000,
    kafka_skip_broken_messages = 10;

-- Append-only change history. This is the `MergeTree` event-log shape that
-- Supabase Pipelines would give you for a ClickHouse destination — modelled
-- by hand so the columns are visible.
CREATE TABLE IF NOT EXISTS cdc.changes
(
    ts       DateTime64(3)           CODEC(Delta, ZSTD(1)),
    topic    LowCardinality(String),
    db_table LowCardinality(String),
    op       LowCardinality(String), -- c=create u=update d=delete r=snapshot read
    lsn      UInt64                  CODEC(T64, ZSTD(1)),
    pk       String                  CODEC(ZSTD(1)),
    before   String                  CODEC(ZSTD(1)),
    after    String                  CODEC(ZSTD(1))
)
ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY (db_table, ts);

CREATE MATERIALIZED VIEW IF NOT EXISTS cdc.changes_mv TO cdc.changes AS
SELECT
    toDateTime64(JSONExtractUInt(raw, 'ts_ms') / 1000.0, 3)      AS ts,
    _topic                                                       AS topic,
    JSONExtractString(raw, 'source', 'table')                    AS db_table,
    JSONExtractString(raw, 'op')                                 AS op,
    JSONExtractUInt(raw, 'source', 'lsn')                        AS lsn,
    -- Deletes carry the old row in `before`, everything else in `after`.
    coalesce(
        nullIf(JSONExtractString(raw, 'after', 'id'), ''),
        JSONExtractString(raw, 'before', 'id')
    )                                                            AS pk,
    JSONExtractRaw(raw, 'before')                                AS before,
    JSONExtractRaw(raw, 'after')                                 AS after
FROM cdc.kafka_raw;

-- Current-state view over the change log: last write per primary key, with
-- deletes removed. This is what Pipelines' `ReplacingMergeTree` +
-- `<table>__current` view does for you; here it is one query so the mechanics
-- are legible.
CREATE VIEW IF NOT EXISTS cdc.cards_current AS
SELECT id, ts, after
FROM
(
    SELECT pk AS id, ts, op, after
    FROM cdc.changes
    WHERE db_table = 'cards'
    ORDER BY ts DESC
    LIMIT 1 BY pk
)
WHERE op != 'd';
