import { metrics } from '@opentelemetry/api';
import type { Counter, ObservableGauge, Meter } from '@opentelemetry/api';
import { config } from '@/config/env';
import { db } from '@/database/client';
import { parseAutomationConfig } from '@/automations/types/workflow-adapter';
import { automationQueue } from '@/automations/queue/automation.queue';
import { automationScheduleQueue } from '@/automations/queue/automation-schedule.queue';

function getMeter(): Meter {
  return metrics.getMeter(config.otel.serviceName);
}

// Automation run state-transition counter.
let _automationRuns: Counter | null = null;
function getAutomationRunsCounter(): Counter {
  if (!_automationRuns) {
    _automationRuns = getMeter().createCounter('automations_runs_total', {
      description: 'Total automation runs by state, workspace, automation and trigger type',
      unit: '1',
    });
  }
  return _automationRuns;
}

export type AutomationRunMetricStatus =
  | 'started'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'paused'
  | 'scheduled'
  | 'queue_failed'
  | 'stalled';

export interface AutomationMetricLabels {
  automationId?: string | null;
  workspaceId?: string | null;
  triggerType?: string | null;
}

export function recordAutomationRunMetric(
  status: AutomationRunMetricStatus,
  labels: AutomationMetricLabels = {},
): void {
  getAutomationRunsCounter().add(1, {
    status,
    automation_id: labels.automationId ?? 'unknown',
    workspace_id: labels.workspaceId ?? 'unknown',
    trigger_type: labels.triggerType ?? 'unknown',
  });
}

/** Best-effort metric emission that looks up an execution's labels by id.
 *  Used from queue event listeners where only the execution id is available. */
export async function recordAutomationRunMetricAsync(
  status: AutomationRunMetricStatus,
  executionId: string,
): Promise<void> {
  try {
    const execution = await db.workflowExecution.findUnique({
      where: { id: executionId },
      select: { workflowId: true, workspaceId: true },
    });
    const workflow = execution?.workflowId
      ? await db.workflow.findUnique({
          where: { id: execution.workflowId },
          select: { context: true, workspaceId: true },
        })
      : null;
    const cfg = workflow?.context ? parseAutomationConfig(workflow.context) : null;
    recordAutomationRunMetric(status, {
      automationId: execution?.workflowId,
      workspaceId: workflow?.workspaceId ?? execution?.workspaceId,
      triggerType: cfg?.trigger.type,
    });
  } catch {
    // Best-effort: emit without labels if lookups fail.
    recordAutomationRunMetric(status);
  }
}

// Observable gauge exposing Bull job counts for each automation queue.
let _automationQueueJobs: ObservableGauge | null = null;
export function getAutomationQueueJobsGauge(): ObservableGauge {
  if (!_automationQueueJobs) {
    _automationQueueJobs = getMeter().createObservableGauge('automations_queue_jobs', {
      description: 'Current number of automation queue jobs by queue name and state',
      unit: '1',
    });

    _automationQueueJobs.addCallback(async observableResult => {
      if (automationQueue.isReady) {
        try {
          const counts = await automationQueue.getQueue().getJobCounts();
          observableResult.observe(counts.waiting ?? 0, {
            queue_name: 'automations',
            state: 'waiting',
          });
          observableResult.observe(counts.active ?? 0, {
            queue_name: 'automations',
            state: 'active',
          });
          observableResult.observe(counts.completed ?? 0, {
            queue_name: 'automations',
            state: 'completed',
          });
          observableResult.observe(counts.failed ?? 0, {
            queue_name: 'automations',
            state: 'failed',
          });
          observableResult.observe(counts.delayed ?? 0, {
            queue_name: 'automations',
            state: 'delayed',
          });
        } catch {
          // Ignore transient queue read errors.
        }
      }

      if (automationScheduleQueue.isReady) {
        try {
          const counts = await automationScheduleQueue.getQueue().getJobCounts();
          observableResult.observe(counts.waiting ?? 0, {
            queue_name: 'automations-schedule',
            state: 'waiting',
          });
          observableResult.observe(counts.active ?? 0, {
            queue_name: 'automations-schedule',
            state: 'active',
          });
          observableResult.observe(counts.completed ?? 0, {
            queue_name: 'automations-schedule',
            state: 'completed',
          });
          observableResult.observe(counts.failed ?? 0, {
            queue_name: 'automations-schedule',
            state: 'failed',
          });
          observableResult.observe(counts.delayed ?? 0, {
            queue_name: 'automations-schedule',
            state: 'delayed',
          });
        } catch {
          // Ignore transient queue read errors.
        }
      }
    });
  }
  return _automationQueueJobs;
}

// Register the gauge callback eagerly so collectors see the metric as soon as OTEL starts.
void getAutomationQueueJobsGauge();
