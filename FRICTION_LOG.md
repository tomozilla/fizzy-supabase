# Build notes / friction log

Notes to myself on concrete issues hit while building this as a Supabase
learning project, in the order encountered. Each entry is something that
actually happened, not a guess at what might go wrong — kept here mostly so
future-me remembers why a piece of code looks the way it does.

## 1. Free-tier project cap (2 active projects) has no advance warning

Creating a second Supabase cloud project failed outright:

> "The following organization members have reached their maximum limits for
> the number of active free projects... (2 project limit)."

This is a reasonable limit, but on this brand-new account there was already
a pre-provisioned, empty default project (0 rows in every table) silently
occupying one of the two slots before I'd created anything myself. Nothing
surfaced that limit, or that a project already existed, until the
`create_project` call failed. A heads-up at account creation time ("You
have N/2 free projects used, here's what they are") would have saved a
failed API call and a "wait, what's already in my org?" detour.

## 2. Default privileges quietly re-grant EXECUTE to anon/authenticated

The security advisor correctly flagged that `is_account_member` (a
`SECURITY DEFINER` RLS helper) was callable directly via
`/rest/v1/rpc/is_account_member` by `anon`. The obvious fix —
`revoke execute on function ... from public;` — did **not** close the
finding; the advisor still reported it after the migration ran.

The actual cause: new projects apply `ALTER DEFAULT PRIVILEGES` granting
`EXECUTE` on every new `public`-schema function directly to `anon` and
`authenticated`, separate from (and in addition to) the implicit `PUBLIC`
grant. You have to `revoke ... from anon, authenticated` explicitly — the
advisor's own remediation link doesn't mention this, so closing a
straightforward-looking WARN took two migrations and a manual
`has_function_privilege` check to figure out why the first fix didn't
work. Worth calling out on the lint page itself, since "just revoke from
public" is the natural first read of the remediation text.

## 3. RLS chicken-and-egg on insert-then-return for the *first* row in a
   new tenant

Creating a brand-new `account` and immediately reading it back
(`.insert({...}).select().single()`, i.e. `Prefer: return=representation`)
failed with `new row violates row-level security policy for table
"accounts"` — even though the INSERT's `with check (true)` should have
allowed it outright.

Root cause: PostgREST re-selects the inserted row to return it, and that
SELECT is gated by "members can view their accounts," which checks
`account_users` membership — a row that, for a first-time account, is
created in the *next* statement, not yet present. The insert itself always
succeeded; only the automatic post-insert read failed, which makes the
error message ("violates row-level security policy... **for table
accounts**", on an *insert* call) actively misleading about which
operation and which policy actually failed.

The fix (generate the id client-side, skip `.select()` on that one insert)
is simple once you know the cause, but the error surface gives no hint that
it's actually a SELECT-policy problem manifesting on an INSERT request.
This is exactly the kind of thing a "create your first tenant" quickstart
would hit on the very first API call — worth either a dedicated docs
callout, or detecting the pattern (insert + immediate representation
request + a SELECT policy that can't yet be satisfied) and surfacing a
clearer hint in the error.

## 4. Cache Components (Next.js 16 default) breaks on every dynamic page,
   with no warning from the Supabase starter itself

`create-next-app -e with-supabase` scaffolds with `cacheComponents: true`
in `next.config.ts`. Any page doing per-user Supabase queries (i.e. nearly
every real page in an app built on this starter) fails the production
build with a generic "Next.js encountered uncached or runtime data during
prerendering" error unless manually restructured into a synchronous
wrapper + an async component wrapped in `<Suspense>`.

This isn't a Supabase bug — it's a Next.js 16 behavior — but it's Supabase's
own official starter template that ships this config on by default while
only demonstrating the required pattern on one page
(`app/protected/page.tsx`) and not explaining *why* that page is shaped
that way. Every new page you add following the template's own
`app/protected/page.tsx` example less literally (e.g. putting the fetch
directly in the default export, which is the more obvious thing to do)
breaks at build time. A comment in the template, or in
`docs/data-fetching.md`, saying "wrap any Supabase-querying page content in
Suspense, here's why" would have saved real time — this bit me on the very
first page I wrote past the template's own examples.

## 5. Built-in email provider's rate limit blocks a *second* test signup
   within the same session

Testing RLS cross-account isolation requires two real users. The first
signup worked; the second (a throwaway test address, requested only
seconds later) failed immediately with
`{"code":429,"error_code":"over_email_send_rate_limit"}`.

This is presumably intentional abuse protection on the shared/default email
provider, but it means multi-user testing during initial development
(exactly when you're most likely to want to create several test accounts
back-to-back) is blocked by default with no visible guidance in the error
toward "configure custom SMTP" or "here's how to raise this for a dev
project." Ended up testing isolation via direct SQL role-simulation
(`set local role authenticated; set local request.jwt.claims = ...`)
instead of real signups — a fine workaround once you know Postgres RLS can
be tested that way, but not something a newcomer would reach for first.

## 6. `INSERT ... ON CONFLICT DO NOTHING` can itself get blocked by RLS,
   independent of whether a conflict actually exists

A "create my personal account on first login" bootstrap needs to be safe
under concurrency (confirmed for real in production — two near-simultaneous
requests for the same brand-new user, most likely Next.js's own
double-invocation of a Suspense-streamed dynamic segment, not just a router
prefetch). The standard fix is `INSERT ... ON CONFLICT DO NOTHING`
(`supabase-js`'s `.upsert(row, { ignoreDuplicates: true })`) — but this
failed with the same `new row violates row-level security policy` error as
issue #3 above, on the very first insert, with no existing row to conflict
with at all.

Root cause: Postgres's `ON CONFLICT` clause has to probe for a pre-existing
conflicting row, and that probe is itself subject to the table's RLS SELECT
policy. Our SELECT policy required existing account membership — which,
for a first-time user, doesn't exist yet — so the conflict probe got
rejected by RLS regardless of whether a real conflict existed. The fix was
adding `or id = auth.uid()` to the SELECT policy (safe here specifically
because personal-account ids are defined to equal their owning user's id),
letting a user always see their own not-yet-existing personal account row.

This is a sharp edge: `ON CONFLICT` needing SELECT visibility to function
is a general Postgres behavior, not Supabase-specific, but it interacts
with RLS in a way that's easy to not anticipate — "insert this row, ignore
it if it already exists" reads as a pure write operation, not one that also
requires read access. Worth calling out explicitly wherever upsert +
RLS-under-concurrency patterns are documented.

## 7. `supabase config push` doesn't manage passkey settings

Enabling passkeys locally is a clean two-key config change
(`[auth.passkey] enabled = true` plus `[auth.webauthn]` rp settings), and it
works well — Supabase Auth runs the entire WebAuthn ceremony, so the app
side is one `registerPasskey()` call and one `signInWithPasskey()` call.

But `supabase config diff` against a hosted project doesn't list those keys
at all: not as a difference, not even in the "declared but not compared"
list. So the local project has passkeys on and the hosted one doesn't, with
no way to close that gap through the same migration-style workflow used for
everything else. Enabling them on a hosted project means going to the
dashboard, which breaks the otherwise-strong "config lives in the repo"
story.

Related: `[auth.*]` changes need a full `supabase stop && supabase start` to
take effect. `supabase db reset` restarts Postgres but leaves the Auth
container with its old environment, so the setting looks like it silently
didn't apply. Ten confusing minutes until the container env made it obvious.

## 8. WebAuthn config can't be shared between local and production

`rp_id` has to be a registrable suffix of every origin the app is served
from, so `localhost` and `fizzy-supabase.vercel.app` genuinely can't share
one value. `config.toml` supports `env(...)` substitution, which solves it
cleanly — and pleasantly, a comma-separated env var expands correctly into
the `rp_origins` *array*, which wasn't obvious from the docs and was worth
confirming before relying on it.

## 9. ClickHouse's TTL silently deletes rows a bad timestamp put in 1970

Building the local telemetry pipeline, spans reached Vector, the transform
produced correct output, Vector logged no errors, ClickHouse logged no
errors — and `select count() from otel.traces` stayed at zero.

The cause was two layers away from the symptom. Vector's OpenTelemetry
source keeps the OTLP field name `start_time_unix_nano` but has *already*
decoded the value into a real timestamp. Calling `to_int()` on a timestamp
in VRL is legal and returns **seconds**, which the transform then handed to
`from_unix_timestamp(..., unit: "nanoseconds")`. Every span was dated to
1970-01-01, the table's `TTL … + INTERVAL 7 DAY` considered it long
expired, and ClickHouse dropped the rows almost immediately after
accepting the insert.

Nothing in this chain is a bug — a field named `..._unix_nano` holding a
timestamp is a reasonable convenience, `to_int` on a timestamp is a
documented coercion, and TTL doing its job is the whole point. But the
combination produces a pipeline that reports success at every hop and
stores nothing. What eventually found it was checking
`system.query_log`, which showed the `INSERT` had genuinely arrived. Any
TTL'd table is worth a moment's thought about what happens to a row whose
timestamp is wrong, because "the data silently isn't there" is a much
worse failure mode than a rejected insert.

## 10. Vector's ClickHouse sink drops trace events without saying so

Vector's `opentelemetry` source exposes three outputs — `otlp.logs`,
`otlp.metrics`, `otlp.traces` — and `vector validate` happily accepts a
topology wiring `otlp.traces` through a `remap` into a `clickhouse` sink.
At runtime, nothing arrives and nothing is logged.

The reason is that Vector has a distinct *trace* event type, and the
`clickhouse` sink only handles *log* events. A `remap` preserves the event
type, so the events stay traces all the way to a sink that quietly discards
them. `metric_to_log` exists for the metrics case; there is no
`trace_to_log`.

Two things made this expensive to find. `vector validate` passes, because
`remap` legitimately accepts every event type and the checker can't know
what will actually flow through it. And the discard is silent — no warning,
no `component_discarded_events_total` in the logs. Proving the sink was at
fault meant putting a `console` sink immediately before it, seeing perfect
output, and still finding no `INSERT` in ClickHouse's `system.query_log`.

The workaround: have the Collector send traces as OTLP **JSON** to a plain
`http_server` source instead, which produces log events, then unroll
`resourceSpans[].scopeSpans[].spans[]` in VRL. More code, but it also
avoids the `to_int` trap from #9 — in raw OTLP JSON the nanosecond fields
really are integers-as-strings. A sink refusing a type it can't handle,
loudly, would have saved an hour.

## 11. `docker compose up -d` ignores changed bind-mounted config

Self-inflicted, but worth writing down because it corrupted several
debugging conclusions before I noticed.

All five services here take their config from bind-mounted files. Editing
one and running `docker compose up -d <service>` does **nothing**: compose
diffs the container spec, not the contents of mounted files, sees no
change, and leaves the old process running. Two of my "that fix didn't
work" conclusions were actually "that fix never loaded," and one of them
sent me redesigning a component that was fine.

`docker compose restart <service>` is the right command. The related trap:
when Vector *does* restart with an invalid VRL program, it logs the
compile error and keeps running the previous config — which looks identical
to a config that loaded and silently does nothing. Validating first turns
that into an immediate, readable error:

```sh
docker run --rm -v "$PWD/vector/vector.yaml:/etc/vector/vector.yaml:ro" \
  timberio/vector:0.58.0-debian validate --no-environment /etc/vector/vector.yaml
```

## 12. Small papercuts in the same stack

Three that each cost a few minutes:

- **`localhost` in a container healthcheck.** ClickHouse binds IPv4 only;
  the alpine image resolves `localhost` to `::1` first, so
  `wget http://localhost:8123/ping` fails against a perfectly healthy
  server. Dependent services then refuse to start on a false negative.
  `127.0.0.1` fixes it. ClickHouse also needs ~40s to first respond, which
  is longer than a default `start_period` allows for.
- **VRL has no `to_timestamp`**, though it has `to_int`, `to_float`,
  `to_string` and `is_timestamp`. The type-assertion form is `timestamp()`.
  The error message does suggest `is_timestamp`, which is close enough to
  be actively misleading.
- **VRL rejects `if` expressions inside object literals.** `{"a": if x { 1 }
  else { 2 }}` is a syntax error; the condition has to be hoisted to a
  variable first. Reasonable, but the parser error points at the following
  line.

## 13. Debezium's stored offsets outlive the replication slot they point at

Found by testing the teardown path rather than the happy path, which is the
only reason it was found at all.

`teardown.sh` originally deleted the connector and dropped the replication
slot — the two things that obviously belong to CDC. Re-running
`bootstrap.sh` afterwards then reported success at every step: publication
created, connector registered, task `RUNNING`. Seconds later the task went
`FAILED` with:

> The connector is trying to read change stream starting at
> `PostgresOffsetContext [... lsn=LSN{0/2CA13C8} ...]`, but this is no
> longer available on the server. Reconfigure the connector to use a
> snapshot mode when needed.

Kafka Connect keeps each connector's progress in an internal Kafka topic
(`_connect_offsets` here), which is a completely separate lifetime from both
the connector and the Postgres slot. Deleting the connector does not clear
it. So a clean-looking teardown leaves a stored LSN that the freshly created
slot can't satisfy, and the next bootstrap fails *after* reporting success.

The error message is genuinely good — it names the LSN and suggests the fix
— but the remedy it hints at ("reconfigure to use a snapshot mode") is
misleading here, because `snapshot.mode` was already `initial`; the mode
isn't the problem, the stale offset is. The actual fix is the
offsets API added in Kafka 3.6:

```sh
curl -X PUT    localhost:8083/connectors/NAME/stop
curl -X DELETE localhost:8083/connectors/NAME/offsets
curl -X PUT    localhost:8083/connectors/NAME/resume
```

Both scripts now handle it: teardown clears offsets before dropping the
slot, and bootstrap detects this specific failure and self-heals rather than
leaving a connector that says `RUNNING` and then quietly isn't. The broader
lesson is that a CDC pipeline has state in three independent places —
Postgres slot, Connect offsets, Kafka topics — and any teardown that forgets
one of them produces a failure that surfaces on the *next* setup, far from
its cause.

## What worked well

- `supabase link` + `supabase db push` for cloud migrations was completely
  frictionless — no surprises, matches the mental model of `rails db:migrate`
  almost exactly.
- `get_advisors` catching real, correct security issues (see #2) before any
  of this shipped anywhere — genuinely useful, caught things a manual
  review would likely have missed.
- `supabase gen types typescript` against the live project produced
  immediately usable types with zero configuration.
- Realtime (`postgres_changes`) worked first try, no reconnect/backoff code
  needed for a simple case.
- `pg_net` made outgoing webhooks a ~40 line trigger with no queue, no worker
  and no extra service — the write returns immediately and the HTTP call
  happens out of band.
- Passkeys were the single biggest effort-to-payoff win of the whole
  project: a config toggle plus two client calls replaced what is an entire
  hand-rolled `Passkey::Authenticator` in Fizzy, and Chromium's virtual
  authenticator made it genuinely testable end to end.
- `supabase test db` (pgTAP) running against a disposable copy of the local
  stack is a much better story than it sounds on paper — RLS policies are
  exactly the kind of thing that needs testing at the database level, and
  this makes that a one-command habit.
- The local stack being *real* Postgres, with `wal_level = logical` already
  set and the `postgres` role carrying `rolreplication`, meant pointing
  Debezium at it took no configuration on the Supabase side at all — one
  `create publication` and it worked. A lot of managed Postgres services
  make this the hard part.
- `supabase start` putting everything on a named Docker network
  (`supabase_network_<project>`) makes an external stack trivial to attach:
  declare the network as `external` in your own compose file and containers
  reach the database as `supabase_db_<project>:5432`. No host networking, no
  IP juggling.
