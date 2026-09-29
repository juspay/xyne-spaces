/**
 * DEV ONLY — emit the slack_migration_* gauges to the OTel collector WITHOUT booting the full backend.
 * Reads the seeded store (Redis) + Bull queues and pushes the dashboard metrics on the OTLP interval.
 *
 *   REDIS_HOST=localhost REDIS_PORT=6379 \
 *   ENABLE_OTEL_METRICS=true OTEL_BASE_URL=http://localhost:4318 OTEL_EXPORT_INTERVAL_MS=5000 \
 *   bun apps/backend/src/migration/self-serve/scripts/emitMetrics.ts
 *
 * Ctrl-C to stop. Never run against prod.
 */
import { initializeOpenTelemetry } from '@/services/otel/telemetry';
import { logger } from '@/utils/logger';
import { MigrationStore } from '../store';
import { MigrationQueues } from '../queues';
import { registerMigrationMetrics } from '../migrationMetrics';

initializeOpenTelemetry(); // sets the global MeterProvider + OTLP exporter — must run before registering gauges
const store = new MigrationStore();
const queues = new MigrationQueues();
registerMigrationMetrics(queues, store);

logger.info('[emitMetrics] emitting slack_migration_* gauges from the seeded store — Ctrl-C to stop');
setInterval(() => undefined, 1 << 30); // keep the process alive so the periodic exporter keeps pushing
