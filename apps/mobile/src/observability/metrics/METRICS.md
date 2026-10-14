# Application metrics

This is the catalog of metrics emitted by the mobile observability layer in
`src/observability/metrics`. The TypeScript source of truth is
[`metrics.ts`](./metrics.ts).

When adding or changing a metric, update both `metrics.ts` and this file.

Metrics aggregate measurements across many app runs. Do not use user IDs,
message IDs, channel IDs, workspace IDs, URLs, or other unbounded values as
metric attributes. Keep those identifiers in structured logs. The random
`session_id` on `app_session_heartbeat` is the only approved exception because
distinguishing simultaneous counter writers is required to count live sessions.

## Export rules

Metrics preserve the existing build-mode behavior:

| Build              | Default  |
| ------------------ | -------- |
| Production release | Enabled  |
| Sandbox release    | Enabled  |
| Production debug   | Disabled |
| Development/debug  | Disabled |

`LOTUS_METRICS_ENABLED=true` explicitly enables exporting in any build.
`LOTUS_METRICS_ENABLED=false` explicitly disables it in any build.

The flag is read by `app.config.js` and baked into the app bundle. Restart Metro
or rebuild the app after changing it.

For local or isolated testing, set `LOTUS_TELEMETRY_ENDPOINT` to the base URL of
a non-production telemetry bridge. The app appends `/godel/v1/metrics`. An empty
or unset override uses the default host for the current app variant. Do not
enable a dev build without checking its destination, because reloads and
repeated test journeys can pollute production metrics.

Example:

```dotenv
LOTUS_METRICS_ENABLED=true
LOTUS_TELEMETRY_ENDPOINT=http://localhost:4001
```

Counters and histograms from `MetricsService` (startup, heartbeat, chat
journeys, zero latency) export with **cumulative temporality**: each flush sends
the process lifetime total so far. VictoriaMetrics and the Grafana dashboards
query these with `increase()` over the selected range.

Do **not** switch this exporter to delta: Godel returns HTTP 200 for delta OTLP
but VictoriaMetrics drops those samples.

Notification delivery counters are different: headless Android FCM wakes and the
iOS Notification Service Extension POST one-shot cumulative payloads through
`flushNotificationDeliveryMetrics.ts` instead of the OpenTelemetry SDK exporter.

## Shared resource attributes

Every metric export includes:

| Attribute                     | Meaning                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `service.name`                | OpenTelemetry service name (`xynespaces-native`)                                                             |
| `service.version`             | Native app version (`DeviceInfo.getVersion()`, e.g. `102.0.0`), not Expo `app.config.js` `version` (`1.0.0`) |
| `app.build.version`           | Native build number                                                                                          |
| `deployment.environment.name` | `dev`, `sandbox`, or `prod`                                                                                  |
| `os.type`                     | `android` or `ios`                                                                                           |

## `app_session_heartbeat`

**Type:** Counter

**Unit:** Dimensionless count (`1`)

**Purpose:** Estimates how many app sessions were actively in the foreground
during a recent time window.

**Recorded when:** Once immediately when metrics start in a foreground app, then
once every 30 seconds while the app remains in the foreground. Recording pauses
in the background and resumes immediately on the next foreground.

**Attributes:**

| Attribute    | Allowed values       | Meaning                                |
| ------------ | -------------------- | -------------------------------------- |
| `session_id` | Random UUID per load | Separates simultaneous session writers |

The random ID is not an email, user ID, device ID, or stable identity. It is
created in memory when the JavaScript bundle loads. Its high cardinality is
intentional and limited to this heartbeat metric. Platform and app version are
already resource attributes.

The expected VictoriaMetrics series is:

```text
app_session_heartbeat_total
```

Example active sessions over the last two minutes:

```promql
count(
  sum by (session_id) (
    increase(app_session_heartbeat_total{
      service_name="xynespaces-native"
    }[2m])
  ) > 0
)
```

`increase` checks whether each session's counter advanced during the window. The
comparison removes inactive series and `count` counts the remaining session IDs.
A two-minute lookback tolerates delayed exports while allowing a backgrounded or
terminated session to disappear from the result.

This is not a unique-user count: one user active on two devices counts as two
sessions. It is a recent-window count, not an exact instantaneous connection
count.

## `app_startup_duration`

**Type:** Histogram

**Unit:** Milliseconds (`ms`)

**Purpose:** Measures user-perceived cold-start time from the native application
launch anchor until the initial destination is ready.

**Recorded when:** `emitStartupCompleted` receives a completed cold-start
measurement. An abandoned or incomplete startup does not record it.

**Attributes:**

| Attribute       | Allowed values                                        | Meaning                                  |
| --------------- | ----------------------------------------------------- | ---------------------------------------- |
| `launch_cause`  | `direct`, `notification`, `call`, `deeplink`, `share` | What initiated the app launch            |
| `destination`   | `dms`, `login`, `enrollment`                          | Initial destination that became ready    |
| `native_anchor` | `app`, `activity`                                     | Native monotonic-time anchor used for T0 |

**Histogram boundaries (ms):**

```text
100, 250, 500, 1000, 2000, 3000, 5000, 7500,
10000, 20000, 30000, 60000
```

The OTLP-to-Prometheus translation expands the unit and stores these series in
VictoriaMetrics:

```text
app_startup_duration_milliseconds_bucket
app_startup_duration_milliseconds_count
app_startup_duration_milliseconds_sum
```

Example total count query:

```promql
app_startup_duration_milliseconds_count{
  service_name="xynespaces-native"
}
```

Example average over the selected Grafana dashboard range:

```promql
sum(increase(app_startup_duration_milliseconds_sum{
  service_name="xynespaces-native"
}[$__range]))
/
sum(increase(app_startup_duration_milliseconds_count{
  service_name="xynespaces-native"
}[$__range]))
```

Percentiles are **not** a second metric. Each device records one duration into
the histogram; p50 / p95 / p99 are estimated at query time from `_bucket` with
`histogram_quantile`. App version is already the resource attribute
`service.version` (Prometheus label `service_version`). Do not add `app_version`
as a metric attribute.

Example p50 / p95 / p99 by app version over the selected Grafana range (`0.50`,
`0.95`, or `0.99`). `sum by` must keep `le`; that label is the histogram bucket
bound the quantile math needs:

```promql
histogram_quantile(
  0.95,
  sum by (le, service_version) (
    increase(
      app_startup_duration_milliseconds_bucket{
        service_name="xynespaces-native"
      }[$__range]
    )
  )
)
```

Confirm the version label on a real series before pinning dashboards:

```promql
app_startup_duration_milliseconds_count{
  service_name="xynespaces-native"
}
```

The corresponding structured log event is `app.startup.completed`. Use that
event when investigating one specific startup; use this metric for aggregate
startup behavior.

## `notification_message_highlight_duration`

**Type:** Histogram

**Unit:** Milliseconds (`ms`)

**Purpose:** Measures user-perceived latency from opening a chat-message
notification until the target message is visible and highlighted.

**Recorded when:** A `notification.open.completed` journey finishes with
`outcome="highlighted"` and `messageHighlighted=true`. Timeout, abandoned, and
missing-message journeys are intentionally excluded.

**Attributes:**

- `app_state`: `cold` or `warm`
- `surface`: `channel` or `thread`
- `native_anchor`: `app` or `activity`

App version and OS are shared resource attributes exposed as `service_version`
and `os_type` in VictoriaMetrics.

**Histogram boundaries (ms):**

```text
50, 100, 250, 500, 750, 1000, 1500, 2000,
3000, 5000, 7500, 10000, 15000, 20000
```

## `notification_header_resolve_duration`

**Type:** Histogram

**Unit:** Milliseconds (`ms`)

**Purpose:** Measures time from a chat-message notification tap until the
conversation header title is a real name (or Group Chat fallback).

**Recorded when:** A `notification_header_resolved` journey finishes with
`outcome="resolved"`. Missing, timeout, and abandoned journeys are excluded.

**Attributes:**

- `surface`: `channel` or `thread`
- `native_anchor`: `app` or `activity`

**Histogram boundaries (ms):**

```text
50, 100, 250, 500, 750, 1000, 1500, 2000,
3000, 5000, 7500, 10000, 15000, 20000
```

## `chat_open_skeleton_duration`

**Type:** Histogram

**Unit:** Milliseconds (`ms`)

**Purpose:** Measures how long the chat or thread open skeleton stays visible
before the message list is revealed.

**Recorded when:** A `chat_open_skeleton_completed` journey finishes with
`outcome="revealed"`. Abandoned opens and cache-hit opens that never showed a
skeleton are excluded.

**Attributes:**

- `surface`: `channel` or `thread`
- `entry`: `direct` or `notification`

**Histogram boundaries (ms):**

50, 100, 250, 500, 750, 1000, 1500, 2000, 3000, 5000, 8000, 10000, 20000

Expected VictoriaMetrics series:

chat_open_skeleton_duration_milliseconds_bucket
chat_open_skeleton_duration_milliseconds_count
chat_open_skeleton_duration_milliseconds_sum

## `activity_message_highlight_duration`

**Type:** Histogram

**Unit:** Milliseconds (`ms`)

**Purpose:** Measures user-perceived latency from tapping an Activity row until
the target message is visible and highlighted.

**Recorded when:** An `activity_open_completed` journey finishes with
`outcome="highlighted"` and `messageHighlighted=true`. Timeouts, abandons, and
message-less taps are excluded.

**Attributes:**

- `surface`: `channel` or `thread`

App version and OS are shared resource attributes exposed as `service_version`
and `os_type` in VictoriaMetrics.

**Histogram boundaries (ms):**

50, 100, 250, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 20000

Expected VictoriaMetrics series:

activity_message_highlight_duration_milliseconds_bucket
activity_message_highlight_duration_milliseconds_count
activity_message_highlight_duration_milliseconds_sum

## Notification delivery counters

These counters are recorded together with the matching structured log events.
Android and iOS foreground use JS `emitNotificationDelivery.ts`, which POSTs the
same one-shot cumulative OTLP JSON as the iOS Notification Service Extension
(`fetch` to `/godel/v1/metrics`). Headless Android FCM wakes cannot rely on the
OpenTelemetry SDK exporter: the process starts, flushes a delta, and dies, and
Godel accepts that with HTTP 200 then drops it.

iOS background / killed alert pushes are counted from the Notification Service
Extension, because JS usually does not run for those banners. Both paths export
a cumulative sum of `1` with a non-zero time window.

After ingest, a Grafana stat over the dashboard range should match the log count
for the same window.

| Metric                          | Log event                       | Meaning                                  |
| ------------------------------- | ------------------------------- | ---------------------------------------- |
| `notification_payload_received` | `notification_payload_received` | Payload reached the delivery process     |
| `notification_displayed`        | `notification_displayed`        | Banner was shown (app-drawn or OS-owned) |
| `notification_display_skipped`  | `notification_display_skipped`  | Received and intentionally not shown     |
| `notification_display_failed`   | `notification_display_failed`   | Intended to show, display failed         |
| `notification_handler_failed`   | `notification_handler_failed`   | Handler threw before the funnel closed   |

Expected VictoriaMetrics series use the `_total` suffix, for example
`notification_payload_received_total`.

Example received count over the selected Grafana range:

```promql
sum(increase(notification_payload_received_total{
  service_name="xynespaces-native"
}[$__range]))
```

Funnel check over the same range:

```promql
sum(increase(notification_payload_received_total{service_name="xynespaces-native"}[$__range]))
≈
sum(increase(notification_displayed_total{service_name="xynespaces-native"}[$__range]))
+
sum(increase(notification_display_skipped_total{service_name="xynespaces-native"}[$__range]))
+
sum(increase(notification_display_failed_total{service_name="xynespaces-native"}[$__range]))
+
sum(increase(notification_handler_failed_total{service_name="xynespaces-native"}[$__range]))
```

Break down background vs foreground if the count still diverges from logs:

```promql
sum by (delivery_context) (
  increase(notification_payload_received_total{
    service_name="xynespaces-native"
  }[$__range])
)
```

## Zero query / mutation / run

These match the web dashboard OTel names. Histograms record only when `skewed`
is false. Logs still include skewed samples.

| Catalog key              | OTel name                  | VictoriaMetrics series prefix          |
| ------------------------ | -------------------------- | -------------------------------------- |
| `zeroQueryLatency`       | `zero_query_latency`       | `zero_query_latency_milliseconds_*`    |
| `zeroQueryOperations`    | `zero_query_operations`    | `zero_query_operations_total`          |
| `zeroMutationLatency`    | `zero_mutation_latency`    | `zero_mutation_latency_milliseconds_*` |
| `zeroMutationOperations` | `zero_mutation_operations` | `zero_mutation_operations_total`       |
| `zeroRunLatency`         | `zero_run_latency`         | `zero_run_latency_milliseconds_*`      |
| `zeroRunOperations`      | `zero_run_operations`      | `zero_run_operations_total`            |

**Histogram boundaries (ms):**
`10, 25, 50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600`

The first bucket is 10ms, so local replica hits (2–9ms in logs) appear as 10ms
in Grafana.

**Attributes:** `query` (queries and runs) or `mutation`; operations also have
`stage` = `start` | `success` | `error`.

Always filter `service_name="xynespaces-native"`. Use `increase()`, not
`rate()`, because these are push-based client series.

Example p50 by query over the selected Grafana range:

```promql
histogram_quantile(
  0.50,
  sum by (le, query) (
    increase(
      zero_query_latency_milliseconds_bucket{
        service_name="xynespaces-native"
      }[$__range]
    )
  )
)
```

Compare to logs (`skewed:false` only — that is what the histogram contains):

```text
serviceName:="xynespaces-native" AND event:="zero_query_complete" AND skewed:false
| stats by (query)
    quantile(0.50, durationMs) as p50,
    quantile(0.95, durationMs) as p95,
    count() as count
```

## Grafana dashboards

Import either JSON from [`grafana/`](./grafana/) via **Dashboards → New →
Import**. Pick the same VictoriaMetrics datasource used for
`zero_query_latency_milliseconds_count`. The journeys dashboard also asks for
VictoriaLogs (emails are not metric attributes).

| File                                                                               | Title                             | Contents                                                             |
| ---------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------- |
| [`grafana/lotus-zero-query-latency.json`](./grafana/lotus-zero-query-latency.json) | Lotus — Client Zero Query Latency | Query / mutation / run p50–p99                                       |
| [`grafana/lotus-client-journeys.json`](./grafana/lotus-client-journeys.json)       | Lotus — Client journeys           | Startup, activity → chat, chat skeleton, notification open, sessions |

To add another journey row, edit
[`grafana/buildLotusClientJourneysDashboard.py`](./grafana/buildLotusClientJourneysDashboard.py)
and run it to regenerate the JSON.

Until a rebuild with the native-version fix, `service_version` is `1.0.0` even
when logs show `appVersion=102.0.0`.

## Adding another metric

1. Add its bounded contract to `APP_METRICS` in `metrics.ts`.
2. Record it through `appMetrics`; feature code must not use OpenTelemetry
   instruments directly.
3. Add focused in-memory-recorder tests.
4. Document its purpose, unit, recording moment, and allowed attributes here.
5. Verify its translated series names and labels in VictoriaMetrics.
