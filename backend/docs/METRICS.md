# Metrics & Observability

This document explains how monitoring and observability works in the Xyne backend using **OpenTelemetry push metrics**, **VictoriaMetrics**, and **Grafana**.

---

## 📊 Overview

Our monitoring stack consists of:

1. **Backend API** - Pushes metrics via OpenTelemetry SDK
2. **OTLP Collector** - Receives and forwards metrics
3. **VictoriaMetrics** - Stores metrics data (Prometheus-compatible)
4. **Grafana** - Visualizes metrics in dashboards

```
┌─────────────┐     push OTLP      ┌─────────────────┐
│   Backend   │ ─────────────────> │ OTLP Collector  │
│             │   (periodic)       │   :4318         │
└─────────────┘                    └────────┬────────┘
                                            │
                    ┌───────────────────────┘
                    │  remote_write
                    ▼
         ┌────────────────────┐
         │ VictoriaMetrics    │
         │ :8428              │
         └────────┬───────────┘
                  │
                  │ queries
                  ▼
         ┌────────────────────┐
         │   Grafana          │
         │   :3333            │
         └────────────────────┘
```

---

## 🚀 Getting Started

### 1. Start Services

```bash
# Start all services including VictoriaMetrics, OTLP Collector, and Grafana
npm run services
```

This starts:
- **OTLP Collector** on http://localhost:4318
- **VictoriaMetrics** on http://localhost:8428
- **Grafana** on http://localhost:3333

### 2. Start Backend

```bash
cd backend
npm run dev
```

Backend automatically pushes metrics to the OTLP collector.

### 3. Access Grafana

1. Open http://localhost:3333
2. Login with:
   - Username: `admin`
   - Password: `admin`
3. Navigate to **Dashboards** → **Xyne API Overview**

---

## 📈 Current Metrics

### HTTP Metrics (Automatic)

These are collected automatically by the `metricsMiddleware` for every API request:

| Metric Name | Type | Description | Labels |
|------------|------|-------------|--------|
| `http_requests_total` | Counter | Total HTTP requests | method, route, status_code |
| `http_request_duration_ms` | Histogram | Request latency distribution | method, route, status_code |
| `http_request_errors_total` | Counter | Total HTTP errors (4xx/5xx) | method, route, status_code, error_type |
| `http_active_connections` | UpDownCounter | Current active connections | - |
| `db_query_duration_ms` | Histogram | Database query latency | query_type, table |

### Notification Metrics

| Metric Name | Type | Description | Labels |
|------------|------|-------------|--------|
| `notification_job_created_total` | Counter | Total notification jobs created | platform, message_type |
| `notification_jobs_waiting` | UpDownCounter | Jobs currently waiting in queue | platform, message_type |
| `notification_job_status_total` | Counter | Jobs by status | status, platform, message_type, error_type |
| `notification_job_duration_ms` | Histogram | Job processing duration | platform, message_type, status |
| `notification_job_queue_time_ms` | Histogram | Time spent in queue | platform, message_type |
| `notification_jobs_expected_total` | Counter | Expected notification jobs | platform, message_type |
| `call_jobs_total` | Counter | Call jobs by status | platform, status |

### Ask AI Metrics

| Metric Name | Type | Description | Labels |
|------------|------|-------------|--------|
| `ask_ai_queries_total` | Counter | Total Ask AI queries | status |
| `ask_ai_query_duration` | Histogram | Query duration in ms | status |
| `ask_ai_context_channels_count` | Histogram | Channels used as context | - |
| `ask_ai_feedback_total` | Counter | Feedback submissions | value |
| `web_search_enabled_total` | Counter | Queries with web search enabled | - |
| `web_search_tool_used_total` | Counter | Times web search tool used | - |
| `ask_ai_attachment_used_total` | Counter | Times attachments used | - |
| `ask_ai_genius_used_total` | Counter | Times Genius tool used | - |
| `ask_ai_research_agent_used_total` | Counter | Times Research Agent used | - |

---

## 🔍 How It Works

### 1. Metrics Collection

The `metricsMiddleware` in `backend/src/middleware/metricsMiddleware.ts` intercepts every HTTP request:

```typescript
// Automatically tracks:
- Request start/end time (latency)
- HTTP method, route, status code
- Active connections (up/down counter)
- Errors (4xx/5xx)
```

### 2. Metrics Push

The OpenTelemetry SDK periodically pushes metrics to the OTLP collector (default every 60s):

```typescript
// Configuration in src/services/otel/telemetry.ts
const metricReader = new PeriodicExportingMetricReader({
  exporter: metricExporter,
  exportIntervalMillis: 60000, // 60 seconds
});
```

Environment variables:
- `OTEL_BASE_URL` - OTLP collector URL (default: `http://localhost:4318`)
- `OTEL_SERVICE_NAME` - Service name (default: `backend`)
- `OTEL_EXPORT_INTERVAL_MS` - Export interval (default: `60000`)

### 3. Metrics Storage

The OTLP collector forwards metrics to VictoriaMetrics via Prometheus remote write.

Metrics are stored for **12 months** (configurable in `docker-compose.dev.yml`).

### 4. Metrics Visualization

Grafana queries VictoriaMetrics and displays:
- **Request Rate** - Requests per second by route
- **Latency Percentiles** - P50, P95, P99 response times
- **Error Rate** - 4xx/5xx errors over time
- **Active Connections** - Current concurrent requests

---

## 🛠️ Adding Custom Business Metrics

You can add your own metrics for business logic like "messages created", "files uploaded", "calls completed", etc.

### Step 1: Define the Metric

Create a new metric file or add to an existing one in `backend/src/services/otel/`:

```typescript
// Example: backend/src/services/otel/businessMetrics.ts
import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, UpDownCounter } from '@opentelemetry/api';
import { config } from '@/config/env';

function getMeter() {
  return metrics.getMeter(config.otel.serviceName);
}

// Example: Track messages created
let _messagesCreated: Counter | null = null;
export const messagesCreated: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_messagesCreated) {
      _messagesCreated = getMeter().createCounter('messages_created_total', {
        description: 'Total number of messages created',
        unit: '1',
      });
    }
    return _messagesCreated[prop as keyof Counter];
  },
});

// Example: Track file upload size
let _fileUploadSize: Histogram | null = null;
export const fileUploadSize: Histogram = new Proxy({} as Histogram, {
  get(_target, prop) {
    if (!_fileUploadSize) {
      _fileUploadSize = getMeter().createHistogram('file_upload_size_bytes', {
        description: 'Distribution of uploaded file sizes',
        unit: 'bytes',
        advice: {
          explicitBucketBoundaries: [1024, 10240, 102400, 1024000, 10240000, 52428800],
        },
      });
    }
    return _fileUploadSize[prop as keyof Histogram];
  },
});

// Example: Track active calls
let _activeCalls: UpDownCounter | null = null;
export const activeCalls: UpDownCounter = new Proxy({} as UpDownCounter, {
  get(_target, prop) {
    if (!_activeCalls) {
      _activeCalls = getMeter().createUpDownCounter('active_calls_count', {
        description: 'Number of active calls right now',
        unit: '1',
      });
    }
    return _activeCalls[prop as keyof UpDownCounter];
  },
});
```

### Step 2: Export from Index

Add exports to `backend/src/services/otel/index.ts`:

```typescript
export * from './telemetry';
export * from './callMetrics';
export * from './zeroMetrics';
export * from './httpMetrics';
export * from './dbMetrics';
export * from './notificationMetrics';
export * from './aiMetrics';
export * from './businessMetrics'; // Add this
```

### Step 3: Use in Business Logic

Import and use the metric in your service/controller:

```typescript
// In MessageService.ts
import { messagesCreated } from '@/services/otel';

async createMessage(data: CreateMessageDto) {
  // ... business logic to save message
  
  const message = await this.messageRepository.save(data);
  
  // Increment the counter with labels
  messagesCreated.add(1, {
    message_type: data.attachments?.length > 0 ? 'attachment' : 'text',
    conversation_type: data.isGroupChat ? 'group' : 'direct',
  });
  
  return message;
}
```

```typescript
// In StorageService.ts
import { fileUploadSize } from '@/services/otel';

async uploadFile(file: Buffer, metadata: FileMetadata) {
  // ... upload logic
  
  // Record file size distribution
  fileUploadSize.record(file.length, { file_type: metadata.mimeType });
  
  return uploadedUrl;
}
```

```typescript
// In CallService.ts
import { activeCalls } from '@/services/otel';

async startCall(callId: string) {
  // ... start call logic
  
  // Increment active calls
  activeCalls.add(1);
}

async endCall(callId: string) {
  // ... end call logic
  
  // Decrement active calls
  activeCalls.add(-1);
}
```

### Step 4: Verify Metrics

1. Trigger the business logic (create a message, upload a file, etc.)
2. Wait for the next export interval (default 60 seconds)
3. Check VictoriaMetrics directly:
   ```bash
   curl "http://localhost:8428/api/v1/query?query=messages_created_total"
   ```
4. Or check Grafana dashboards

### Step 5: Create Grafana Dashboard Panel

1. Go to your Grafana dashboard
2. Click **Add Panel**
3. Use queries like:
   - `rate(messages_created_total[5m])` - Messages per second
   - `sum by (message_type) (messages_created_total)` - Total by type
   - `histogram_quantile(0.95, rate(file_upload_size_bytes_bucket[5m]))` - P95 file size
   - `active_calls_count` - Current active calls

---

## 📊 Metric Types

### Counter
- **Always increases** (never decreases)
- Use for: Total counts (requests, messages, errors)
- Methods: `.add(value, attributes)`

```typescript
messagesCreated.add(1); // Increment by 1
messagesCreated.add(5, { type: 'text' }); // Increment by 5 with labels
```

### UpDownCounter
- **Can go up and down**
- Use for: Current state (active connections, queue size, online users)
- Methods: `.add(value, attributes)`

```typescript
activeCalls.add(1);  // +1
activeCalls.add(-1); // -1
```

### Histogram
- **Records distribution of values** in buckets
- Automatically calculates sum, count, and percentiles
- Use for: Latency, file sizes, durations
- Methods: `.record(value, attributes)`

```typescript
requestDuration.record(145, { route: '/api/messages' }); // 145ms
fileSizeHistogram.record(2048576, { type: 'image' }); // 2MB in bytes
```

---

## 🎯 Best Practices

### 1. Label Cardinality
⚠️ **Be careful with labels!** Each unique combination of label values creates a new time series.

**Good:**
```typescript
// Limited label values (low cardinality)
.add(1, { message_type: 'text' }) // Only 2-3 types: text, image, video
.add(1, { status: 'success' })    // Only 2 values: success, failure
```

**Bad:**
```typescript
// High cardinality - creates millions of time series!
.add(1, { user_id: '12345' })     // ❌ Thousands of users
.add(1, { message_id: 'abc123' }) // ❌ Millions of messages
.add(1, { timestamp: Date.now() }) // ❌ Infinite values
```

### 2. Error Handling
Always wrap metrics in try/catch to avoid breaking your app:

```typescript
try {
  messagesCreated.add(1, { type: 'text' });
} catch (error) {
  logger.error('Failed to record metric:', error);
  // Continue with business logic
}
```

### 3. Timing Accuracy
For accurate duration measurements:

```typescript
const start = Date.now();
await someOperation();
const duration = Date.now() - start;
operationDuration.record(duration, { operation: 'db_query' });
```

### 4. Use Meaningful Names
- Use snake_case for metric names
- Add `_total` suffix for counters
- Add `_seconds` or `_bytes` or `_ms` for units
- Keep names descriptive but concise

```typescript
✅ messages_created_total
✅ http_request_duration_ms
✅ file_upload_size_bytes
❌ msgCnt
❌ duration
❌ size
```

---

## 🐛 Troubleshooting

### Metrics not appearing in Grafana?

1. **Check OTLP collector is running:**
   ```bash
   curl http://localhost:4318
   ```

2. **Check VictoriaMetrics is receiving data:**
   ```bash
   curl "http://localhost:8428/api/v1/label/__name__/values"
   ```

3. **Check Grafana datasource:**
   - Go to Configuration → Data Sources
   - Test the VictoriaMetrics connection
   - Should be: http://victoriametrics:8428

### Metrics showing 0 or no data?

- **Trigger the event** - Metrics only appear after the code path executes
- **Wait for export** - Default export interval is 60 seconds
- **Check labels** - Ensure labels in code match labels in Grafana query

### High memory usage?

- Reduce label cardinality (fewer unique label combinations)
- Decrease retention period in `docker-compose.dev.yml`
- Check for metric leaks (metrics being created repeatedly)

---

## 📚 Resources

- [OpenTelemetry Metrics](https://opentelemetry.io/docs/concepts/signals/metrics/)
- [OpenTelemetry Best Practices](https://opentelemetry.io/docs/concepts/semantic-conventions/)
- [VictoriaMetrics Documentation](https://docs.victoriametrics.com/)
- [Grafana Dashboards](https://grafana.com/docs/grafana/latest/dashboards/)
- [OTLP Specification](https://opentelemetry.io/docs/specs/otlp/)

---

## 🔐 Production Considerations

When deploying to production:

1. **Configure OTLP Collector:**
   - Update `otel-collector-config.yaml` with production endpoints
   - Configure batch processing and retry policies
   
2. **Deploy VictoriaMetrics separately:**
   - Use a dedicated server or managed service
   - Configure firewall rules
   - Set up proper retention policies
   
3. **Connect to existing Grafana:**
   - Add VictoriaMetrics as a datasource
   - Import the dashboard JSON from `docker/grafana/provisioning/dashboards/`

4. **Set up alerting:**
   - Create Grafana alerts for high error rates, slow responses, etc.
   - Configure notification channels (Slack, email, PagerDuty)

5. **Monitor the exporter:**
   - Watch for export failures in logs
   - Set up alerts for missed exports
   - Monitor OTLP collector health

---

## 🤝 Contributing

When adding new features:

1. Consider what metrics would be useful to track
2. Add custom metrics following the patterns in this guide
3. Update Grafana dashboards if needed
4. Document new metrics in this README

---

**Questions?** Check the main project README or ask the team!
