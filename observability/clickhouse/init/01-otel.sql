-- Telemetry landing tables. Vector is the only writer.
--
-- Deliberately hand-rolled rather than using the ClickHouse OTel exporter's
-- schema: the point of this stack is to see what the columns actually are.

CREATE DATABASE IF NOT EXISTS otel;

CREATE TABLE IF NOT EXISTS otel.logs
(
    timestamp  DateTime64(9)             CODEC(Delta, ZSTD(1)),
    source     LowCardinality(String),   -- 'docker' | 'otlp'
    service    LowCardinality(String),
    severity   LowCardinality(String),
    trace_id   String                    CODEC(ZSTD(1)),
    span_id    String                    CODEC(ZSTD(1)),
    message    String                    CODEC(ZSTD(1)),
    attributes String                    CODEC(ZSTD(1))
)
ENGINE = MergeTree
PARTITION BY toDate(timestamp)
ORDER BY (service, timestamp)
TTL toDateTime(timestamp) + INTERVAL 7 DAY;

CREATE TABLE IF NOT EXISTS otel.metrics
(
    timestamp DateTime64(3)            CODEC(Delta, ZSTD(1)),
    name      LowCardinality(String),
    kind      LowCardinality(String),
    value     Float64                  CODEC(Gorilla, ZSTD(1)),
    tags      Map(LowCardinality(String), String)
)
ENGINE = MergeTree
PARTITION BY toDate(timestamp)
ORDER BY (name, timestamp)
TTL toDateTime(timestamp) + INTERVAL 7 DAY;

CREATE TABLE IF NOT EXISTS otel.traces
(
    timestamp      DateTime64(9)           CODEC(Delta, ZSTD(1)),
    trace_id       String                  CODEC(ZSTD(1)),
    span_id        String                  CODEC(ZSTD(1)),
    parent_span_id String                  CODEC(ZSTD(1)),
    service        LowCardinality(String),
    name           LowCardinality(String),
    kind           LowCardinality(String),
    duration_ns    UInt64                  CODEC(T64, ZSTD(1)),
    status_code    LowCardinality(String),
    attributes     String                  CODEC(ZSTD(1))
)
ENGINE = MergeTree
PARTITION BY toDate(timestamp)
ORDER BY (service, timestamp)
TTL toDateTime(timestamp) + INTERVAL 7 DAY;
