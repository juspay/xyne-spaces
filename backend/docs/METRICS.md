# Metrics & Observability

This document explains how monitoring and observability works in the Xyne backend using **Prometheus metrics**, **VictoriaMetrics**, and **Grafana**.

---

## 📊 Overview

Our monitoring stack consists of:

1. **Backend API** - Exposes metrics at `/metrics` endpoint
2. **VictoriaMetrics** - Scrapes and stores metrics data (Prometheus-compatible)
3. **Grafana** - Visualizes metrics in dashboards

```
┌─────────────┐     scrapes      ┌──────────────────┐     queries     ┌─────────┐
│   Backend   │ ────────────────> │ VictoriaMetrics  │ ───────────────>│ Grafana │
│ /metrics    │   every 15s      │   (Storage)      │                 │ (Viz)   │
└─────────────┘                  └──────────────────┘                 └─────────┘
```

---

## 🚀 Getting Started

### 1. Start Services

```bash
# Start all services including VictoriaMetrics and Grafana
npm run services
```

This starts:
- **VictoriaMetrics** on http://localhost:8428
- **Grafana** on http://localhost:3333

### 2. Start Backend

```bash
cd backend
npm run dev
```

Backend exposes metrics at: http://localhost:3001/metrics

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
| `http_active_connections` | Gauge | Current active connections | - |
| `db_query_duration_ms` | Histogram | Database query latency | query_type, table  |  --> <!-- NOTE: To be enabled when DB metric collection is implemented -->

### System Metrics (Automatic)

Default Node.js metrics collected by `prom-client`:

- `xyne_backend_process_cpu_user_seconds_total` - CPU usage
- `xyne_backend_process_resident_memory_bytes` - Memory usage
- `xyne_backend_nodejs_heap_size_used_bytes` - Heap memory
- `xyne_backend_nodejs_eventloop_lag_seconds` - Event loop lag
- And many more...

---

## 🔍 How It Works

### 1. Metrics Collection

The `metricsMiddleware` in `backend/src/middleware/metricsMiddleware.ts` intercepts every HTTP request:

```typescript
// Automatically tracks:
- Request start/end time (latency)
- HTTP method, route, status code
- Active connections (inc/dec)
- Errors (4xx/5xx)
```

### 2. Metrics Storage

VictoriaMetrics scrapes the `/metrics` endpoint every **15 seconds**:

```yaml
# scrape.yml configuration
scrape_interval: 15s
targets: ['host.docker.internal:3001']
```

Metrics are stored for **12 months** (configurable in `docker-compose.dev.yml`).

### 3. Metrics Visualization

Grafana queries VictoriaMetrics and displays:
- **Request Rate** - Requests per second by route
- **Latency Percentiles** - P50, P95, P99 response times
- **Error Rate** - 4xx/5xx errors over time
- **Active Connections** - Current concurrent requests

---

## 🛠️ Adding Custom Business Metrics

You can add your own metrics for business logic like "messages created", "files uploaded", "calls completed", etc.

### Step 1: Define the Metric

In `backend/src/middleware/metricsMiddleware.ts`, add your custom metric:

```typescript
// Example: Track messages created
const messagesCreatedCounter = new client.Counter({
  name: 'messages_created_total',
  help: 'Total number of messages created',
  labelNames: ['message_type', 'conversation_type'],
  registers: [register],
});

// Example: Track file upload size
const fileUploadSizeHistogram = new client.Histogram({
  name: 'file_upload_size_bytes',
  help: 'Distribution of uploaded file sizes',
  labelNames: ['file_type'],
  buckets: [1024, 10240, 102400, 1024000, 10240000, 52428800], // 1KB to 50MB
  registers: [register],
});

// Example: Track active calls
const activeCallsGauge = new client.Gauge({
  name: 'active_calls_count',
  help: 'Number of active calls right now',
  registers: [register],
});
```

### Step 2: Export the Metric

Add it to the `metrics` export:

```typescript
export const metrics = {
  httpRequestDuration,
  httpRequestTotal,
  httpRequestErrors,
  activeConnections,
  dbQueryDuration,
  
  // Add your custom metrics here
  messagesCreatedCounter,
  fileUploadSizeHistogram,
  activeCallsGauge,
};
```

### Step 3: Use in Business Logic

Import and use the metric in your service/controller:

```typescript
// In MessageService.ts
import { metrics } from '../middleware/metricsMiddleware';

async createMessage(data: CreateMessageDto) {
  // ... business logic to save message
  
  const message = await this.messageRepository.save(data);
  
  // Increment the counter with labels
  metrics.messagesCreatedCounter.inc({
    message_type: data.attachments?.length > 0 ? 'attachment' : 'text',
    conversation_type: data.isGroupChat ? 'group' : 'direct',
  });
  
  return message;
}
```

```typescript
// In StorageService.ts
import { metrics } from '../middleware/metricsMiddleware';

async uploadFile(file: Buffer, metadata: FileMetadata) {
  // ... upload logic
  
  // Record file size distribution
  metrics.fileUploadSizeHistogram.observe(
    { file_type: metadata.mimeType },
    file.length
  );
  
  return uploadedUrl;
}
```

```typescript
// In CallService.ts
import { metrics } from '../middleware/metricsMiddleware';

async startCall(callId: string) {
  // ... start call logic
  
  // Increment active calls
  metrics.activeCallsGauge.inc();
}

async endCall(callId: string) {
  // ... end call logic
  
  // Decrement active calls
  metrics.activeCallsGauge.dec();
}
```

### Step 4: Verify Metrics

1. Trigger the business logic (create a message, upload a file, etc.)
2. Check the metrics endpoint: http://localhost:3001/metrics
3. Search for your metric name (e.g., `messages_created_total`)
4. You should see output like:

```prometheus
# HELP messages_created_total Total number of messages created
# TYPE messages_created_total counter
messages_created_total{message_type="text",conversation_type="direct"} 145
messages_created_total{message_type="text",conversation_type="group"} 89
messages_created_total{message_type="attachment",conversation_type="direct"} 34
messages_created_total{message_type="attachment",conversation_type="group"} 21
```

### Step 5: Create Grafana Dashboard Panel

1. Go to your Grafana dashboard
2. Click **Add Panel**
3. Use queries like:
   - `rate(messages_created_total[5m])` - Messages per second
   - `sum by (message_type) (messages_created_total)` - Total by type
   - `histogram_quantile(0.95, file_upload_size_bytes)` - P95 file size
   - `active_calls_count` - Current active calls

---

## 📊 Metric Types

### Counter
- **Always increases** (never decreases)
- Use for: Total counts (requests, messages, errors)
- Methods: `.inc(labels, value)`

```typescript
messagesCreatedCounter.inc(); // Increment by 1
messagesCreatedCounter.inc({ type: 'text' }, 5); // Increment by 5
```

### Gauge
- **Can go up and down**
- Use for: Current state (active connections, queue size, online users)
- Methods: `.inc()`, `.dec()`, `.set(value)`

```typescript
activeConnectionsGauge.inc(); // +1
activeConnectionsGauge.dec(); // -1
activeConnectionsGauge.set(42); // Set to specific value
```

### Histogram
- **Records distribution of values** in buckets
- Automatically calculates sum, count, and percentiles
- Use for: Latency, file sizes, durations
- Methods: `.observe(labels, value)`

```typescript
requestDurationHistogram.observe({ route: '/api/messages' }, 145); // 145ms
fileSizeHistogram.observe({ type: 'image' }, 2048576); // 2MB in bytes
```

---

## 🎯 Best Practices

### 1. Label Cardinality
⚠️ **Be careful with labels!** Each unique combination of label values creates a new time series.

**Good:**
```typescript
// Limited label values (low cardinality)
.inc({ message_type: 'text' }) // Only 2-3 types: text, image, video
.inc({ status: 'success' })    // Only 2 values: success, failure
```

**Bad:**
```typescript
// High cardinality - creates millions of time series!
.inc({ user_id: '12345' })     // ❌ Thousands of users
.inc({ message_id: 'abc123' }) // ❌ Millions of messages
.inc({ timestamp: Date.now() }) // ❌ Infinite values
```

### 2. Error Handling
Always wrap metrics in try/catch to avoid breaking your app:

```typescript
try {
  metrics.messagesCreatedCounter.inc({ type: 'text' });
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
metrics.operationDuration.observe({ operation: 'db_query' }, duration);
```

### 4. Use Meaningful Names
- Use snake_case for metric names
- Add `_total` suffix for counters
- Add `_seconds` or `_bytes` for units
- Keep names descriptive but concise

```typescript
✅ messages_created_total
✅ http_request_duration_seconds
✅ file_upload_size_bytes
❌ msgCnt
❌ duration
❌ size
```

---

## 🐛 Troubleshooting

### Metrics not appearing in Grafana?

1. **Check backend is running:**
   ```bash
   curl http://localhost:3001/metrics
   ```
   Should return Prometheus-formatted metrics.

2. **Check VictoriaMetrics is scraping:**
   ```bash
   curl http://localhost:8428/api/v1/targets
   ```
   Should show backend target as `UP`.

3. **Check Grafana datasource:**
   - Go to Configuration → Data Sources
   - Test the VictoriaMetrics connection
   - Should be: http://victoriametrics:8428

### Metrics showing 0 or no data?

- **Trigger the event** - Metrics only appear after the code path executes
- **Wait 15 seconds** - VictoriaMetrics scrapes every 15 seconds
- **Check labels** - Ensure labels in code match labels in Grafana query

### High memory usage?

- Reduce label cardinality (fewer unique label combinations)
- Decrease retention period in `docker-compose.dev.yml`
- Check for metric leaks (metrics being created repeatedly)

---

## 📚 Resources

- [Prometheus Metric Types](https://prometheus.io/docs/concepts/metric_types/)
- [Prometheus Best Practices](https://prometheus.io/docs/practices/naming/)
- [VictoriaMetrics Documentation](https://docs.victoriametrics.com/)
- [Grafana Dashboards](https://grafana.com/docs/grafana/latest/dashboards/)
- [prom-client Library](https://github.com/siimon/prom-client)

---

## 🔐 Production Considerations

When deploying to production:

1. **Secure the `/metrics` endpoint:**
   - Add IP whitelist for VictoriaMetrics scraper
   - Or use HTTP basic auth
   
2. **Update `scrape.yml`:**
   - Replace `host.docker.internal:3001` with production backend URL
   
3. **Deploy VictoriaMetrics separately:**
   - Use a dedicated server or managed service
   - Configure firewall rules
   
4. **Connect to existing Grafana:**
   - Add VictoriaMetrics as a datasource
   - Import the dashboard JSON from `docker/grafana/provisioning/dashboards/`

5. **Set up alerting:**
   - Create Grafana alerts for high error rates, slow responses, etc.
   - Configure notification channels (Slack, email, PagerDuty)

---

## 🤝 Contributing

When adding new features:

1. Consider what metrics would be useful to track
2. Add custom metrics following the patterns in this guide
3. Update Grafana dashboards if needed
4. Document new metrics in this README

---

**Questions?** Check the main project README or ask the team!
