// ---------------------------------------------------------------------------
// Basic Types

import { apiInstance } from '../../../services/clients/apiClient';
import type {
  WorkflowStep,
  StepDetailsResponse,
} from '../../../services/Workflow/workflowGraphService.types';

// Extended WorkflowStep interface with optional computed properties
interface ExtendedWorkflowStep extends WorkflowStep {
  computedStatus?: string;
}

// ---------------------------------------------------------------------------
export type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];

// Workflow data structure types
interface WorkflowStepData {
  type: string;
  stepName?: string;
  data?: JsonValue;
}

interface ExpandedWorkflow {
  executionId: string;
  steps?: WorkflowStepData[];
}

interface WorkflowParentStep {
  expandedWorkflows?: ExpandedWorkflow[];
}

interface WorkflowData {
  steps?: WorkflowStepData[];
}

interface CombinedWorkflowData {
  workflows?: Array<{
    steps?: WorkflowParentStep[];
  }>;
}

interface ParsedWorkflowData {
  workflows?: WorkflowData[];
}

interface StepDetail {
  output?: {
    data?: JsonValue;
  };
}

// ---------------------------------------------------------------------------
// CSV UTILITIES
// ---------------------------------------------------------------------------

// Escape CSV values consistently
const escapeCsv = (value: unknown): string => {
  if (value === null || value === undefined) return '';

  let s: string;
  if (typeof value === 'object' && value !== null) {
    s = JSON.stringify(value);
  } else if (typeof value === 'string') {
    s = value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    s = String(value);
  } else {
    s = JSON.stringify(value);
  }

  // Prevent CSV injection - prepend tab to values that start with formula characters
  if (/^[=@+-]/.test(s)) {
    s = `\t${s}`;
  }

  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Trigger CSV download
const downloadCsv = (csv: string, filename: string): void => {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
};

// Pretty JSON for multiline CSV cells
const pretty = (obj: JsonValue, indent = 0): string => {
  if (obj === null || obj === undefined) return '';
  if (typeof obj !== 'object') return String(obj);
  const pad = '  '.repeat(indent);

  if (Array.isArray(obj)) {
    return obj.length ? '\n' + obj.map(v => pad + '- ' + pretty(v, indent + 1)).join('\n') : '[]';
  }

  const entries = Object.entries(obj);
  return entries.length
    ? '\n' +
        entries
          .map(([k, v]) => {
            const pv = pretty(v, indent + 1);
            return pv.includes('\n') ? `${pad}${k}:${pv}` : `${pad}${k}: ${pv}`;
          })
          .join('\n')
    : '{}';
};

// Safe JSON normalization
const normalizeJson = (input: JsonValue): JsonValue => {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input) as JsonValue;
  } catch {
    return { value: input };
  }
};

// ---------------------------------------------------------------------------
// Generic JSON → CSV (non-combined workflow)
// ---------------------------------------------------------------------------
export function jsonToCsv(data: JsonValue): string {
  const parsed = normalizeJson(data);

  // Extract workflows if present
  const parsedAsWorkflow = parsed as ParsedWorkflowData;
  const workflows: WorkflowData[] = Array.isArray(parsedAsWorkflow?.workflows)
    ? parsedAsWorkflow.workflows
    : Array.isArray(parsed)
      ? (parsed as WorkflowData[])
      : [parsed as WorkflowData];

  if (!workflows.length) return '';

  // Collect step names (keep order)
  const stepNames: string[] = [];
  const seen = new Set<string>();

  for (const wf of workflows) {
    for (const s of wf.steps ?? []) {
      if (s.type === 'output' && s.stepName && !seen.has(s.stepName)) {
        seen.add(s.stepName);
        stepNames.push(s.stepName);
      }
    }
  }

  if (!stepNames.length) return '';

  // Build grid
  const grid: Record<string, Record<number, JsonValue>> = {};
  workflows.forEach((wf, wi) => {
    (wf.steps ?? []).forEach((s: WorkflowStepData) => {
      if (s.type === 'output' && s.stepName) {
        (grid[s.stepName] ||= {})[wi] = s.data ?? null;
      }
    });
  });

  // Build CSV
  const rows = [['Step', ...workflows.map((_, i) => `Workflow ${i}`)].map(escapeCsv).join(',')];

  for (const name of stepNames) {
    const row = [name];
    workflows.forEach((_, wi) => {
      const v = grid[name]?.[wi];
      row.push(typeof v === 'object' && v !== null ? escapeCsv(pretty(v)) : escapeCsv(v));
    });
    rows.push(row.join(','));
  }

  return rows.join('\n');
}

// ---------------------------------------------------------------------------
// Combined-Steps → CSV (full detailed version)
// ---------------------------------------------------------------------------
async function convertCombinedStepsToCSV(data: JsonValue, _ticketId?: string): Promise<string> {
  const obj = data as CombinedWorkflowData;
  if (!Array.isArray(obj?.workflows)) return '';

  const workflows = obj.workflows;

  // ---- Collect all step names in original order ----
  const stepNames: string[] = [];
  const stepIdsByExec = new Map<string, Map<string, string>>();

  // Add proper interface for step with id
  interface StepWithId extends WorkflowStepData {
    id: string;
  }

  for (const wf of workflows) {
    for (const parent of wf.steps ?? []) {
      for (const ew of parent.expandedWorkflows ?? []) {
        const execMap = stepIdsByExec.get(ew.executionId) ?? new Map<string, string>();
        stepIdsByExec.set(ew.executionId, execMap);

        for (const s of ew.steps ?? []) {
          const stepWithId = s as StepWithId;
          if (stepWithId.stepName && !stepNames.includes(stepWithId.stepName)) {
            stepNames.push(stepWithId.stepName);
          }
          if (stepWithId.stepName && stepWithId.id) {
            execMap.set(stepWithId.stepName, stepWithId.id);
          }
        }
      }
    }
  }

  const execIds = [...stepIdsByExec.keys()];
  if (!execIds.length) return '';

  // ---- Fetch step details ----
  const allStepIds = [
    ...new Set([...stepIdsByExec.values()].flatMap((m: Map<string, string>) => [...m.values()])),
  ];
  const detailsMap = new Map<string, StepDetail>();

  await Promise.all(
    allStepIds.map(async (id: string) => {
      try {
        const response = await apiInstance.get<StepDetailsResponse>(
          `/tickets/workflow-steps/${id}/details`,
        );
        const data = response.data as StepDetail;
        detailsMap.set(id, data);
      } catch {
        // Silently ignore errors
      }
    }),
  );

  // ---- Build output grid ----
  const result: Record<string, Record<string, JsonValue>> = {};
  const fields = new Set<string>();

  for (const stepName of stepNames) {
    result[stepName] = {};

    for (const execId of execIds) {
      const stepId = stepIdsByExec.get(execId)?.get(stepName);
      const output = stepId ? detailsMap.get(stepId)?.output?.data : undefined;

      if (output && typeof output === 'object' && !Array.isArray(output)) {
        result[stepName][execId] = output;
        Object.keys(output).forEach(k => fields.add(k));
      } else {
        result[stepName][execId] = output ?? '';
      }
    }
  }

  // Only export "context"
  if (!fields.has('context')) return '';

  // ---- Build CSV ----
  const rows = [['Step', ...execIds].map(escapeCsv).join(',')];

  for (const name of stepNames) {
    const row = [name];
    for (const execId of execIds) {
      if (result[name]) {
        const stepData = result[name][execId];
        const ctx =
          stepData && typeof stepData === 'object' && !Array.isArray(stepData)
            ? (stepData as Record<string, JsonValue>)['context']
            : undefined;
        row.push(ctx ? escapeCsv(pretty(ctx)) : '');
      }
    }
    rows.push(row.join(','));
  }

  return rows.join('\n');
}

// ---------------------------------------------------------------------------
// Unified download entry
// ---------------------------------------------------------------------------
export async function downloadJsonAsCsv(
  data: JsonValue,
  filename = 'export.csv',
  _workflowType?: string,
  ticketId?: string,
): Promise<void> {
  const parsed = normalizeJson(data);

  const csv = (await convertCombinedStepsToCSV(parsed, ticketId)) || jsonToCsv(parsed) || '';

  if (!csv) {
    // eslint-disable-next-line no-console
    console.error('No data to export');
    return;
  }

  downloadCsv(csv, filename);
}

// ---------------------------------------------------------------------------
// JSON export utility for workflow steps
// ---------------------------------------------------------------------------

/**
 * Export workflow steps data as JSON file
 * @param steps - Array of workflow steps to export
 * @param ticket - Ticket information
 * @param filename - Optional filename (auto-generated if not provided)
 */
export const exportWorkflowStepsAsJson = (
  steps: ExtendedWorkflowStep[],
  ticket: { id: string; humanReadableId?: string; workflowType?: string },
  filename?: string,
): void => {
  const defaultFilename = `${ticket?.humanReadableId || ticket.id}_workflow_steps_${new Date().toISOString().split('T')[0]}.json`;
  const exportFilename = filename || defaultFilename;

  const dataToExport = {
    ticket: {
      id: ticket.id,
      humanReadableId: ticket.humanReadableId,
      workflowType: ticket.workflowType,
    },
    steps: steps.map(step => ({
      id: step.id,
      stepName: step.stepName,
      status: step.computedStatus || step.status,
      stepExecutorType: step.stepExecutorType,
      duration: step.duration || step.data?.executionMetadata?.duration,
      createdAt: step.createdAt,
      updatedAt: step.updatedAt,
      data: step.data,
      workflowExecutionId: step.workflowExecutionId,
    })),
    exportedAt: new Date().toISOString(),
  };

  const blob = new Blob([JSON.stringify(dataToExport, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
