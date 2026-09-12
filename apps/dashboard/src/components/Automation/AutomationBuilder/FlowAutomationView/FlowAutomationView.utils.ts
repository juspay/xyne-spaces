import {
  CONDITIONAL_STEP_TYPE,
  SWITCH_STEP_TYPE,
  type ActionStepConfig,
  type AutomationConfig,
  type AutomationStepConfig,
  type ConditionalStepConfig,
  type StepCatalogItem,
  type StepSchema,
  type SwitchStepConfig,
  type TriggerSchema,
  type ValidationIssue,
} from '../../Automation.types';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import { buildVariableSources as buildRootVariableSources } from '../AutomationBuilder.utils';
import type { FlowItem, ViewStepPath } from './FlowAutomationView.types';

export const TRIGGER_NODE_ID = 'trigger';
const NODE_WIDTH = 232;
const TRIGGER_HEIGHT = 108;
const ACTION_HEIGHT = 124;
const CONTROL_HEIGHT = 104;
const MERGE_SIZE = 16;

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
    height: TRIGGER_HEIGHT,
  });

  function processSequence(
    steps: AutomationStepConfig[],
    parentIds: string[],
    prefix: ViewStepPath,
  ): string[] {
    let prev = parentIds;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const path: ViewStepPath = [...prefix, i];
      const id = path.join(':');
      if (step.type === CONDITIONAL_STEP_TYPE) {
        const conditional = step as ConditionalStepConfig;
        items.push({
          id,
          nodeType: 'conditional',
          path,
          parentIds: prev,
          width: NODE_WIDTH,
          height: CONTROL_HEIGHT,
          step: conditional,
        });
        const trueLast = processSequence(conditional.config.if_true ?? [], [id], [...path, 'if_true']);
        const falseLast = processSequence(
          conditional.config.if_false ?? [],
          [id],
          [...path, 'if_false'],
        );
        const mergeId = `merge:${id}`;
        const mergeParents = trueLast.length || falseLast.length ? [...trueLast, ...falseLast] : [id];
        items.push({
          id: mergeId,
          nodeType: 'merge',
          path: [...path, 'merge'],
          parentIds: mergeParents,
          width: MERGE_SIZE,
          height: MERGE_SIZE,
        });
        prev = [mergeId];
      } else if (step.type === SWITCH_STEP_TYPE) {
        const sw = step as SwitchStepConfig;
        items.push({
          id,
          nodeType: 'switch',
          path,
          parentIds: prev,
          width: NODE_WIDTH,
          height: CONTROL_HEIGHT,
          step: sw,
        });
        const branchLasts: string[] = [];
        sw.config.cases.forEach((caseEntry, caseIndex) => {
          const lasts = processSequence(caseEntry.steps, [id], [...path, `case:${caseIndex}`]);
          branchLasts.push(...lasts);
        });
        const defaultLasts = processSequence(sw.config.default, [id], [...path, 'default']);
        branchLasts.push(...defaultLasts);
        const mergeId = `merge:${id}`;
        const mergeParents = branchLasts.length ? branchLasts : [id];
        items.push({
          id: mergeId,
          nodeType: 'merge',
          path: [...path, 'merge'],
          parentIds: mergeParents,
          width: MERGE_SIZE,
          height: MERGE_SIZE,
        });
        prev = [mergeId];
      } else {
        const catalogItem = stepCatalog.find(c => c.type === step.type);
        items.push({
          id,
          nodeType: 'action',
          path,
          parentIds: prev,
          width: NODE_WIDTH,
          height: ACTION_HEIGHT,
          step,
          label: catalogItem?.name ?? step.type,
        });
        prev = [id];
      }
    }
    return prev;
  }

  processSequence(config.steps, [TRIGGER_NODE_ID], ['root']);
  return items;
}

export function getStepAtPath(
  config: AutomationConfig,
  path: ViewStepPath,
): AutomationStepConfig | undefined {
  if (path[0] === TRIGGER_NODE_ID || path.length < 2) return undefined;
  const rootIndex = path[1] as number;
  let current: AutomationStepConfig | undefined = config.steps[rootIndex];
  for (let i = 2; i < path.length; i += 2) {
    if (!current) return undefined;
    const branchKey = String(path[i]);
    const index = path[i + 1] as number;
    const branch = getBranchSteps(current, branchKey);
    current = branch?.[index];
  }
  return current;
}

export function updateStepAtPath(
  config: AutomationConfig,
  path: ViewStepPath,
  next: AutomationStepConfig,
): AutomationConfig {
  if (path[0] === TRIGGER_NODE_ID || path.length < 2) return config;
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

export function removeStepAtPath(
  config: AutomationConfig,
  path: ViewStepPath,
): AutomationConfig {
  if (path[0] === TRIGGER_NODE_ID || path.length < 2) return config;
  const rootIndex = path[1] as number;
  if (path.length === 2) {
    const steps = config.steps.filter((_, i) => i !== rootIndex);
    return { ...config, steps };
  }
  const steps = config.steps.slice();
  steps[rootIndex] = removeNestedStep(steps[rootIndex]!, path.slice(2));
  return { ...config, steps };
}

function removeNestedStep(step: AutomationStepConfig, remaining: ViewStepPath): AutomationStepConfig {
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
  if (path[0] === TRIGGER_NODE_ID || path.length < 2) return config;
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

function getBranchSteps(step: AutomationStepConfig, branchKey: string): AutomationStepConfig[] {
  if (step.type === CONDITIONAL_STEP_TYPE) {
    const conditional = step as ConditionalStepConfig;
    return branchKey === 'if_true'
      ? conditional.config.if_true
      : conditional.config.if_false ?? [];
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
  if (path[0] === TRIGGER_NODE_ID || path.length < 2) return '';
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
  return all.filter(i => i.path.startsWith(prefix));
}

export function buildVariableSourcesForPath(
  config: AutomationConfig,
  triggerSchema: TriggerSchema | null,
  stepSchemaCache: Record<string, StepSchema | undefined>,
  path: ViewStepPath,
  formFieldNameMap?: Map<string, string>,
): VariablePickerSource[] {
  const base = buildRootVariableSources(
    triggerSchema,
    config.trigger.config,
    config.steps,
    stepSchemaCache,
    0,
    formFieldNameMap,
  );

  if (path[0] === TRIGGER_NODE_ID || path.length < 2) return base;
  const rootIndex = path[1] as number;

  // Steps in the main list before the branch-owning control step.
  for (let i = 0; i < rootIndex; i++) {
    const step = config.steps[i];
    if (!step || step.type === CONDITIONAL_STEP_TYPE || step.type === SWITCH_STEP_TYPE) continue;
    const schema = stepSchemaCache[step.type];
    if (!schema) continue;
    pushStepSources(base, step as ActionStepConfig, schema, i + 1);
  }

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
      pushStepSources(base, step as ActionStepConfig, schema, j + 1);
    }
    currentSteps = branch;
    position = index;
  }

  return base;
}

function pushStepSources(
  sources: VariablePickerSource[],
  step: ActionStepConfig,
  schema: StepSchema,
  displayIndex: number,
): void {
  const groupLabel = `Step ${displayIndex} — ${schema.name}`;
  sources.push({
    sourceKey: step.id,
    role: 'input',
    label: `Step ${displayIndex} input`,
    sublabel: schema.name,
    groupKey: step.id,
    groupLabel,
    schema: schema.configSchema,
  });
  sources.push({
    sourceKey: step.id,
    role: 'output',
    label: `Step ${displayIndex} output`,
    sublabel: schema.name,
    groupKey: step.id,
    groupLabel,
    schema: schema.outputSchema,
  });
}

export function getContainerInfo(
  config: AutomationConfig,
  path: ViewStepPath,
): { steps: AutomationStepConfig[]; index: number; ownerPath?: ViewStepPath } | undefined {
  if (path[0] === TRIGGER_NODE_ID || path.length < 2) return undefined;
  const rootIndex = path[1] as number;
  if (path.length === 2) {
    return { steps: config.steps, index: rootIndex };
  }
  const ownerPath: ViewStepPath = ['root', rootIndex];
  let current = config.steps[rootIndex];
  for (let i = 2; i < path.length - 2; i += 2) {
    const branchKey = String(path[i]);
    const index = path[i + 1] as number;
    ownerPath.push(branchKey, index);
    current = getBranchSteps(current!, branchKey)[index];
  }
  const leafBranchKey = String(path[path.length - 2]);
  const leafIndex = path[path.length - 1] as number;
  return {
    steps: getBranchSteps(current!, leafBranchKey),
    index: leafIndex,
    ownerPath,
  };
}

export function getEdgeLabel(source: FlowItem, target: FlowItem): string | undefined {
  if (source.nodeType === 'conditional') {
    const branchKey = String(target.path[source.path.length]);
    if (branchKey === 'if_true') return 'True';
    if (branchKey === 'if_false') return 'False';
  }
  if (source.nodeType === 'switch') {
    const branchKey = String(target.path[source.path.length]);
    if (branchKey === 'default') return 'Default';
    const caseMatch = /^case:(\d+)$/.exec(branchKey);
    if (caseMatch) {
      const sw = source.step as SwitchStepConfig | undefined;
      const caseEntry = sw?.config.cases[Number(caseMatch[1])];
      return caseEntry?.label || `Case ${Number(caseMatch[1]) + 1}`;
    }
  }
  return undefined;
}
