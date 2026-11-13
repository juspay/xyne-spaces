import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TriggerFilter, TriggerStart } from '@xyne/workflow-sdk/builder';
import type {
  WorkflowConfig,
  WorkflowStepConfig,
  WorkflowSettings,
  WorkflowRunNaming,
  WorkflowVariable,
  StepGroup,
  Citation,
} from '@xyne/workflow-sdk/builder';
import { ensureCitationPath } from '@xyne/workflow-sdk/builder';
import type { ValidationResult } from '@xyne/workflow-sdk';
import { useWorkflowClient } from './use-workflow-client.js';
import { useUndoRedo } from './use-undo-redo.js';
import {
  detectBranchesFromConfig,
  setAtPath,
  getAtPath,
  generateConfigDefaults,
  walkStepConfigs,
} from '../utils/branch-detection.js';
import type { DetectedBranch } from '../utils/branch-detection.js';

// ─── Schema cache ───

/** Maps step type → configSchema (JSON Schema). Used for branch detection. */
type SchemaCache = Map<string, Record<string, unknown>>;

// ─── Branch helpers (generic, config-driven) ───

function getBranches(
  step: WorkflowStepConfig,
  cache: SchemaCache,
): Record<string, DetectedBranch> {
  if (!step.config || typeof step.config !== 'object') return {};
  return detectBranchesFromConfig(
    step.config as Record<string, unknown>,
    cache.get(step.type),
  );
}

/**
 * Apply `mapper` to every detected branch inside `step`. Uses immutable
 * `setAtPath` writes so arbitrary-depth paths (e.g. `cases.0.steps`) work.
 */
function mapBranches(
  step: WorkflowStepConfig,
  mapper: (branch: WorkflowStepConfig[]) => WorkflowStepConfig[],
  cache: SchemaCache,
): WorkflowStepConfig {
  const branches = getBranches(step, cache);
  if (Object.keys(branches).length === 0) return step;

  let config = (step.config ?? {}) as Record<string, unknown>;
  for (const [path, branch] of Object.entries(branches)) {
    config = setAtPath(config, path, mapper(branch.steps));
  }
  return { ...step, config } as WorkflowStepConfig;
}

// ─── Step tree helpers ───

function generateStepId(type: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${type.toLowerCase()}_${suffix}`;
}

function insertStepAfter(
  steps: WorkflowStepConfig[],
  afterId: string | undefined,
  newStep: WorkflowStepConfig,
): WorkflowStepConfig[] {
  if (!afterId) return [newStep, ...steps];
  const idx = steps.findIndex((s) => s.id === afterId);
  if (idx === -1) return [...steps, newStep];
  const result = [...steps];
  result.splice(idx + 1, 0, newStep);
  return result;
}

function removeStepById(
  steps: WorkflowStepConfig[],
  targetId: string,
  cache: SchemaCache,
): WorkflowStepConfig[] {
  return steps
    .filter((s) => s.id !== targetId)
    .map((s) => mapBranches(s, (branch) => removeStepById(branch, targetId, cache), cache));
}

function updateStepInTree(
  steps: WorkflowStepConfig[],
  targetId: string,
  updater: (step: WorkflowStepConfig) => WorkflowStepConfig,
  cache: SchemaCache,
): WorkflowStepConfig[] {
  return steps.map((s) => {
    if (s.id === targetId) return updater(s);
    return mapBranches(s, (branch) => updateStepInTree(branch, targetId, updater, cache), cache);
  });
}

function findStepInTree(
  steps: WorkflowStepConfig[],
  targetId: string,
  cache: SchemaCache,
): WorkflowStepConfig | null {
  for (const step of steps) {
    if (step.id === targetId) return step;
    const branches = getBranches(step, cache);
    for (const branch of Object.values(branches)) {
      const found = findStepInTree(branch.steps, targetId, cache);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Where a new step goes: which list holds it, and what it follows there.
 *
 * This is the vocabulary `addStep` already speaks, so anything that can work out
 * a placement can insert — there is one insert path, not one per way of asking
 * for it.
 */
export interface StepPlacement {
  afterStepId?: string;
  inBranch?: { stepId: string; branchKey: string };
}

/**
 * The placement that puts a new step immediately above `targetId`, wherever that
 * step sits — top level, or inside any branch, however deep.
 *
 * "Above X" is "after whatever X follows": the step before it in X's own list,
 * or nothing at all when X is first there, which prepends to that same list.
 * Returns null when no such step exists, so a caller can tell "nowhere to put
 * it" from "put it first".
 */
function placementAbove(
  steps: WorkflowStepConfig[],
  targetId: string,
  cache: SchemaCache,
  inBranch?: { stepId: string; branchKey: string },
): StepPlacement | null {
  const at = steps.findIndex((s) => s.id === targetId);
  if (at !== -1) {
    const previous = steps[at - 1];
    return {
      ...(previous ? { afterStepId: previous.id } : {}),
      ...(inBranch ? { inBranch } : {}),
    };
  }
  for (const step of steps) {
    for (const [branchKey, branch] of Object.entries(getBranches(step, cache))) {
      const found = placementAbove(branch.steps, targetId, cache, { stepId: step.id, branchKey });
      if (found) return found;
    }
  }
  return null;
}

/**
 * Insert a step into a specific branch of a control-flow step.
 * Handles dotted keys: "body" for LOOP, "branches.A" for PARALLEL.
 */
function insertIntoBranch(
  steps: WorkflowStepConfig[],
  branchStepId: string,
  branchKey: string,
  newStep: WorkflowStepConfig,
  cache: SchemaCache,
  afterStepId?: string,
): WorkflowStepConfig[] {
  return steps.map((s) => {
    if (s.id === branchStepId && s.config && typeof s.config === 'object') {
      const existing = getAtPath(s.config as Record<string, unknown>, branchKey);
      const branch = (Array.isArray(existing) ? existing : []) as WorkflowStepConfig[];
      const config = setAtPath(
        s.config as Record<string, unknown>,
        branchKey,
        insertStepAfter(branch, afterStepId, newStep),
      );
      return { ...s, config } as WorkflowStepConfig;
    }
    return mapBranches(s, (branch) =>
      insertIntoBranch(branch, branchStepId, branchKey, newStep, cache, afterStepId),
    cache);
  });
}

// ─── Default config ───

function defaultConfig(): WorkflowConfig {
  return {
    trigger: { type: 'MANUAL', config: {} },
    steps: [],
  };
}

// ─── Hook ───

export interface UseWorkflowBuilderOptions {
  initialConfig?: WorkflowConfig;
  onChange?: (config: WorkflowConfig) => void;
  autoValidate?: boolean;
}

export interface UseWorkflowBuilderReturn {
  // State
  config: WorkflowConfig;
  selectedStepId: string | null;
  isTriggerSelected: boolean;
  isVariablesSelected: boolean;
  isTriggerConfigured: boolean;
  isDirty: boolean;
  validation: ValidationResult | null;
  isValidating: boolean;

  // Step mutations
  addStep: (type: string, afterStepId?: string, inBranch?: { stepId: string; branchKey: string }) => string;
  /**
   * Where a step would go to sit directly above `stepId` — hand it to `addStep`.
   * Null when there is no such step.
   */
  placeAbove: (stepId: string) => StepPlacement | null;
  removeStep: (stepId: string) => void;
  updateStepConfig: (stepId: string, config: Record<string, unknown>) => void;
  renameStep: (stepId: string, name: string) => void;
  /** Update a step's documentation fields (alias title/description, group membership). */
  updateStepMeta: (stepId: string, meta: { title?: string; description?: string; groupId?: string | null }) => void;
  /** Add an author citation to a field (documentation overlay). */
  addStepCitation: (stepId: string, fieldPath: string, citation: Citation) => void;
  /** Remove the citation at `index` under a stable CitationPath. */
  removeStepCitation: (stepId: string, citationPath: string, index: number) => void;
  duplicateStep: (stepId: string) => void;
  toggleStepDisabled: (stepId: string) => void;

  // Group mutations (documentation overlay)
  /** Create or update a step group (by id). */
  upsertGroup: (group: StepGroup) => void;
  /** Remove a group and clear it from any steps that reference it. */
  removeGroup: (groupId: string) => void;

  // Branch mutations (for dynamic branches like PARALLEL)
  /** Add a named branch to a step's dynamic branch container (e.g. PARALLEL's branches). */
  addBranch: (stepId: string, containerKey: string, branchName: string) => void;
  /** Remove a named branch from a step's dynamic branch container. */
  removeBranch: (stepId: string, containerKey: string, branchName: string) => void;
  /** Rename a branch in a step's dynamic branch container. */
  renameBranch: (stepId: string, containerKey: string, oldName: string, newName: string) => void;

  // Trigger
  setTrigger: (type: string, config?: Record<string, unknown>) => void;
  updateTriggerConfig: (config: Record<string, unknown>) => void;
  /** Set the trigger's filter, or remove it with `undefined`. */
  updateTriggerFilter: (filter: TriggerFilter | undefined) => void;
  /** Set when a matching event becomes a run, or remove the delay with `undefined`. */
  updateTriggerStart: (start: TriggerStart | undefined) => void;

  // Settings
  updateSettings: (settings: Partial<WorkflowSettings>) => void;
  /** Set how each run is identified; `undefined` goes back to generated names. */
  updateRunNaming: (runNaming: WorkflowRunNaming | undefined) => void;

  // Variables (author-time constants, referenced as {{vars.key}})
  updateVariables: (variables: WorkflowVariable[]) => void;

  // Selection
  selectStep: (stepId: string | null) => void;
  selectTrigger: () => void;
  selectVariables: () => void;
  clearSelection: () => void;

  // Undo/redo
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  // Lifecycle
  validate: () => Promise<ValidationResult>;
  loadConfig: (config: WorkflowConfig) => void;
  /** Replace the entire config, preserving undo history. */
  applyConfig: (config: WorkflowConfig) => void;
  reset: () => void;

  // Helpers
  getStep: (stepId: string) => WorkflowStepConfig | null;
}

export function useWorkflowBuilder(
  opts: UseWorkflowBuilderOptions = {},
): UseWorkflowBuilderReturn {
  const { initialConfig, onChange, autoValidate = false } = opts;
  const client = useWorkflowClient();

  const initial = useMemo(
    () => initialConfig ?? defaultConfig(),
    // Only use on first render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const {
    state: config,
    setState: setConfig,
    amend: amendConfig,
    undo,
    redo,
    canUndo,
    canRedo,
    reset: resetHistory,
  } = useUndoRedo<WorkflowConfig>(initial);

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [isTriggerSelected, setIsTriggerSelected] = useState(false);
  const [isVariablesSelected, setIsVariablesSelected] = useState(false);
  const [isTriggerConfigured, setIsTriggerConfigured] = useState(!!initialConfig?.trigger?.type);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const savedConfigRef = useRef(initial);
  const isDirty = config !== savedConfigRef.current;

  // Schema cache: maps step type → configSchema (JSON Schema) for branch detection
  const schemaCacheRef = useRef<SchemaCache>(new Map());

  // Fetch configSchema for all step types in the current config
  useEffect(() => {
    const types = new Set<string>();
    // Schema-free walk — works even when SWITCH's own schema isn't cached
    // yet, so we discover steps nested inside cases[i].steps on the first pass.
    walkStepConfigs(config.steps, (s) => { types.add(s.type); });

    for (const type of types) {
      if (!schemaCacheRef.current.has(type)) {
        void (async () => {
          try {
            const desc = await client.schema.step(type);
            schemaCacheRef.current.set(type, desc.configSchema);
          } catch {
            // Step descriptor unavailable
          }
        })();
      }
    }
  }, [config.steps, client]);

  // Notify parent on change
  useEffect(() => {
    onChange?.(config);
  }, [config, onChange]);

  // Auto-validate (debounced)
  useEffect(() => {
    if (!autoValidate) return;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await client.workflows.validate(config);
          setValidation(result);
        } catch {
          // Validation failure is non-critical
        }
      })();
    }, 500);
    return () => clearTimeout(timer);
  }, [config, autoValidate, client]);

  // ─── Step mutations ───

  const addStep = useCallback(
    (type: string, afterStepId?: string, inBranch?: { stepId: string; branchKey: string }): string => {
      const id = generateStepId(type);
      const cache = schemaCacheRef.current;
      const newStep: WorkflowStepConfig = {
        id,
        type,
        config: {},
      } as WorkflowStepConfig;

      const updatedSteps = inBranch
        ? insertIntoBranch(config.steps, inBranch.stepId, inBranch.branchKey, newStep, cache, afterStepId)
        : insertStepAfter(config.steps, afterStepId, newStep);

      setConfig({ ...config, steps: updatedSteps });

      // Fetch configSchema and backfill defaults (branch containers + default values)
      void (async () => {
        try {
          const desc = await client.schema.step(type);
          cache.set(type, desc.configSchema);

          const defaults = generateConfigDefaults(desc.configSchema);
          if (Object.keys(defaults).length > 0) {
            // Use functional updater to avoid overwriting concurrent changes
            amendConfig((prev) => ({
              ...prev,
              steps: updateStepInTree(prev.steps, id, (s) => ({
                ...s,
                config: { ...defaults, ...(s.config as Record<string, unknown>) },
              } as WorkflowStepConfig), cache),
            }));
          }
        } catch {
          // Descriptor fetch failed — keep empty config
        }
      })();

      setSelectedStepId(id);
      setIsTriggerSelected(false);
      return id;
    },
    [config, setConfig, amendConfig, client],
  );

  const placeAbove = useCallback(
    (stepId: string): StepPlacement | null => placementAbove(config.steps, stepId, schemaCacheRef.current),
    [config.steps],
  );

  const removeStep = useCallback(
    (stepId: string) => {
      setConfig({
        ...config,
        steps: removeStepById(config.steps, stepId, schemaCacheRef.current),
      });
      if (selectedStepId === stepId) {
        setSelectedStepId(null);
      }
    },
    [config, setConfig, selectedStepId],
  );

  const updateStepConfig = useCallback(
    (stepId: string, stepConfig: Record<string, unknown>) => {
      setConfig({
        ...config,
        steps: updateStepInTree(config.steps, stepId, (s) => ({
          ...s,
          config: { ...(s.config as Record<string, unknown>), ...stepConfig },
        } as WorkflowStepConfig), schemaCacheRef.current),
      });
    },
    [config, setConfig],
  );

  const renameStep = useCallback(
    (stepId: string, name: string) => {
      setConfig({
        ...config,
        steps: updateStepInTree(config.steps, stepId, (s) => ({
          ...s,
          id: name,
        } as WorkflowStepConfig), schemaCacheRef.current),
      });
      if (selectedStepId === stepId) {
        setSelectedStepId(name);
      }
    },
    [config, setConfig, selectedStepId],
  );

  const updateStepMeta = useCallback(
    (
      stepId: string,
      meta: { title?: string; description?: string; groupId?: string | null },
    ) => {
      setConfig((prev) => ({
        ...prev,
        steps: updateStepInTree(prev.steps, stepId, (s) => {
          const next = { ...s } as Record<string, unknown>;
          // Set when non-empty, otherwise drop the key (keeps the config clean
          // and satisfies exactOptionalPropertyTypes).
          const apply = (key: string, value: string | null | undefined) => {
            if (value === undefined) return; // not being changed
            if (value) next[key] = value; else delete next[key];
          };
          apply('title', meta.title);
          apply('description', meta.description);
          apply('groupId', meta.groupId);
          return next as unknown as WorkflowStepConfig;
        }, schemaCacheRef.current),
      }));
    },
    [setConfig],
  );

  // Add an author citation to a field. Resolves the field's stable CitationPath
  // (stamping an id onto the cited array element if needed — hence we also write
  // back the possibly-mutated config), then appends to step.citations[path].
  const addStepCitation = useCallback(
    (stepId: string, fieldPath: string, citation: Citation) => {
      setConfig((prev) => ({
        ...prev,
        steps: updateStepInTree(prev.steps, stepId, (s) => {
          const stepConfig = structuredClone(s.config) as Record<string, unknown>;
          const path = ensureCitationPath(stepConfig, fieldPath);
          if (path === null) return s;
          const existing = (s.citations ?? {}) as Record<string, Citation[]>;
          return {
            ...s,
            config: stepConfig,
            citations: { ...existing, [path]: [...(existing[path] ?? []), citation] },
          } as unknown as WorkflowStepConfig;
        }, schemaCacheRef.current),
      }));
    },
    [setConfig],
  );

  // Remove the citation at `index` under `citationPath`; drops the key/overlay
  // when it becomes empty.
  const removeStepCitation = useCallback(
    (stepId: string, citationPath: string, index: number) => {
      setConfig((prev) => ({
        ...prev,
        steps: updateStepInTree(prev.steps, stepId, (s) => {
          const existing = (s.citations ?? {}) as Record<string, Citation[]>;
          const list = existing[citationPath];
          if (!list) return s;
          const nextList = list.filter((_, i) => i !== index);
          const nextCitations = { ...existing };
          if (nextList.length > 0) nextCitations[citationPath] = nextList;
          else delete nextCitations[citationPath];
          const next = { ...s } as Record<string, unknown>;
          if (Object.keys(nextCitations).length > 0) next['citations'] = nextCitations;
          else delete next['citations'];
          return next as unknown as WorkflowStepConfig;
        }, schemaCacheRef.current),
      }));
    },
    [setConfig],
  );

  const upsertGroup = useCallback(
    (group: StepGroup) => {
      setConfig((prev) => {
        const groups = prev.groups ?? [];
        const idx = groups.findIndex((g) => g.id === group.id);
        const next = idx >= 0
          ? groups.map((g) => (g.id === group.id ? group : g))
          : [...groups, group];
        return { ...prev, groups: next };
      });
    },
    [setConfig],
  );

  const removeGroup = useCallback(
    (groupId: string) => {
      setConfig((prev) => ({
        ...prev,
        groups: (prev.groups ?? []).filter((g) => g.id !== groupId),
        // Clear membership from any step that referenced the removed group.
        steps: prev.steps.map((s) => {
          if (s.groupId !== groupId) return s;
          const next = { ...s } as Record<string, unknown>;
          delete next['groupId'];
          return next as unknown as WorkflowStepConfig;
        }),
      }));
    },
    [setConfig],
  );

  const duplicateStep = useCallback(
    (stepId: string) => {
      const step = findStepInTree(config.steps, stepId, schemaCacheRef.current);
      if (!step) return;
      const newId = generateStepId(step.type);
      const duplicate = { ...structuredClone(step), id: newId } as WorkflowStepConfig;
      setConfig({
        ...config,
        steps: insertStepAfter(config.steps, stepId, duplicate),
      });
    },
    [config, setConfig],
  );

  const toggleStepDisabled = useCallback(
    (stepId: string) => {
      setConfig({
        ...config,
        steps: updateStepInTree(config.steps, stepId, (s) => {
          const cfg = (s.config ?? {}) as Record<string, unknown>;
          return {
            ...s,
            config: { ...cfg, disabled: !cfg['disabled'] },
          } as WorkflowStepConfig;
        }, schemaCacheRef.current),
      });
    },
    [config, setConfig],
  );

  // ─── Branch mutations (for dynamic branches like PARALLEL) ───

  const addBranch = useCallback(
    (stepId: string, containerKey: string, branchName: string) => {
      setConfig({
        ...config,
        steps: updateStepInTree(config.steps, stepId, (s) => {
          const cfg = { ...(s.config as Record<string, unknown>) };
          const container = { ...((cfg[containerKey] ?? {}) as Record<string, unknown>) };
          container[branchName] = [];
          cfg[containerKey] = container;
          return { ...s, config: cfg } as WorkflowStepConfig;
        }, schemaCacheRef.current),
      });
    },
    [config, setConfig],
  );

  const removeBranch = useCallback(
    (stepId: string, containerKey: string, branchName: string) => {
      setConfig({
        ...config,
        steps: updateStepInTree(config.steps, stepId, (s) => {
          const cfg = { ...(s.config as Record<string, unknown>) };
          const container = { ...((cfg[containerKey] ?? {}) as Record<string, unknown>) };
          delete container[branchName];
          cfg[containerKey] = container;
          return { ...s, config: cfg } as WorkflowStepConfig;
        }, schemaCacheRef.current),
      });
    },
    [config, setConfig],
  );

  const renameBranch = useCallback(
    (stepId: string, containerKey: string, oldName: string, newName: string) => {
      if (!newName.trim() || oldName === newName) return;
      setConfig({
        ...config,
        steps: updateStepInTree(config.steps, stepId, (s) => {
          const cfg = { ...(s.config as Record<string, unknown>) };
          const container = { ...((cfg[containerKey] ?? {}) as Record<string, unknown>) };
          if (!(oldName in container) || newName in container) return s;
          // Preserve insertion order: rebuild with new name in same position
          const rebuilt: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(container)) {
            rebuilt[k === oldName ? newName : k] = v;
          }
          cfg[containerKey] = rebuilt;
          return { ...s, config: cfg } as WorkflowStepConfig;
        }, schemaCacheRef.current),
      });
    },
    [config, setConfig],
  );

  // ─── Trigger ───

  const setTrigger = useCallback(
    (type: string, triggerConfig?: Record<string, unknown>) => {
      // Deliberately NOT spread: a filter or a start anchor names the old
      // trigger's own fields, so both are cleared when the trigger changes.
      setConfig({
        ...config,
        trigger: { type, config: triggerConfig ?? {} },
      });
      setIsTriggerConfigured(true);
    },
    [config, setConfig],
  );

  const updateTriggerConfig = useCallback(
    (triggerConfig: Record<string, unknown>) => {
      setConfig({
        ...config,
        trigger: {
          ...config.trigger,
          config: { ...config.trigger.config, ...triggerConfig },
        },
      });
    },
    [config, setConfig],
  );

  const updateTriggerFilter = useCallback(
    (filter: TriggerFilter | undefined) => {
      // Spread the binding rather than rebuild it: `filter` is one of several
      // fields beside `config`, and rebuilding silently dropped the others — a
      // workflow given a delayed start through the API lost it the moment
      // someone touched its filter here.
      const { filter: _dropped, ...trigger } = config.trigger;
      setConfig({
        ...config,
        trigger: { ...trigger, ...(filter ? { filter } : {}) },
      });
    },
    [config, setConfig],
  );

  const updateTriggerStart = useCallback(
    (start: TriggerStart | undefined) => {
      const { start: _dropped, ...trigger } = config.trigger;
      setConfig({
        ...config,
        trigger: { ...trigger, ...(start ? { start } : {}) },
      });
    },
    [config, setConfig],
  );

  // ─── Settings ───

  const updateSettings = useCallback(
    (settings: Partial<WorkflowSettings>) => {
      setConfig({
        ...config,
        settings: { ...config.settings, ...settings } as WorkflowSettings,
      });
    },
    [config, setConfig],
  );

  const updateRunNaming = useCallback(
    (runNaming: WorkflowRunNaming | undefined) => {
      // Removed outright rather than stored as undefined, so a cleared setting
      // leaves no trace in the saved config.
      const { runNaming: _previous, ...rest } = config.settings ?? {};
      setConfig({
        ...config,
        settings: (runNaming ? { ...rest, runNaming } : rest) as WorkflowSettings,
      });
    },
    [config, setConfig],
  );

  // ─── Variables (author-time constants) ───

  const updateVariables = useCallback(
    (variables: WorkflowVariable[]) => {
      setConfig({ ...config, variables });
    },
    [config, setConfig],
  );

  // ─── Selection ───

  const selectStep = useCallback((stepId: string | null) => {
    setSelectedStepId(stepId);
    setIsTriggerSelected(false);
    setIsVariablesSelected(false);
  }, []);

  const selectTrigger = useCallback(() => {
    setSelectedStepId(null);
    setIsTriggerSelected(true);
    setIsVariablesSelected(false);
  }, []);

  const selectVariables = useCallback(() => {
    setSelectedStepId(null);
    setIsTriggerSelected(false);
    setIsVariablesSelected(true);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedStepId(null);
    setIsTriggerSelected(false);
    setIsVariablesSelected(false);
  }, []);

  // ─── Lifecycle ───

  const validate = useCallback(async (): Promise<ValidationResult> => {
    setIsValidating(true);
    try {
      const result = await client.workflows.validate(config);
      setValidation(result);
      return result;
    } finally {
      setIsValidating(false);
    }
  }, [client, config]);

  const loadConfig = useCallback(
    (newConfig: WorkflowConfig) => {
      resetHistory(newConfig);
      savedConfigRef.current = newConfig;
      setSelectedStepId(null);
      setIsTriggerSelected(false);
      setIsVariablesSelected(false);
      setValidation(null);
    },
    [resetHistory],
  );

  const applyConfig = useCallback(
    (newConfig: WorkflowConfig) => {
      setConfig(newConfig);
      setIsTriggerConfigured(!!newConfig.trigger?.type);
      setSelectedStepId(null);
      setIsTriggerSelected(false);
      setIsVariablesSelected(false);
      setValidation(null);
    },
    [setConfig],
  );

  const resetFn = useCallback(() => {
    loadConfig(initialConfig ?? defaultConfig());
  }, [loadConfig, initialConfig]);

  const getStep = useCallback(
    (stepId: string) => findStepInTree(config.steps, stepId, schemaCacheRef.current),
    [config.steps],
  );

  return {
    config,
    selectedStepId,
    isTriggerSelected,
    isVariablesSelected,
    isTriggerConfigured,
    isDirty,
    validation,
    isValidating,

    addStep,
    placeAbove,
    removeStep,
    updateStepConfig,
    renameStep,
    updateStepMeta,
    addStepCitation,
    removeStepCitation,
    upsertGroup,
    removeGroup,
    duplicateStep,
    toggleStepDisabled,

    addBranch,
    removeBranch,
    renameBranch,

    setTrigger,
    updateTriggerConfig,
    updateTriggerFilter,
    updateTriggerStart,

    updateSettings,
    updateRunNaming,
    updateVariables,

    selectStep,
    selectTrigger,
    selectVariables,
    clearSelection,

    undo,
    redo,
    canUndo,
    canRedo,

    validate,
    loadConfig,
    applyConfig,
    reset: resetFn,

    getStep,
  };
}
