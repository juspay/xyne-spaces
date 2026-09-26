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
  formatStepSourceLabel,
  pushStepVariableSources,
} from '../AutomationBuilder.utils';
import type { FlowInsertTarget, FlowItem, ViewStepPath } from './FlowAutomationView.types';

/** Analytics namespace for every data-track-* attribute the flow view renders. */
export const TRACK_CATEGORY = 'automation-builder-flow';

const TRIGGER_NODE_ID = 'trigger';
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
function listBranchKeys(step: AutomationStepConfig): string[] {
  if (step.type === CONDITIONAL_STEP_TYPE) return ['if_true', 'if_false'];
  if (step.type === SWITCH_STEP_TYPE) {
    const sw = step as SwitchStepConfig;
    return [...sw.config.cases.map((_, i) => `case:${i}`), 'default'];
  }
  return [];
}

function branchLabel(owner: AutomationStepConfig | undefined, branchKey: string): string {
  if (branchKey === 'if_true') return 'True';
  if (branchKey === 'if_false') return 'False';
  if (branchKey === 'default') return 'Default';
  const caseMatch = /^case:(\d+)$/.exec(branchKey);
  if (caseMatch) {
    const caseIndex = Number(caseMatch[1]);
    const sw = owner?.type === SWITCH_STEP_TYPE ? (owner as SwitchStepConfig) : undefined;
    return sw?.config.cases[caseIndex]?.label || `Case ${caseIndex + 1}`;
  }
  return branchKey;
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
        parentIds: lasts.length ? lasts : [id],
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
  if (target.nodeType === 'merge' && target.id !== `merge:${source.id}`) {
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
  const rootIndex = path[1] as number;
  let current: AutomationStepConfig | undefined = config.steps[rootIndex];
  for (let i = 2; i < path.length; i += 2) {
    if (!current) return undefined;
    const branchKey = String(path[i]);
    const index = path[i + 1] as number;
    const branch = getBranchSteps(current, branchKey);
    current = branch[index];
  }
  return current;
}

export function updateStepAtPath(
  config: AutomationConfig,
  path: ViewStepPath,
  next: AutomationStepConfig,
): AutomationConfig {
  if (path.length < 2) return config;
  const rootIndex = path[1] as number;
  if (path.length === 2) {
    const steps = config.steps.slice();
    steps[rootIndex] = next;
    return { ...config, steps };
  }
  const steps = config.steps.slice();
  steps[rootIndex] = updateNestedStep(steps[rootIndex]!, path.slice(2), next);
  return { ...config, steps };
}

function updateNestedStep(
  step: AutomationStepConfig,
  remaining: ViewStepPath,
  next: AutomationStepConfig,
): AutomationStepConfig {
  const branchKey = String(remaining[0]);
  const index = remaining[1] as number;
  if (remaining.length === 2) {
    const branch = getBranchSteps(step, branchKey).slice();
    branch[index] = next;
    return setBranchSteps(step, branchKey, branch);
  }
  const branch = getBranchSteps(step, branchKey).slice();
  branch[index] = updateNestedStep(branch[index]!, remaining.slice(2), next);
  return setBranchSteps(step, branchKey, branch);
}

export function removeStepAtPath(config: AutomationConfig, path: ViewStepPath): AutomationConfig {
  if (path.length < 2) return config;
  const rootIndex = path[1] as number;
  if (path.length === 2) {
    const steps = config.steps.filter((_, i) => i !== rootIndex);
    return { ...config, steps };
  }
  const steps = config.steps.slice();
  steps[rootIndex] = removeNestedStep(steps[rootIndex]!, path.slice(2));
  return { ...config, steps };
}

function removeNestedStep(
  step: AutomationStepConfig,
  remaining: ViewStepPath,
): AutomationStepConfig {
  const branchKey = String(remaining[0]);
  const index = remaining[1] as number;
  if (remaining.length === 2) {
    const branch = getBranchSteps(step, branchKey).filter((_, i) => i !== index);
    return setBranchSteps(step, branchKey, branch);
  }
  const branch = getBranchSteps(step, branchKey).slice();
  branch[index] = removeNestedStep(branch[index]!, remaining.slice(2));
  return setBranchSteps(step, branchKey, branch);
}

export function moveStepAtPath(
  config: AutomationConfig,
  path: ViewStepPath,
  direction: -1 | 1,
): AutomationConfig {
  if (path.length < 2) return config;
  const rootIndex = path[1] as number;
  if (path.length === 2) {
    const steps = config.steps.slice();
    const nextIndex = rootIndex + direction;
    if (nextIndex < 0 || nextIndex >= steps.length) return config;
    [steps[rootIndex], steps[nextIndex]] = [steps[nextIndex]!, steps[rootIndex]!];
    return { ...config, steps };
  }
  const steps = config.steps.slice();
  steps[rootIndex] = moveNestedStep(steps[rootIndex]!, path.slice(2), direction);
  return { ...config, steps };
}

function moveNestedStep(
  step: AutomationStepConfig,
  remaining: ViewStepPath,
  direction: -1 | 1,
): AutomationStepConfig {
  const branchKey = String(remaining[0]);
  const index = remaining[1] as number;
  if (remaining.length === 2) {
    const branch = getBranchSteps(step, branchKey).slice();
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= branch.length) return step;
    [branch[index], branch[nextIndex]] = [branch[nextIndex]!, branch[index]!];
    return setBranchSteps(step, branchKey, branch);
  }
  const branch = getBranchSteps(step, branchKey).slice();
  branch[index] = moveNestedStep(branch[index]!, remaining.slice(2), direction);
  return setBranchSteps(step, branchKey, branch);
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
  const insertInto = (steps: AutomationStepConfig[]): AutomationStepConfig[] => {
    if (index === undefined || index < 0 || index > steps.length) return [...steps, step];
    return [...steps.slice(0, index), step, ...steps.slice(index)];
  };
  if (container.length <= 1) return { ...config, steps: insertInto(config.steps) };
  const ownerPath = container.slice(0, -1);
  const branchKey = String(container[container.length - 1]);
  const owner = getStepAtPath(config, ownerPath);
  if (!owner || !listBranchKeys(owner).includes(branchKey)) return config;
  const next = setBranchSteps(owner, branchKey, insertInto(getBranchSteps(owner, branchKey)));
  return updateStepAtPath(config, ownerPath, next);
}

/** The steps held by one branch of a control step. */
function getBranchSteps(step: AutomationStepConfig, branchKey: string): AutomationStepConfig[] {
  if (step.type === CONDITIONAL_STEP_TYPE) {
    const conditional = step as ConditionalStepConfig;
    return branchKey === 'if_true'
      ? conditional.config.if_true
      : (conditional.config.if_false ?? []);
  }
  if (step.type === SWITCH_STEP_TYPE) {
    const sw = step as SwitchStepConfig;
    if (branchKey === 'default') return sw.config.default;
    const caseMatch = /^case:(\d+)$/.exec(branchKey);
    if (caseMatch) {
      const caseIndex = Number(caseMatch[1]);
      return sw.config.cases[caseIndex]?.steps ?? [];
    }
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
    const caseMatch = /^case:(\d+)$/.exec(branchKey);
    if (caseMatch) {
      const caseIndex = Number(caseMatch[1]);
      const cases = sw.config.cases.slice();
      const existing = cases[caseIndex];
      if (existing) {
        cases[caseIndex] = { ...existing, steps: next };
      }
      return { ...sw, config: { ...sw.config, cases } };
    }
  }
  return step;
}

export function buildPathPrefix(path: ViewStepPath): string {
  if (path.length < 2) return '';
  const rootIndex = path[1] as number;
  if (path.length === 2) return `steps[${rootIndex}]`;
  const segments: string[] = [`steps[${rootIndex}]`];
  for (let i = 2; i < path.length; i += 2) {
    const branchKey = String(path[i]);
    const index = path[i + 1] as number;
    if (branchKey === 'if_true' || branchKey === 'if_false') {
      segments.push(`config.${branchKey}[${index}]`);
    } else if (branchKey === 'default') {
      segments.push(`config.default[${index}]`);
    } else if (/^case:\d+$/.test(branchKey)) {
      const caseIndex = Number(branchKey.split(':')[1]);
      segments.push(`config.cases[${caseIndex}].steps[${index}]`);
    }
  }
  return segments.join('.');
}

export function issuesUnderPath(
  all: ValidationIssue[] | undefined,
  path: ViewStepPath,
  nodeType: FlowItem['nodeType'],
): ValidationIssue[] {
  if (!all) return [];
  const prefix = buildPathPrefix(path);
  if (!prefix) {
    if (nodeType === 'trigger') return all.filter(i => i.path === 'trigger.config');
    return [];
  }
  if (nodeType === 'action') {
    return all.filter(i => i.path.startsWith(`${prefix}.config.`));
  }
  // `steps[1]` must not also match `steps[10]`.
  return all.filter(i => i.path === prefix || i.path.startsWith(`${prefix}.`));
}

const NESTED_STEP_SEGMENT = /^\.config\.(if_true|if_false|default|cases\[\d+\]\.steps)\[\d+\]/;

/**
 * Issues that belong to this node itself. For control steps this excludes
 * issues of the steps nested in its branches (those show on their own nodes).
 */
export function ownIssuesForItem(
  all: ValidationIssue[] | undefined,
  item: FlowItem,
): ValidationIssue[] {
  if (!all) return [];
  if (item.nodeType === 'trigger') return issuesUnderPath(all, item.path, 'trigger');
  if (!isStepItem(item)) return [];
  const prefix = buildPathPrefix(item.path);
  const under = issuesUnderPath(all, item.path, item.nodeType);
  if (item.nodeType === 'action') return under;
  return under.filter(issue => {
    return !NESTED_STEP_SEGMENT.test(issue.path.slice(prefix.length));
  });
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
  const trail: string[] = [];
  for (let i = 2; i < path.length; i += 2) {
    const branchKey = String(path[i]);
    const index = path[i + 1] as number;
    const owner = currentSteps[position];
    if (!owner) break;
    trail.push(branchLabel(owner, branchKey));
    const branch = getBranchSteps(owner, branchKey);
    for (let j = 0; j < index; j++) {
      const step = branch[j];
      if (!step || step.type === CONDITIONAL_STEP_TYPE || step.type === SWITCH_STEP_TYPE) continue;
      const schema = stepSchemaCache[step.type];
      if (!schema) continue;
      pushStepVariableSources(
        base,
        step as ActionStepConfig,
        schema,
        formatStepSourceLabel(j + 1, trail),
      );
    }
    currentSteps = branch;
    position = index;
  }

  return base;
}

export function getContainerInfo(
  config: AutomationConfig,
  path: ViewStepPath,
): { steps: AutomationStepConfig[]; index: number } | undefined {
  if (path.length < 2) return undefined;
  const rootIndex = path[1] as number;
  if (path.length === 2) {
    return { steps: config.steps, index: rootIndex };
  }
  const ownerPath = path.slice(0, -2);
  const owner = getStepAtPath(config, ownerPath);
  if (!owner) return undefined;
  const leafBranchKey = String(path[path.length - 2]);
  const leafIndex = path[path.length - 1] as number;
  return { steps: getBranchSteps(owner, leafBranchKey), index: leafIndex };
}

/** Human description of a container, e.g. "the True branch" or "the main flow". */
export function describeContainer(config: AutomationConfig, container: ViewStepPath): string {
  if (container.length <= 1) return 'the main flow';
  const owner = getStepAtPath(config, container.slice(0, -1));
  return `the ${branchLabel(owner, String(container[container.length - 1]))} branch`;
}

export function getEdgeLabel(source: FlowItem, target: FlowItem): string | undefined {
  if (source.nodeType !== 'conditional' && source.nodeType !== 'switch') return undefined;
  // A control step with no branch steps links straight to its own merge dot.
  if (target.nodeType === 'merge') return undefined;
  return branchLabel(source.step, String(target.path[source.path.length]));
}

/** Layout identity: only ids, edges and sizes, so editing a field never re-lays out. */
export function structureKey(items: FlowItem[]): string {
  return JSON.stringify(items.map(i => [i.id, i.parentIds, i.width, i.height]));
}
