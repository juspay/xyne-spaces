// Approval Ask-AI context builders.
//
// Problem this solves: the approval chat used to serialize the ENTIRE execution
// (every step's input + output, pretty-printed) into the LLM system prompt. For
// data-heavy workflows (deep research, a LOAD_LAST_RESULT carrying the whole
// previous run, run_code tool-call dumps) that reaches >1MB / ~300K+ tokens and
// silently blows the model's context window — the model returns nothing.
//
// Instead the prompt carries only the WORKFLOW STRUCTURE (shape + what it does +
// the pause form), and the full execution is written to /mnt/files/execution.json
// for the model to read on demand with the existing `run_code` tool. Any
// attachment the workflow used or produced is hydrated from storage into the
// sandbox under /mnt/files/attachments/<step>/<name>, and each attachment record
// in execution.json is annotated with its `sandboxPath` so the model can open the
// real bytes (parse the xlsx, read the PDF, inspect the HTML). No run data ever
// enters the prompt; everything is fetched lazily, at any execution size.

import type { ExecutionDetail } from '../client/types.js';
import { isAttachment, type Attachment } from '../common/attachment.js';

/** Path the execution JSON is mounted at inside the sandbox. */
export const EXECUTION_DATA_PATH = '/mnt/files/execution.json';
/** Directory under which execution attachments are mounted. */
export const ATTACHMENTS_DIR = '/mnt/files/attachments';

interface CfgStep {
  id?: string;
  type?: string;
  title?: string;
  description?: string;
  config?: { branches?: Record<string, CfgStep[]> };
}

interface CfgShape {
  steps?: CfgStep[];
  trigger?: {
    type?: string;
    config?: { inputSchema?: { properties?: Record<string, { title?: string; description?: string }> } };
  };
}

function safeParse(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

function cfgStepFor(stepName: string, cfgSteps: CfgStep[]): CfgStep | undefined {
  const m = /^step_(\d+)$/.exec(stepName);
  return m ? cfgSteps[Number(m[1])] : undefined;
}

function configSteps(execCtx: ExecutionDetail): CfgStep[] {
  return (execCtx.config as CfgShape | undefined)?.steps ?? [];
}

// ── Workflow structure (the only thing that goes in the prompt) ───────────────

function renderSteps(steps: CfgStep[], indent: string): string[] {
  const out: string[] = [];
  steps.forEach((s, i) => {
    const label = s.title ?? s.id ?? `step ${String(i + 1)}`;
    out.push(`${indent}- ${label} (id: ${s.id ?? '?'}, type: ${s.type ?? '?'})${s.description ? ` — ${s.description}` : ''}`);
    const branches = s.config?.branches;
    if (branches) {
      for (const [name, bsteps] of Object.entries(branches)) {
        out.push(`${indent}  • parallel branch "${name}":`);
        out.push(...renderSteps(bsteps, `${indent}    `));
      }
    }
  });
  return out;
}

/**
 * Compact, structure-only context for the system prompt: what the workflow is,
 * what it does (steps in order), its trigger inputs, and run status. Carries NO
 * step outputs — those are read on demand via run_code.
 */
export function buildWorkflowContext(execCtx: ExecutionDetail): string {
  const cfg = execCtx.config as CfgShape | undefined;
  const parts: string[] = [];

  parts.push(`Workflow: ${execCtx.name ?? execCtx.workflowId}`);
  parts.push(`Run status: ${execCtx.status}`);
  if (execCtx.summary) parts.push(`About: ${execCtx.summary}`);

  const props = cfg?.trigger?.config?.inputSchema?.properties;
  if (props && Object.keys(props).length > 0) {
    const inputs = Object.entries(props).map(([k, v]) => (v.title ? `${k} (${v.title})` : k));
    parts.push(`Trigger inputs: ${inputs.join(', ')}`);
  }

  if (cfg?.steps && cfg.steps.length > 0) {
    parts.push(`Steps (in order):\n${renderSteps(cfg.steps, '').join('\n')}`);
  } else {
    parts.push(`Steps:\n${execCtx.steps.map((s) => `- ${s.stepName} (${s.executorType}) [${s.status}]`).join('\n')}`);
  }
  return parts.join('\n\n');
}

// ── Attachments: collect from the execution → sandbox paths ───────────────────

export interface CollectedAttachment {
  /** Absolute path the bytes will be mounted at inside the sandbox. */
  sandboxPath: string;
  /** The attachment record (its `.handle` is the opaque storage ref). */
  attachment: Attachment;
  /** Friendly source — the producing/consuming step id (or "trigger"). */
  source: string;
}

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_') || 'file';
}

/** Deep-walk any value, invoking `visit` on every Attachment found (not recursing into it). */
function walkAttachments(value: unknown, visit: (a: Attachment) => void): void {
  if (!value || typeof value !== 'object') return;
  if (isAttachment(value)) { visit(value); return; }
  if (Array.isArray(value)) { for (const v of value) walkAttachments(v, visit); return; }
  for (const v of Object.values(value as Record<string, unknown>)) walkAttachments(v, visit);
}

/**
 * Every distinct attachment referenced anywhere in the execution (trigger uploads
 * + each step's input/output), each assigned a deterministic, collision-free
 * sandbox path: /mnt/files/attachments/<step>/<name>. Deduped by storage ref.
 */
export function collectExecutionAttachments(execCtx: ExecutionDetail): CollectedAttachment[] {
  const cfgSteps = configSteps(execCtx);
  const out: CollectedAttachment[] = [];
  const seen = new Set<string>();
  const add = (source: string, a: Attachment): void => {
    if (seen.has(a.handle)) return;
    seen.add(a.handle);
    out.push({ sandboxPath: `${ATTACHMENTS_DIR}/${sanitize(source)}/${sanitize(a.name)}`, attachment: a, source });
  };
  walkAttachments(execCtx.triggerData, (a) => { add('trigger', a); });
  for (const s of execCtx.steps) {
    const source = cfgStepFor(s.stepName, cfgSteps)?.id ?? s.stepName;
    walkAttachments(safeParse(s.data), (a) => { add(source, a); });
  }
  return out;
}

// ── Execution data file (mounted for run_code), attachments annotated ─────────

/** Annotate every attachment in-place with where it is mounted (null = not mounted). */
function annotateAttachments(value: unknown, mounted: Map<string, string>): void {
  if (!value || typeof value !== 'object') return;
  if (isAttachment(value)) {
    (value as Record<string, unknown>)['sandboxPath'] = mounted.get((value as Attachment).handle) ?? null;
    return;
  }
  if (Array.isArray(value)) { for (const v of value) annotateAttachments(v, mounted); return; }
  for (const v of Object.values(value as Record<string, unknown>)) annotateAttachments(v, mounted);
}

/**
 * The full execution as JSON for the queryable file. Each step's `data` (a JSON
 * string of `{ type, input, output }`) is expanded so the model can navigate it;
 * each top-level step (`step_<n>`) is annotated with its friendly config id +
 * title; and every attachment carries a `sandboxPath` pointing at its mounted
 * bytes (per `mounted`), or null when it wasn't mounted (too large / unavailable).
 */
export function buildExecutionDataFile(
  execCtx: ExecutionDetail,
  mounted: Map<string, string> = new Map(),
): string {
  const cfgSteps = configSteps(execCtx);
  const steps = execCtx.steps.map((s) => {
    const cfg = cfgStepFor(s.stepName, cfgSteps);
    const data = safeParse(s.data);
    annotateAttachments(data, mounted);
    return {
      stepName: s.stepName,
      configId: cfg?.id,
      title: cfg?.title,
      status: s.status,
      executorType: s.executorType,
      data,
    };
  });
  const triggerData = execCtx.triggerData
    ? (JSON.parse(JSON.stringify(execCtx.triggerData)) as Record<string, unknown>)
    : execCtx.triggerData;
  annotateAttachments(triggerData, mounted);
  return JSON.stringify(
    { id: execCtx.id, name: execCtx.name, workflowId: execCtx.workflowId, status: execCtx.status, triggerData, steps },
    null,
    2,
  );
}
