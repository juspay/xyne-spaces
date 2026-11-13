/**
 * Value-origin resolution — derive "where did this value come from" entirely
 * from the workflow definition (refs intact) + step outputs, both already
 * loaded with an execution. No persistence, no extra fetches.
 *
 * Origins are the canonical `{{refs}}`; `parseRef` (SDK) turns a ref into
 * source/stepId/path. Everything funnels through `getOriginRefs` and
 * `resolveRef` so future tiers (author-tagged, agent-cited) layer in as a
 * preferred provider — see plan "Forward-compat".
 *
 * Wiring a new reviewer surface: the resolver is generic, but each surface still
 * enumerates the field values it renders. To make a new step's fields citable in
 * review, for each visible field mount `<OriginChipFor raw={value}
 * citations={getFieldCitations(stepConfig, citations, fieldPath)} … />`. There is
 * deliberately no step-type switch here — resolution is value/ref-driven.
 */
import type { WorkflowConfig, WorkflowStepConfig, Citation } from '@xyne/workflow-sdk/builder';
import type { ExecutionDetail } from '@xyne/workflow-sdk/client';
import type { Attachment } from '@xyne/workflow-sdk';
import { leafStepId } from '@xyne/workflow-sdk/common';
import { collectRefs, parseRef, tryCitationPath } from '@xyne/workflow-sdk/builder';
import { walkStepConfigs } from '../../../utils/branch-detection.js';
import { isAttachment, isAttachmentArray } from '../../shared/AttachmentCard.js';

// ─── Types ───

/**
 * Where the value comes from — a *structural* classification from the ref
 * grammar (`parseRef`), NOT the producing step's type. Framework-agnostic: the
 * resolver never special-cases specific step types.
 */
export type OriginKind = 'step' | 'trigger';

/** Provenance tier. Only `derived` today; `author`/`agent` layer in later. */
export type OriginTier = 'derived';

/** A step's documentation group (StepGroup), when it belongs to one. */
export interface OriginGroup {
  title: string;
  description?: string | undefined;
}

export interface ResolvedOrigin {
  /** The raw ref this origin came from. */
  refPath: string;
  tier: OriginTier;
  /** Human label — producing step title (or "the original request" for trigger). */
  label: string;
  /** The producing step's description (documentation), when set. */
  stepDescription?: string | undefined;
  /** The producing step's documentation group, when it belongs to one. */
  group?: OriginGroup | undefined;
  /** The live value at the source (walked from step output / trigger data). */
  value: unknown;
  /** When the resolved value is a file (or files), the attachment(s) to render. */
  attachments?: Attachment[] | undefined;
  kind: OriginKind;
  /** Producing step id, when the ref targets a step. */
  stepId?: string | undefined;
  /** Sub-path within the source, e.g. `output.body.status`. */
  path?: string | undefined;
  /** Refs feeding the producing step — drives upstream ("trace back") recursion. */
  upstreamRefs: string[];
}

/**
 * Accessors the resolver needs, built from data already in hand. Both surfaces
 * (ExecutionViewer, ApprovalsView) construct this from their `ExecutionDetail`.
 */
export interface OriginResolverCtx {
  stepTitle: (stepId: string) => string | undefined;
  stepDescription: (stepId: string) => string | undefined;
  /** The step's documentation group (resolved via groupId → workflow groups). */
  stepGroup: (stepId: string) => OriginGroup | undefined;
  stepOutput: (stepId: string) => unknown;
  stepRawConfig: (stepId: string) => unknown;
  triggerData: unknown;
  /**
   * Workflow variables, keyed by `key` → `value`. A document supplied as a
   * variable (an uploaded file, a fixed reference doc) is cited as `vars.<key>…`,
   * so this is what lets such a citation open — without it the ref is inert.
   */
  varsData?: Record<string, unknown> | undefined;
  /** Human label for the trigger, varied by trigger type. Defaults sensibly. */
  triggerLabel?: string | undefined;
  /** Navigate to the producing step (viewer only). */
  onJump?: ((stepId: string) => void) | undefined;
}

// ─── Funnel: which refs explain a value ───

/**
 * Single funnel for "which refs explain this value". Today: extract every
 * `{{ref}}` from the raw value via the SDK's `collectRefs`. (Future: prefer
 * author-tagged `section.citations` here — one added branch.)
 */
export function getOriginRefs(rawValue: unknown): string[] {
  if (rawValue == null) return [];
  const refs = collectRefs(rawValue, '').map((r) => r.refPath);
  return [...new Set(refs)];
}

// ─── Resolve one ref against the execution data ───

function walkPath(root: unknown, path: string | undefined): unknown {
  if (!path) return root;
  let cur: unknown = root;
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Attachment(s) when a resolved value is a file or file array, else undefined. */
function attachmentsOf(value: unknown): Attachment[] | undefined {
  if (isAttachmentArray(value)) return value;
  if (isAttachment(value)) return [value];
  return undefined;
}

export function resolveRef(refPath: string, ctx: OriginResolverCtx): ResolvedOrigin {
  const parsed = parseRef(refPath);

  if (parsed.source === 'trigger') {
    const value = walkPath(ctx.triggerData, parsed.path);
    return {
      refPath,
      tier: 'derived',
      label: ctx.triggerLabel ?? 'the original request',
      kind: 'trigger',
      path: parsed.path,
      value,
      attachments: attachmentsOf(value),
      upstreamRefs: [],
    };
  }

  if (parsed.source === 'vars') {
    // A variable is a leaf data source like the trigger — no producing step to
    // trace back to. `vars.salesXlsx.0` → variable `salesXlsx` (an attachment
    // array) indexed at 0, resolving to the file the agent cited.
    const value = walkPath(ctx.varsData ?? {}, parsed.path);
    return {
      refPath,
      tier: 'derived',
      label: parsed.path?.split('.')[0] ?? 'a workflow variable',
      kind: 'trigger',
      path: parsed.path,
      value,
      attachments: attachmentsOf(value),
      upstreamRefs: [],
    };
  }

  // source === 'step' — classified structurally, never by step type.
  const stepId = parsed.stepId;
  const output = stepId ? ctx.stepOutput(stepId) : undefined;
  const value = parsed.path ? walkPath({ output }, parsed.path) : output;
  return {
    refPath,
    tier: 'derived',
    label: (stepId && ctx.stepTitle(stepId)) || stepId || 'an earlier step',
    stepDescription: stepId ? ctx.stepDescription(stepId) : undefined,
    group: stepId ? ctx.stepGroup(stepId) : undefined,
    kind: 'step',
    stepId,
    path: parsed.path,
    value,
    attachments: attachmentsOf(value),
    upstreamRefs: stepId ? getOriginRefs(ctx.stepRawConfig(stepId)) : [],
  };
}

// ─── Author citations (overlay lookup) ───

/**
 * The author citations relevant to a rendered field, looked up by its stable
 * {@link tryCitationPath} into the step config. Read-only; returns [] when none.
 *
 * Prefix-aware: returns citations attached to the field's own path **and** to any
 * node beneath it (e.g. the reviewer renders the `display[id]` row while the
 * author cited `display[id].value`). This decouples author-write granularity from
 * reviewer-read granularity, so neither side hardcodes the other's shape.
 */
export function getFieldCitations(
  stepConfig: Record<string, unknown> | undefined,
  citations: Record<string, Citation[]> | undefined,
  fieldPath: string,
): Citation[] {
  if (!stepConfig || !citations) return [];
  const path = tryCitationPath(stepConfig, fieldPath);
  if (!path) return [];
  const out: Citation[] = [];
  for (const [key, list] of Object.entries(citations)) {
    // exact, descendant object key (`path.`), or descendant array element (`path[`)
    if (key === path || key.startsWith(`${path}.`) || key.startsWith(`${path}[`)) {
      out.push(...list);
    }
  }
  return out;
}

// ─── Build a resolver ctx from an ExecutionDetail (refs + outputs in hand) ───

/**
 * Flatten a workflow config's steps (incl. nested branches/loops/cases) → id →
 * config. Delegates traversal to the canonical {@link walkStepConfigs} — the same
 * structural walker the metadata cache and canvas use — so a new control-flow
 * step type is covered automatically, with no nesting keys hardcoded here.
 */
export function buildStepConfigMap(
  config: WorkflowConfig | undefined,
): Map<string, WorkflowStepConfig> {
  const map = new Map<string, WorkflowStepConfig>();
  if (config?.steps) walkStepConfigs(config.steps, (s) => map.set(s.id, s));
  return map;
}

/**
 * Map a step record's `stepName` to its config id. Handles all key forms:
 * a bare config id (top-level), a node-path for a nested step
 * (`ctrl:branch#iter/.../stepId` → leaf id), and the legacy `step_N`.
 */
function resolveStepId(
  stepName: string,
  config: WorkflowConfig | undefined,
  configMap: Map<string, WorkflowStepConfig>,
): string {
  if (configMap.has(stepName)) return stepName;
  const m = /^step_(\d+)$/.exec(stepName);
  if (m && config?.steps) {
    const idx = Number(m[1]);
    const id = config.steps[idx]?.id;
    if (id) return id;
  }
  const leaf = leafStepId(stepName);
  if (configMap.has(leaf)) return leaf;
  return stepName;
}

export function buildOriginCtx(
  detail: ExecutionDetail,
  onJump?: (stepId: string) => void,
): OriginResolverCtx {
  const config = detail.config;
  const configMap = buildStepConfigMap(config);

  // groupId → group (workflow documentation groups)
  const groupsById = new Map<string, OriginGroup>();
  for (const g of (config?.groups ?? []) as Array<{ id: string; title: string; description?: string }>) {
    groupsById.set(g.id, { title: g.title, description: g.description });
  }
  const groupFor = (id: string): OriginGroup | undefined => {
    const gid = configMap.get(id)?.groupId;
    return gid ? groupsById.get(gid) : undefined;
  };

  // stepId → output, parsed from each step record's data JSON.
  const outputs = new Map<string, unknown>();
  for (const step of detail.steps) {
    if (!step.data) continue;
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = JSON.parse(step.data) as Record<string, unknown>;
    } catch {
      continue;
    }
    const id = resolveStepId(step.stepName, config, configMap);
    if ('output' in parsed) outputs.set(id, parsed['output']);
  }

  // variable key → value, so `vars.<key>…` citations (documents supplied as a
  // workflow variable) resolve to their file. The values live on the config the
  // run was launched with, so they're correct for this execution.
  const varsData: Record<string, unknown> = {};
  for (const v of (config?.variables ?? []) as Array<{ key?: string; value?: unknown }>) {
    if (typeof v.key === 'string') varsData[v.key] = v.value;
  }

  return {
    stepTitle: (id) => configMap.get(id)?.title,
    stepDescription: (id) => configMap.get(id)?.description,
    stepGroup: groupFor,
    stepOutput: (id) => outputs.get(id),
    stepRawConfig: (id) => configMap.get(id)?.config,
    triggerData: detail.triggerData,
    triggerLabel: triggerLabelFor(config?.trigger?.type),
    varsData,
    onJump,
  };
}

/**
 * A human label for where the trigger data came from, varied by trigger type
 * (a scheduled run isn't "the original request"). Falls back gracefully.
 */
function triggerLabelFor(type: string | undefined): string {
  switch (type) {
    case 'MANUAL':
      return 'the original request';
    case 'CRON':
      return 'the scheduled run';
    case 'WEBHOOK_V2':
    case 'EVENT':
      return 'the incoming request';
    default:
      return 'the trigger';
  }
}

/**
 * The raw config of a step currently paused awaiting approval — the first open
 * leaf gate (EXTERNAL_WAIT or REVIEW_WAIT), excluding control-step markers
 * (executorType 'conditional'). With multiple concurrent gates this returns one;
 * the approvals view enumerates them all.
 */
export function findPausedStepConfig(detail: ExecutionDetail): WorkflowStepConfig | undefined {
  const waitStep = detail.steps.find(
    (s) =>
      (s.status === 'EXTERNAL_WAIT' || s.status === 'REVIEW_WAIT') &&
      s.executorType !== 'conditional',
  );
  if (!waitStep) return undefined;
  const configMap = buildStepConfigMap(detail.config);
  const id = resolveStepId(waitStep.stepName, detail.config, configMap);
  return configMap.get(id);
}

