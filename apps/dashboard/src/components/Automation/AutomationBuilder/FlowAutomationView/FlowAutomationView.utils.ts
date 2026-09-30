import { CONDITIONAL_STEP_TYPE, SWITCH_STEP_TYPE } from '../../Automation.types';
import type {
  ActionStepConfig,
  AutomationConfig,
  AutomationStepConfig,
  ConditionalStepConfig,
  StepCatalogItem,
  StepSchema,
  SwitchStepConfig,
  TriggerSchema,
  ValidationIssue,
} from '../../Automation.types';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import {
  buildVariableSources as buildRootVariableSources,
  issuesAtStep,
  issuesUnder,
  moveStep,
  pushStepVariableSources,
} from '../AutomationBuilder.utils';
import type {
  FlowInsertTarget,
  FlowItem,
  FlowRunOverlay,
  ViewStepPath,
} from './FlowAutomationView.types';

/** Analytics namespace for every data-track-* attribute the flow view renders. */
export const TRACK_CATEGORY = 'automation-builder-flow';

export const TRIGGER_NODE_ID = 'trigger';
export const ROOT_CONTAINER: ViewStepPath = ['root'];
const NODE_WIDTH = 248;
// Fixed heights: every text line inside a node is single-line + truncated, so
// these are guaranteed to fit the content (see FlowAutomationView nodes).
/** Icon row plus padding; every node renders the same chrome. */
const NODE_HEIGHT = 64;
const PLACEHOLDER_HEIGHT = 44;
const MERGE_SIZE = 12;

export function isStepItem(item: FlowItem): boolean {
  return (
    item.nodeType === 'action' || item.nodeType === 'conditional' || item.nodeType === 'switch'
  );
}

/** The branch keys a control step owns, in canvas order. */
export function listBranchKeys(step: AutomationStepConfig): string[] {
  if (step.type === CONDITIONAL_STEP_TYPE) return ['if_true', 'if_false'];
  if (step.type === SWITCH_STEP_TYPE) {
    const sw = step as SwitchStepConfig;
    return [...sw.config.cases.map((_, i) => `case:${i}`), 'default'];
  }
  return [];
}

/** `case:2` → 2; undefined for the other branch keys. */
function caseIndexOf(branchKey: string): number | undefined {
  const match = /^case:(\d+)$/.exec(branchKey);
  return match ? Number(match[1]) : undefined;
}

function branchLabel(owner: AutomationStepConfig | undefined, branchKey: string): string {
  if (branchKey === 'if_true') return 'True';
  if (branchKey === 'if_false') return 'False';
  if (branchKey === 'default') return 'Default';
  const caseIndex = caseIndexOf(branchKey);
  if (caseIndex === undefined) return branchKey;
  const sw = owner?.type === SWITCH_STEP_TYPE ? (owner as SwitchStepConfig) : undefined;
  return sw?.config.cases[caseIndex]?.label || `Case ${caseIndex + 1}`;
}

/**
 * Flattens the step tree into canvas items. Node ids are the step ids, so a
 * node keeps its identity (and its selection) when steps are reordered; the
 * current `path` rides along on each item.
 *
 * Every branch always renders something: its steps, or a dashed placeholder
 * that doubles as the "add step here" target. The root list ends in an
 * "add step" placeholder too.
 */
export function buildFlowItems(
  config: AutomationConfig,
  stepCatalog: StepCatalogItem[],
): FlowItem[] {
  const items: FlowItem[] = [];

  items.push({
    id: TRIGGER_NODE_ID,
    nodeType: 'trigger',
    path: [TRIGGER_NODE_ID],
    parentIds: [],
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  });

  function processSequence(
    steps: AutomationStepConfig[],
    parentIds: string[],
    container: ViewStepPath,
  ): string[] {
    let prev = parentIds;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const path: ViewStepPath = [...container, i];
      const id = step.id;
      const isControl = step.type === CONDITIONAL_STEP_TYPE || step.type === SWITCH_STEP_TYPE;
      if (!isControl) {
        const catalogItem = stepCatalog.find(c => c.type === step.type);
        items.push({
          id,
          nodeType: 'action',
          path,
          parentIds: prev,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          step,
          label: catalogItem?.name ?? step.type,
        });
        prev = [id];
        continue;
      }

      items.push({
        id,
        nodeType: step.type === CONDITIONAL_STEP_TYPE ? 'conditional' : 'switch',
        path,
        parentIds: prev,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        step,
      });

      const lasts: string[] = [];
      for (const branchKey of listBranchKeys(step)) {
        const branchPath: ViewStepPath = [...path, branchKey];
        const branch = getBranchSteps(step, branchKey);
        if (branch.length === 0) {
          const placeholderId = `empty:${id}:${branchKey}`;
          items.push({
            id: placeholderId,
            nodeType: 'placeholder',
            path: branchPath,
            parentIds: [id],
            width: NODE_WIDTH,
            height: PLACEHOLDER_HEIGHT,
            label: branchLabel(step, branchKey),
            insert: { container: branchPath, index: 0 },
          });
          lasts.push(placeholderId);
        } else {
          lasts.push(...processSequence(branch, [id], branchPath));
        }
      }

      const mergeId = `merge:${id}`;
      items.push({
        id: mergeId,
        nodeType: 'merge',
        path: [...path, 'merge'],
        parentIds: lasts,
        width: MERGE_SIZE,
        height: MERGE_SIZE,
      });
      prev = [mergeId];
    }
    return prev;
  }

  const lastRoot = processSequence(config.steps, [TRIGGER_NODE_ID], ROOT_CONTAINER);
  items.push({
    id: 'add:root',
    nodeType: 'placeholder',
    path: ROOT_CONTAINER,
    parentIds: lastRoot,
    width: NODE_WIDTH,
    height: PLACEHOLDER_HEIGHT,
    label: 'End',
    insert: { container: ROOT_CONTAINER, index: config.steps.length },
  });
  return items;
}

/**
 * Where a step inserted on the edge source → target lands. Undefined for edges
 * that touch a placeholder (the placeholder itself is the insert target).
 */
export function getEdgeInsertTarget(
  source: FlowItem,
  target: FlowItem,
): FlowInsertTarget | undefined {
  if (source.nodeType === 'placeholder' || target.nodeType === 'placeholder') return undefined;
  if (isStepItem(target)) {
    return {
      container: target.path.slice(0, -1),
      index: target.path[target.path.length - 1] as number,
    };
  }
  // Last node of a branch → merge: append to that branch.
  if (target.nodeType === 'merge') {
    return getInsertAfterTarget(source);
  }
  return undefined;
}

/** The slot right after `item` (the trigger's slot is the top of the flow). */
export function getInsertAfterTarget(item: FlowItem): FlowInsertTarget | undefined {
  if (item.nodeType === 'trigger') return { container: ROOT_CONTAINER, index: 0 };
  if (!isStepItem(item) && item.nodeType !== 'merge') return undefined;
  // A merge dot stands in for the control step that owns it.
  const stepPath = item.nodeType === 'merge' ? item.path.slice(0, -1) : item.path;
  return {
    container: stepPath.slice(0, -1),
    index: (stepPath[stepPath.length - 1] as number) + 1,
  };
}

export function getStepAtPath(
  config: AutomationConfig,
  path: ViewStepPath,
): AutomationStepConfig | undefined {
  if (path.length < 2) return undefined;
  return getContainerSteps(config, path.slice(0, -1))[path[path.length - 1] as number];
}

/** The step list of a container: `['root']` or `[...ownerStepPath, branchKey]`. */
export function getContainerSteps(
  config: AutomationConfig,
  container: ViewStepPath,
): AutomationStepConfig[] {
  if (container.length <= 1) return config.steps;
  const owner = getStepAtPath(config, container.slice(0, -1));
  return owner ? getBranchSteps(owner, String(container[container.length - 1])) : [];
}

/**
 * Applies `update` to the step list of one container: `['root']` for the main
 * list or `[...ownerStepPath, branchKey]` for a branch (`if_true`, `if_false`,
 * `case:n`, `default`). Returns `config` unchanged if the container is gone or
 * `update` returns the same list.
 */
function updateContainerAtPath(
  config: AutomationConfig,
  container: ViewStepPath,
  update: (steps: AutomationStepConfig[]) => AutomationStepConfig[],
): AutomationConfig {
  if (container.length <= 1) {
    const steps = update(config.steps);
    return steps === config.steps ? config : { ...config, steps };
  }
  const ownerPath = container.slice(0, -1);
  const branchKey = String(container[container.length - 1]);
  const owner = getStepAtPath(config, ownerPath);
  if (!owner || !listBranchKeys(owner).includes(branchKey)) return config;
  const branch = getBranchSteps(owner, branchKey);
  const steps = update(branch);
  if (steps === branch) return config;
  return updateStepAtPath(config, ownerPath, setBranchSteps(owner, branchKey, steps));
}

export function updateStepAtPath(
  config: AutomationConfig,
  path: ViewStepPath,
  next: AutomationStepConfig,
): AutomationConfig {
  if (path.length < 2) return config;
  const index = path[path.length - 1] as number;
  return updateContainerAtPath(config, path.slice(0, -1), steps => {
    const copy = steps.slice();
    copy[index] = next;
    return copy;
  });
}

export function removeStepAtPath(config: AutomationConfig, path: ViewStepPath): AutomationConfig {
  if (path.length < 2) return config;
  const index = path[path.length - 1] as number;
  return updateContainerAtPath(config, path.slice(0, -1), steps =>
    steps.filter((_, i) => i !== index),
  );
}

export function moveStepAtPath(
  config: AutomationConfig,
  path: ViewStepPath,
  direction: -1 | 1,
): AutomationConfig {
  if (path.length < 2) return config;
  const index = path[path.length - 1] as number;
  return updateContainerAtPath(config, path.slice(0, -1), steps =>
    moveStep(steps, index, direction),
  );
}

/**
 * Inserts `step` into a container at `index` (clamped; out of range appends).
 * `container` is `['root']` for the main list or `[...ownerStepPath, branchKey]`
 * for a branch (`if_true`, `if_false`, `case:n`, `default`).
 */
export function insertStepAtPath(
  config: AutomationConfig,
  container: ViewStepPath,
  index: number | undefined,
  step: AutomationStepConfig,
): AutomationConfig {
  return updateContainerAtPath(config, container, steps => {
    if (index === undefined || index < 0 || index > steps.length) return [...steps, step];
    return [...steps.slice(0, index), step, ...steps.slice(index)];
  });
}

/** The steps held by one branch of a control step. */
export function getBranchSteps(
  step: AutomationStepConfig,
  branchKey: string,
): AutomationStepConfig[] {
  if (step.type === CONDITIONAL_STEP_TYPE) {
    const conditional = step as ConditionalStepConfig;
    // Both branches are optional at runtime: a draft saved before validation can
    // omit them, which is why the list view guards if_true the same way.
    return branchKey === 'if_true'
      ? (conditional.config.if_true ?? [])
      : (conditional.config.if_false ?? []);
  }
  if (step.type === SWITCH_STEP_TYPE) {
    const sw = step as SwitchStepConfig;
    if (branchKey === 'default') return sw.config.default ?? [];
    const caseIndex = caseIndexOf(branchKey);
    if (caseIndex !== undefined) return sw.config.cases[caseIndex]?.steps ?? [];
  }
  return [];
}

function setBranchSteps(
  step: AutomationStepConfig,
  branchKey: string,
  next: AutomationStepConfig[],
): AutomationStepConfig {
  if (step.type === CONDITIONAL_STEP_TYPE) {
    const conditional = step as ConditionalStepConfig;
    return {
      ...conditional,
      config: {
        ...conditional.config,
        [branchKey === 'if_true' ? 'if_true' : 'if_false']: next,
      },
    };
  }
  if (step.type === SWITCH_STEP_TYPE) {
    const sw = step as SwitchStepConfig;
    if (branchKey === 'default') {
      return { ...sw, config: { ...sw.config, default: next } };
    }
    const caseIndex = caseIndexOf(branchKey);
    if (caseIndex !== undefined) {
      const cases = sw.config.cases.slice();
      const existing = cases[caseIndex];
      if (existing) cases[caseIndex] = { ...existing, steps: next };
      return { ...sw, config: { ...sw.config, cases } };
    }
  }
  return step;
}

/**
 * The validator's path for a step, as the List view builds it:
 * `['root', 1, 'case:0', 2]` → `steps[1].config.cases[0].steps[2]`.
 */
export function buildPathPrefix(path: ViewStepPath): string {
  if (path.length < 2) return '';
  let prefix = `steps[${path[1] as number}]`;
  for (let i = 2; i < path.length; i += 2) {
    const branchKey = String(path[i]);
    const index = path[i + 1] as number;
    const caseIndex = caseIndexOf(branchKey);
    prefix +=
      caseIndex === undefined
        ? `.config.${branchKey}[${index}]`
        : `.config.cases[${caseIndex}].steps[${index}]`;
  }
  return prefix;
}

/**
 * The executor's positional step-row name for a step path, e.g.
 * `['root', 1, 'case:0', 2]` → `step_1__case_0__step_2`. Mirrors `walkSteps` /
 * `walkNestedBranch` + `branchKeyToString` in apps/backend/src/automations/engine.
 */
export function stepNameForPath(path: ViewStepPath): string {
  if (path.length < 2) return '';
  const segments: string[] = [`step_${path[1] as number}`];
  for (let i = 2; i < path.length; i += 2) {
    const branchKey = String(path[i]).replace(/^case:/, 'case_');
    segments.push(`${branchKey}__step_${path[i + 1] as number}`);
  }
  return segments.join('__');
}

/**
 * Display number for a step, from its validation path prefix (`buildPathPrefix`):
 * `steps[1]` → `2`, `steps[1].config.if_true[0]` → `2.1`. Numbered per branch, so
 * the List cards and Flow nodes show the same number.
 */
export function stepNumberForPrefix(prefix: string): string {
  return Array.from(
    prefix.matchAll(/(?:steps|if_true|if_false|default)\[(\d+)\]/g),
    match => Number(match[1]) + 1,
  ).join('.');
}

/**
 * Run view: the canvas items the run got to, so the path it took can be drawn
 * and the rest faded. A step counts once it has a status; a branch placeholder
 * when its owner took that branch; a merge dot (and the End node) once
 * everything before it finished. Relies on `buildFlowItems` order (parents first).
 */
export function collectReachedIds(
  items: FlowItem[],
  overlay: Pick<FlowRunOverlay, 'statusByStepName' | 'takenBranchByStepName'>,
): Set<string> {
  const { statusByStepName, takenBranchByStepName } = overlay;
  const byId = new Map(items.map(item => [item.id, item]));
  const reached = new Set<string>();
  const finished = (item: FlowItem | undefined): boolean => {
    if (!item) return false;
    if (item.nodeType === 'trigger') return true;
    if (isStepItem(item)) return statusByStepName[stepNameForPath(item.path)] === 'COMPLETED';
    return reached.has(item.id);
  };
  for (const item of items) {
    let isReached: boolean;
    if (item.nodeType === 'trigger') {
      isReached = true;
    } else if (isStepItem(item)) {
      isReached = Boolean(statusByStepName[stepNameForPath(item.path)]);
    } else if (item.nodeType === 'merge') {
      isReached = finished(byId.get(item.id.slice('merge:'.length)));
    } else if (item.path.length > 1) {
      // Empty-branch placeholder: its path is the branch container.
      const ownerName = stepNameForPath(item.path.slice(0, -1));
      isReached = takenBranchByStepName[ownerName] === String(item.path[item.path.length - 1]);
    } else {
      // The root "End" node.
      isReached = item.parentIds.every(id => finished(byId.get(id)));
    }
    if (isReached) reached.add(item.id);
  }
  return reached;
}

/** Issues on the step at `path`, including those of steps nested in its branches. */
export function issuesUnderPath(
  all: ValidationIssue[] | undefined,
  path: ViewStepPath,
): ValidationIssue[] {
  const prefix = buildPathPrefix(path);
  return prefix ? issuesAtStep(all, prefix) : [];
}

// One nested-step hop: branch key (if_true/if_false/default) or case index, then the step index.
const NESTED_STEP_SEGMENT =
  /^\.config\.(?:(if_true|if_false|default)|cases\[(\d+)\]\.steps)\[(\d+)\]/;

/**
 * Of the issues under a step (`prefix` = its `buildPathPrefix`), the ones that
 * belong to the step itself — not to steps nested in its branches, which are
 * marked on their own card / node.
 */
export function ownStepIssues(under: ValidationIssue[], prefix: string): ValidationIssue[] {
  return under.filter(issue => !NESTED_STEP_SEGMENT.test(issue.path.slice(prefix.length)));
}

/**
 * Step ids from the outermost to the innermost step an issue path points into
 * (`steps[1].config.cases[0].steps[2].config.url` → [switch id, nested id]).
 * Empty for trigger/schedule issues or a path that no longer matches the config.
 */
export function stepIdsForIssuePath(steps: AutomationStepConfig[], path: string): string[] {
  const root = /^steps\[(\d+)\]/.exec(path);
  let step = root ? steps[Number(root[1])] : undefined;
  if (!root || !step) return [];
  const ids = [step.id];
  let rest = path.slice(root[0].length);
  for (let hop = NESTED_STEP_SEGMENT.exec(rest); hop; hop = NESTED_STEP_SEGMENT.exec(rest)) {
    const branchKey = hop[1] ?? `case:${hop[2]}`;
    step = getBranchSteps(step, branchKey)[Number(hop[3])];
    if (!step) break;
    ids.push(step.id);
    rest = rest.slice(hop[0].length);
  }
  return ids;
}

/**
 * Issues that belong to this node itself. For control steps this excludes
 * issues of the steps nested in its branches (those show on their own nodes).
 */
export function ownIssuesForItem(
  all: ValidationIssue[] | undefined,
  item: FlowItem,
): ValidationIssue[] {
  // The trigger node's panel also holds the schedule, so its issues are marked here too.
  if (item.nodeType === 'trigger') {
    return [...issuesUnder(all, 'trigger'), ...issuesUnder(all, 'schedule')];
  }
  if (!isStepItem(item)) return [];
  const under = issuesUnderPath(all, item.path);
  if (item.nodeType === 'action') return under;
  return ownStepIssues(under, buildPathPrefix(item.path));
}

export function buildVariableSourcesForPath(
  config: AutomationConfig,
  triggerSchema: TriggerSchema | null,
  stepSchemaCache: Record<string, StepSchema | undefined>,
  path: ViewStepPath,
  formFieldNameMap?: Map<string, string>,
): VariablePickerSource[] {
  // Everything before the branch-owning control step in the main list.
  const rootIndex = path.length < 2 ? 0 : (path[1] as number);
  const base = buildRootVariableSources(
    triggerSchema,
    config.trigger.config,
    config.steps,
    stepSchemaCache,
    rootIndex,
    formFieldNameMap,
  );
  if (path.length < 2) return base;

  // Walk into branches, collecting preceding steps at each level.
  let currentSteps = config.steps;
  let position = rootIndex;
  for (let i = 2; i < path.length; i += 2) {
    const branchKey = String(path[i]);
    const index = path[i + 1] as number;
    const owner = currentSteps[position];
    if (!owner) break;
    const branch = getBranchSteps(owner, branchKey);
    for (let j = 0; j < index; j++) {
      const step = branch[j];
      if (!step || step.type === CONDITIONAL_STEP_TYPE || step.type === SWITCH_STEP_TYPE) continue;
      const schema = stepSchemaCache[step.type];
      if (!schema) continue;
      // Same number the step's card and node show, e.g. "Step 2.1".
      const number = stepNumberForPrefix(buildPathPrefix([...path.slice(0, i + 1), j]));
      pushStepVariableSources(base, step as ActionStepConfig, schema, `Step ${number}`);
    }
    currentSteps = branch;
    position = index;
  }

  return base;
}

export function getEdgeLabel(source: FlowItem, target: FlowItem): string | undefined {
  if (source.nodeType !== 'conditional' && source.nodeType !== 'switch') return undefined;
  return branchLabel(source.step, String(target.path[source.path.length]));
}

/** Layout identity: only ids, edges and sizes, so editing a field never re-lays out. */
export function structureKey(items: FlowItem[]): string {
  return JSON.stringify(items.map(i => [i.id, i.parentIds, i.width, i.height]));
}
