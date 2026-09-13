import { metrics } from '@opentelemetry/api';
import type { Counter, Meter } from '@opentelemetry/api';
import { config } from '@/config/env';

function getMeter(): Meter {
  return metrics.getMeter(config.otel.serviceName);
}

// Automation run state-transition counter — labels: status, trigger_type
let _automationRuns: Counter | null = null;
export function getAutomationRunsTotal(): Counter {
  if (!_automationRuns) {
    _automationRuns = getMeter().createCounter('automation_runs_total', {
      description: 'Total automation runs by state and trigger type',
      unit: '1',
    });
  }
  return _automationRuns;
}

// Mirrors the AutomationRunStatus values the UI filters on (RunHistory.tsx), so a
// Grafana status filter maps 1:1 onto the run-history filter. 'stalled' is the one
// addition: a Bull-level event with no DB status of its own.
export type AutomationRunMetricStatus =
  | 'pending'
  | 'scheduled'
  | 'running'
  | 'external_wait'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'stalled';

/** Single entry point so every emission carries the same label set — a partial
 *  label set would silently drop runs out of any trigger_type-filtered panel. */
export function recordAutomationRunMetric(
  status: AutomationRunMetricStatus,
  triggerType?: string | null,
): void {
  getAutomationRunsTotal().add(1, {
    status,
    trigger_type: triggerType || 'unknown',
  });
}

/** Bull's getJobCounts() shape, narrowed to the states worth graphing. */
interface AutomationQueueCounts {
  waiting: number;
  active: number;
  delayed: number;
}

// Observable gauge exposing Bull job depth per automation queue.
//
// Register from the queue's WORKER, never from initialize(): the API process also
// calls initializeAutomations(), so registering at queue init would make every API
// replica report the same Redis depth.
//
// Depth is a property of Redis, not of the reporting process, so N worker replicas
// emit N identical series — aggregate with max/avg by (queue), never sum.
const _registeredQueues = new Set<string>();
export function registerAutomationQueueMetrics(
  queueName: string,
  getCounts: () => Promise<AutomationQueueCounts>,
): void {
  if (_registeredQueues.has(queueName)) return;
  _registeredQueues.add(queueName);

  getMeter()
    .createObservableGauge('automation_queue_jobs', {
      description: 'Current number of automation queue jobs by queue and state',
      unit: '1',
    })
    .addCallback(async result => {
      try {
        const counts = await getCounts();
        result.observe(counts.waiting ?? 0, { queue: queueName, state: 'waiting' });
        result.observe(counts.active ?? 0, { queue: queueName, state: 'active' });
        result.observe(counts.delayed ?? 0, { queue: queueName, state: 'delayed' });
      } catch {
        // Transient Redis read failure — skip this collection cycle.
      }
    });
}
