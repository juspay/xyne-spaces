/**
 * Generic branch detection — scans step config + configSchema for nested
 * step arrays. Works for any control-flow step without hardcoding types.
 *
 * Three shapes detected (in order of preference inside a property):
 *
 * 1. **Direct step array** — `key: WorkflowStepConfig[]`
 *    Used by LOOP (`body`), CONDITIONAL (`if_true`/`if_false`), SWITCH (`default`).
 *
 * 2. **Record of step arrays** — `key: { branchName: WorkflowStepConfig[] }`
 *    Used by PARALLEL (`branches`). Dynamic — branch names are user-defined.
 *
 * 3. **Array of objects each containing a step array** —
 *    `key: Array<{ steps: WorkflowStepConfig[]; label?: string; ... }>`
 *    Used by SWITCH (`cases`). Ordered, positional — each element is its
 *    own branch keyed by index.
 *
 * The detector returns `{ steps, label }` per branch so callers don't have
 * to derive labels from path strings. Path segments use dots and numeric
 * segments for array indices: `cases.0.steps`, `branches.main`, `body`,
 * `default`.
 *
 * configSchema (JSON Schema) is consulted to confirm empty containers and
 * to identify array-of-object branches whose runtime values may be empty.
 */

import type { WorkflowStepConfig } from '@xyne/workflow-sdk/builder';

// ─── Public types ───

/**
 * One detected branch — the step array plus a user-facing label.
 * The map key (`branchKey`) is the dotted path into the step config; the
 * `label` here is what to show on the canvas / variable picker.
 */
export interface DetectedBranch {
  steps: WorkflowStepConfig[];
  label: string;
}

// ─── Shape detection ───

/** A non-empty array of objects with `id` and `type` looks like a step array. */
export function isStepConfigArray(value: unknown): value is WorkflowStepConfig[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const first = value[0] as Record<string, unknown>;
  return typeof first === 'object' && first !== null && 'id' in first && 'type' in first;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ─── JSON Schema helpers ───

/** Schema describes `WorkflowStepConfig[]` (items have `id` + `type`)? */
function isStepArraySchema(schema?: Record<string, unknown>): boolean {
  if (!schema || schema['type'] !== 'array') return false;
  const items = schema['items'] as Record<string, unknown> | undefined;
  if (items?.['type'] !== 'object') return false;
  const itemProps = items['properties'] as Record<string, unknown> | undefined;
  return !!itemProps && 'id' in itemProps && 'type' in itemProps;
}

/** Schema describes `Record<string, WorkflowStepConfig[]>` (PARALLEL.branches)? */
function isDynamicBranchSchema(schema?: Record<string, unknown>): boolean {
  if (!schema || schema['type'] !== 'object') return false;
  const additionalProps = schema['additionalProperties'] as Record<string, unknown> | undefined;
  return isStepArraySchema(additionalProps);
}

/**
 * Schema describes `Array<{ steps: WorkflowStepConfig[]; ... }>` (SWITCH.cases)?
 * The items are objects with a `steps` property whose schema is a step array.
 */
function isCaseArraySchema(schema?: Record<string, unknown>): boolean {
  if (!schema || schema['type'] !== 'array') return false;
  const items = schema['items'] as Record<string, unknown> | undefined;
  if (items?.['type'] !== 'object') return false;
  const itemProps = items['properties'] as Record<string, unknown> | undefined;
  if (!itemProps) return false;
  return isStepArraySchema(itemProps['steps'] as Record<string, unknown> | undefined);
}

function getSchemaProperties(
  configSchema?: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  return ((configSchema?.['properties'] ?? {}) as Record<string, Record<string, unknown>>);
}

// ─── Branch detection ───

/**
 * Discover all branches in a step's config.
 *
 * Returns a flat map `branchPath → { steps, label }`.
 * - Path uses dots; numeric segments are array indices: `cases.0.steps`.
 * - `label` is what the UI should display: dynamic branch keys (PARALLEL)
 *   return themselves; SWITCH cases return the case's `label` field, or
 *   "Case 1" / "Case 2" fallback; direct arrays return the property name.
 */
export function detectBranchesFromConfig(
  config: Record<string, unknown>,
  configSchema?: Record<string, unknown>,
): Record<string, DetectedBranch> {
  const branches: Record<string, DetectedBranch> = {};
  const properties = getSchemaProperties(configSchema);

  for (const [key, value] of Object.entries(config)) {
    const propSchema = properties[key];

    // 1. Direct step-config array (with or without items).
    if (isStepConfigArray(value)) {
      branches[key] = { steps: value, label: key };
      continue;
    }
    if (Array.isArray(value) && value.length === 0 && isStepArraySchema(propSchema)) {
      branches[key] = { steps: [], label: key };
      continue;
    }

    // 2. Array of case-like objects with a nested `steps` array (SWITCH cases).
    if (Array.isArray(value) && isCaseArraySchema(propSchema)) {
      value.forEach((entry, i) => {
        if (!isPlainObject(entry)) return;
        const caseSteps = entry['steps'];
        if (!Array.isArray(caseSteps)) return;
        const label = (typeof entry['label'] === 'string' && entry['label'].trim().length > 0)
          ? entry['label']
          : `Case ${i + 1}`;
        branches[`${key}.${i}.steps`] = {
          steps: caseSteps as WorkflowStepConfig[],
          label,
        };
      });
      continue;
    }

    // 3. Record of step arrays (PARALLEL branches).
    if (isPlainObject(value)) {
      const isDynamic = isDynamicBranchSchema(propSchema);
      for (const [subKey, subValue] of Object.entries(value)) {
        if (isStepConfigArray(subValue)) {
          branches[`${key}.${subKey}`] = { steps: subValue, label: subKey };
        } else if (Array.isArray(subValue) && subValue.length === 0 && isDynamic) {
          branches[`${key}.${subKey}`] = { steps: [], label: subKey };
        }
      }
    }
  }

  return branches;
}

// ─── Path helpers (arbitrary depth, dots + numeric indices) ───

/**
 * Walks `obj` along the dotted path. Numeric segments index arrays; other
 * segments index objects. Returns `undefined` if any intermediate is missing.
 */
export function getAtPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const segments = path.split('.');
  let current: unknown = obj;
  for (const seg of segments) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx)) return undefined;
      current = current[idx];
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Returns a NEW object/array with `value` set at `path`. Intermediate
 * objects and arrays are shallow-cloned so the caller can treat the input
 * as immutable.
 *
 * Numeric segments index arrays; other segments index objects. An empty
 * intermediate becomes `{}` or `[]` based on whether the *next* segment
 * looks like a numeric index.
 */
export function setAtPath<T extends Record<string, unknown> | unknown[]>(
  obj: T,
  path: string,
  value: unknown,
): T {
  if (!path) return value as T;
  const segments = path.split('.');
  return setAtSegments(obj, segments, value) as T;
}

function setAtSegments(
  obj: unknown,
  segments: string[],
  value: unknown,
): unknown {
  if (segments.length === 0) return value;
  const [head, ...rest] = segments;
  const isArrayIndex = Number.isInteger(Number(head));

  if (isArrayIndex) {
    const idx = Number(head);
    const arr = Array.isArray(obj) ? [...obj] : [];
    arr[idx] = setAtSegments(arr[idx], rest, value);
    return arr;
  }

  const base = isPlainObject(obj) ? { ...obj } : {};
  base[head!] = setAtSegments(base[head!], rest, value);
  return base;
}

// ─── Schema-free walker (for discovery, not rendering) ───

/**
 * Recursively visit every nested `WorkflowStepConfig` inside an arbitrary
 * config value, without needing a JSON Schema. Used to collect every step
 * type referenced by a workflow so the metadata cache can pre-fetch them.
 *
 * Unlike `detectBranchesFromConfig` (which needs the schema to identify
 * empty branches and case-array shapes for rendering), this walker is
 * purely structural: it finds step arrays no matter how they're nested
 * (`config.body`, `config.branches.A`, `config.cases[0].steps`, etc.).
 */
export function walkStepConfigs(
  value: unknown,
  visit: (step: WorkflowStepConfig) => void,
): void {
  if (isStepConfigArray(value)) {
    for (const step of value) {
      visit(step);
      if (step.config) walkStepConfigs(step.config, visit);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkStepConfigs(item, visit);
    return;
  }
  if (isPlainObject(value)) {
    for (const sub of Object.values(value)) walkStepConfigs(sub, visit);
  }
}

// ─── Config defaults from JSON Schema ───

/**
 * Generate sensible default values from a JSON Schema (StepDescriptor.configSchema).
 * Used to initialize step config on addStep so branch containers exist immediately.
 *
 *   PARALLEL → { branches: { 'Branch 1': [], 'Branch 2': [] }, merge: 'allSettled' }
 *   LOOP     → { body: [], maxIterations: 1000 }
 *   SWITCH   → { cases: [], default: [] }
 */
export function generateConfigDefaults(
  configSchema: Record<string, unknown>,
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  const properties = getSchemaProperties(configSchema);

  for (const [key, propSchema] of Object.entries(properties)) {
    if ('default' in propSchema) {
      defaults[key] = propSchema['default'];
    } else if (isDynamicBranchSchema(propSchema)) {
      // Dynamic branch container (PARALLEL) — seed with 2 default branches.
      defaults[key] = { 'Branch 1': [], 'Branch 2': [] };
    } else if (propSchema['type'] === 'object') {
      defaults[key] = {};
    } else if (propSchema['type'] === 'array') {
      defaults[key] = [];
    }
  }

  return defaults;
}
