import {
  CONDITIONAL_STEP_TYPE,
  SWITCH_STEP_TYPE,
  makeStepId,
  type ActionStepConfig,
  type AutomationConfig,
  type AutomationStepConfig,
  type ConditionalStepConfig,
  type JsonSchema,
  type StepCatalogItem,
  type StepSchema,
  type SwitchStepConfig,
  type TriggerSchema,
  type ValidationIssue,
} from '../../Automation.types';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import {
  buildVariableSources as buildRootVariableSources,
  formatStepSourceLabel,
  pushStepVariableSources,
} from '../AutomationBuilder.utils';
import type { FlowInsertTarget, FlowItem, ViewStepPath } from './FlowAutomationView.types';

export const TRIGGER_NODE_ID = 'trigger';
export const ROOT_CONTAINER: ViewStepPath = ['root'];
export const NODE_WIDTH = 248;
// Fixed heights: every text line inside a node is single-line + truncated, so
// these are guaranteed to fit the content (see FlowAutomationView nodes).
export const TRIGGER_HEIGHT = 96;
export const ACTION_HEIGHT = 112;
export const CONTROL_HEIGHT = 112;
export const PLACEHOLDER_HEIGHT = 44;
export const MERGE_SIZE = 12;

export function isStepItem(item: FlowItem): boolean {
  return (
    item.nodeType === 'action' || item.nodeType === 'conditional' || item.nodeType === 'switch'
  );
}

/** Counts a step plus every step nested inside its branches. */
export function countSteps(step: AutomationStepConfig): number {
  return (
    1 +
    listBranchKeys(step).reduce(
      (sum, key) => sum + getBranchSteps(step, key).reduce((s, child) => s + countSteps(child), 0),
      0,
    )
  );
}

/** Branch keys of a control step, in display order. */
export function listBranchKeys(step: AutomationStepConfig): string[] {
  if (step.type === CONDITIONAL_STEP_TYPE) return ['if_true', 'if_false'];
  if (step.type === SWITCH_STEP_TYPE) {
    const sw = step as SwitchStepConfig;
    return [...sw.config.cases.map((_, i) => `case:${i}`), 'default'];
  }
  return [];
}

export function branchLabel(owner: AutomationStepConfig | undefined, branchKey: string): string {
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

export interface BuildFlowItemsOptions {
  /** Control-step ids whose branches are collapsed on the canvas. */
  collapsed?: ReadonlySet<string>;
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
  options: BuildFlowItemsOptions = {},
): FlowItem[] {
  const items: FlowItem[] = [];
  const collapsed = options.collapsed;

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
    container: ViewStepPath,
    numberPrefix: string,
  ): string[] {
    let prev = parentIds;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const path: ViewStepPath = [...container, i];
      const id = step.id;
      const stepNumber = numberPrefix ? `${numberPrefix}.${i + 1}` : `${i + 1}`;
      const isControl = step.type === CONDITIONAL_STEP_TYPE || step.type === SWITCH_STEP_TYPE;
      if (!isControl) {
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
          stepNumber,
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
        height: CONTROL_HEIGHT,
        step,
        stepNumber,
      });

      const lasts: string[] = [];
      if (!collapsed?.has(id)) {
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
            lasts.push(...processSequence(branch, [id], branchPath, stepNumber));
          }
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

  const lastRoot = processSequence(config.steps, [TRIGGER_NODE_ID], ROOT_CONTAINER, '');
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
  // Last node of a branch → merge: append to that branch. A collapsed control
  // links straight to its own merge dot, which has no slot to insert into.
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

/** True when `path` sits strictly inside the step at `ancestor` (e.g. in one of its branches). */
export function isDescendantPath(ancestor: ViewStepPath, path: ViewStepPath): boolean {
  return path.length > ancestor.length && ancestor.every((segment, i) => path[i] === segment);
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
    current = branch[index];
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

export function removeStepAtPath(config: AutomationConfig, path: ViewStepPath): AutomationConfig {
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

/** Deep copy with fresh ids for the step and everything nested in it. */
export function cloneStepWithNewIds(step: AutomationStepConfig): AutomationStepConfig {
  let copy: AutomationStepConfig = { ...step, id: makeStepId() };
  for (const key of listBranchKeys(step)) {
    copy = setBranchSteps(copy, key, getBranchSteps(step, key).map(cloneStepWithNewIds));
  }
  return copy;
}

export function getBranchSteps(
  step: AutomationStepConfig,
  branchKey: string,
): AutomationStepConfig[] {
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

export function setBranchSteps(
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
    const rest = issue.path.slice(prefix.length);
    // `steps[1]` must not also match `steps[10]`.
    if (rest && !rest.startsWith('.')) return false;
    return !NESTED_STEP_SEGMENT.test(rest);
  });
}

/** The deepest item whose validation prefix owns `issuePath`. */
export function findItemForIssuePath(items: FlowItem[], issuePath: string): FlowItem | undefined {
  if (issuePath.startsWith('trigger')) return items.find(i => i.nodeType === 'trigger');
  let best: FlowItem | undefined;
  let bestLength = -1;
  for (const item of items) {
    if (!isStepItem(item)) continue;
    const prefix = buildPathPrefix(item.path);
    const matches =
      issuePath === prefix ||
      issuePath.startsWith(`${prefix}.`) ||
      issuePath.startsWith(`${prefix}[`);
    if (matches && prefix.length > bestLength) {
      best = item;
      bestLength = prefix.length;
    }
  }
  return best;
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
    pushStepVariableSources(base, step as ActionStepConfig, schema, formatStepSourceLabel(i + 1));
  }

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
): { steps: AutomationStepConfig[]; index: number; ownerPath?: ViewStepPath } | undefined {
  if (path[0] === TRIGGER_NODE_ID || path.length < 2) return undefined;
  const rootIndex = path[1] as number;
  if (path.length === 2) {
    return { steps: config.steps, index: rootIndex };
  }
  const ownerPath = path.slice(0, -2);
  const owner = getStepAtPath(config, ownerPath);
  if (!owner) return undefined;
  const leafBranchKey = String(path[path.length - 2]);
  const leafIndex = path[path.length - 1] as number;
  return {
    steps: getBranchSteps(owner, leafBranchKey),
    index: leafIndex,
    ownerPath,
  };
}

/** Human description of a container, e.g. "the True branch" or "the main flow". */
export function describeContainer(config: AutomationConfig, container: ViewStepPath): string {
  if (container.length <= 1) return 'the main flow';
  const owner = getStepAtPath(config, container.slice(0, -1));
  return `the ${branchLabel(owner, String(container[container.length - 1]))} branch`;
}

export function getEdgeLabel(source: FlowItem, target: FlowItem): string | undefined {
  if (source.nodeType !== 'conditional' && source.nodeType !== 'switch') return undefined;
  // Collapsed control step: the edge goes straight to its merge dot.
  if (target.nodeType === 'merge') return undefined;
  return branchLabel(source.step, String(target.path[source.path.length]));
}

/** Fields shown for a step or trigger type with no entry in the maps below. */
const DEFAULT_SUMMARY_KEYS = [
  'to',
  'recipient',
  'recipients',
  'email',
  'templateId',
  'template',
  'agentSlug',
  'agentId',
  'agent',
  'boardId',
  'board',
  'channelId',
  'delay',
  'duration',
  'url',
  'title',
  'subject',
  'message',
  'prompt',
];

/**
 * Fields each step type may show on its canvas node, in priority order. Only
 * listed fields are ever displayed: a new config field stays off the canvas (and
 * out of tooltips and search) until someone adds it here. Names must match the
 * step's backend ConfigSchema (`apps/backend/src/automations/steps/*.step.ts`);
 * `findUnknownSummaryKeys` flags drift in development.
 */
const SUMMARY_KEYS_BY_TYPE: Record<string, string[]> = {
  APPLY_CONVERSATION_LABEL: ['labelName'],
  ARCHIVE_TICKET: ['archived'],
  ASSIGN_TICKET: ['assigneeId'],
  ASSIGN_TICKET_TO_GROUP: ['groupId'],
  CHANGE_STAGE: ['stageName'],
  // Only a ticket reference, which reads as noise on the node.
  CLOSE_TICKET: [],
  CREATE_EMAIL_DRAFT: ['draftContent'],
  CREATE_SUB_TICKET: ['title'],
  CREATE_TICKET: ['title', 'boardId'],
  DELAY: ['amount', 'unit', 'businessHoursOnly'],
  MAKE_CALL: ['channelId', 'invitedUserIds', 'userGroupIds'],
  NOTIFY_GROUP: ['title', 'message'],
  NOTIFY_USER: ['title', 'message'],
  NOTIFY_USER_SOS: ['title', 'message'],
  PROMOTE_MESSAGE_TO_TICKET: ['title', 'boardId'],
  REPLY_ON_MESSAGE: ['content'],
  RUN_AGENT: ['agentSlug', 'prompt'],
  SEND_CSAT_REQUEST: ['question'],
  SEND_EMAIL_REPLY: ['body'],
  SEND_EMAIL_TO_USER: ['subject'],
  SEND_MESSAGE: ['content', 'channelId', 'userIds'],
  TRIGGER_WEBHOOK: ['url'],
  UPDATE_FORM_FIELDS: ['fields'],
  UPDATE_TAGS: ['tags'],
  UPDATE_TICKET: ['status', 'stageName', 'priority', 'title'],
};

/**
 * Trigger filters shown on the trigger node. Empty means "matches everything",
 * which the node renders as "No filters". WEBHOOK's config is a body/header
 * schema, not a filter, and its endpoint is shown beside the canvas instead.
 */
const TRIGGER_SUMMARY_KEYS_BY_TYPE: Record<string, string[]> = {
  CALL_EVENT: ['callEventType', 'channelIds', 'participantUserIds'],
  EMAIL_RECEIVED: ['subjectContains', 'fromEmails', 'fromDomains', 'channelIds'],
  EMAIL_SENT: ['subjectContains', 'toEmails', 'toDomains', 'channelIds'],
  MESSAGE_RECEIVED: ['contentContains', 'channelIds', 'fromUserIds'],
  TAG_GENERATED: ['categories', 'channelIds'],
  TICKET_COMMENTED: ['contentContains', 'boardIds', 'projectIds', 'channelIds'],
  TICKET_CREATED: ['boardIds', 'projectIds', 'channelIds'],
  TICKET_UPDATED: ['boardIds', 'projectIds', 'channelIds'],
  WEBHOOK: [],
};

/**
 * Types whose summary reads several fields together. DELAY's `amount` and
 * `unit` are sibling keys, so the per-field loop can't produce "2 hours".
 */
const SUMMARY_FORMATTERS: Record<string, (config: Record<string, unknown>) => string | undefined> =
  {
    DELAY: config => {
      const amount = formatSummaryValue(config['amount']);
      if (!amount) return undefined;
      const unit = typeof config['unit'] === 'string' ? config['unit'] : 'seconds';
      const shownUnit = config['amount'] === 1 ? unit.replace(/s$/, '') : unit;
      const businessHours = config['businessHoursOnly'] === true ? ' (business hours)' : '';
      return `wait: ${amount} ${shownUnit}${businessHours}`;
    },
    UPDATE_FORM_FIELDS: config => {
      const fields = Array.isArray(config['fields']) ? (config['fields'] as unknown[]) : [];
      const names = fields
        .map(field =>
          field && typeof field === 'object'
            ? formatSummaryValue((field as Record<string, unknown>)['fieldName'])
            : undefined,
        )
        .filter((name): name is string => Boolean(name));
      return names.length ? `fields: ${names.join(', ')}` : undefined;
    },
  };

function summaryKeysFor(type: string): string[] {
  return SUMMARY_KEYS_BY_TYPE[type] ?? TRIGGER_SUMMARY_KEYS_BY_TYPE[type] ?? DEFAULT_SUMMARY_KEYS;
}

/**
 * Allow-listed summary keys for `type` that its config schema doesn't declare.
 * Returns `[]` for unlisted types or schemas without top-level properties.
 */
export function findUnknownSummaryKeys(
  type: string,
  configSchema: JsonSchema | undefined,
): string[] {
  const properties = configSchema?.properties;
  const listed = SUMMARY_KEYS_BY_TYPE[type] ?? TRIGGER_SUMMARY_KEYS_BY_TYPE[type];
  if (!properties || !listed) return [];
  return listed.filter(key => !(key in properties));
}

const SENSITIVE_KEY = /secret|token|password|auth|apiKey/i;
const ENCRYPTED_PREFIX = 'enc:';
const REDACTED = '••••••';

function shortenRefs(value: string): string {
  return value.replace(/\{\{\s*context\.([^}]+?)\s*\}\}/g, (_match, ref: string) => {
    const segments = ref.split('.').filter(s => s !== 'output' && s !== 'input');
    return `{${segments.slice(-2).join('.')}}`;
  });
}

const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;
const HTML_ENTITIES = new Map([
  ['&nbsp;', ' '],
  ['&amp;', '&'],
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&#39;', "'"],
]);

/**
 * Rich-text fields (`content`, `body`, `draftContent`) are stored as editor
 * HTML. Reduce them to their visible text; tag-only markup such as `<p></p>`
 * becomes empty so the node reads "Not configured yet".
 */
function toPlainText(value: string): string {
  if (!value.includes('<') && !value.includes('&')) return value.trim();
  return value
    .replace(HTML_TAG, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, entity => HTML_ENTITIES.get(entity) ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
}

function formatSummaryValue(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'string') {
    if (value.startsWith(ENCRYPTED_PREFIX)) return REDACTED;
    return shortenRefs(toPlainText(value)) || undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(formatSummaryValue).filter((v): v is string => Boolean(v));
    return parts.length ? parts.join(', ') : undefined;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const inner = obj['label'] ?? obj['name'] ?? obj['value'] ?? obj['id'];
    if (inner !== undefined) return formatSummaryValue(inner);
    if (typeof obj['amount'] === 'number' && typeof obj['unit'] === 'string')
      return `${obj['amount']} ${obj['unit']}`;
  }
  return undefined;
}

/**
 * Fields holding entity ids (channels, boards, users, groups). The node has no
 * name lookup for them, and a raw id means nothing to the reader, so they show
 * as a count ("channels: 2 selected"). A `{{…}}` variable is shown as the
 * variable, since that is what the author typed.
 */
const ID_KEY_LABELS: Record<string, string> = {
  assigneeId: 'assignee',
  boardId: 'board',
  boardIds: 'boards',
  channelId: 'channel',
  channelIds: 'channels',
  fromUserIds: 'senders',
  groupId: 'group',
  invitedUserIds: 'invitees',
  participantUserIds: 'participants',
  projectIds: 'projects',
  userGroupIds: 'user groups',
  userIds: 'users',
};

function formatIdSelection(value: unknown): string | undefined {
  const values = (Array.isArray(value) ? value : [value]).filter(
    (v): v is string => typeof v === 'string' && v.trim() !== '',
  );
  if (!values.length) return undefined;
  const refs = values.filter(v => v.includes('{{')).map(v => shortenRefs(v.trim()));
  if (refs.length === values.length) return refs.join(', ');
  return `${values.length} selected`;
}

function humanizeKey(key: string): string {
  return key
    .replace(/Id$|Slug$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
}

/**
 * One-line summary of a step's config for its canvas node, built only from the
 * fields allow-listed for its type. Sensitive-looking or encrypted values are
 * redacted even when allow-listed. `undefined` renders as "Not configured yet".
 */
export function summarizeStepConfig(
  stepType: string,
  config: Record<string, unknown> | undefined,
): string | undefined {
  if (!config) return undefined;
  const formatter = SUMMARY_FORMATTERS[stepType];
  if (formatter) return formatter(config);
  const keys = summaryKeysFor(stepType);
  for (const key of keys) {
    const idLabel = ID_KEY_LABELS[key];
    if (idLabel) {
      const formatted = formatIdSelection(config[key]);
      if (formatted) return `${idLabel}: ${formatted}`;
      continue;
    }
    const formatted = formatSummaryValue(config[key]);
    if (!formatted) continue;
    return `${humanizeKey(key)}: ${SENSITIVE_KEY.test(key) ? REDACTED : formatted}`;
  }
  return undefined;
}

/** Stable key for everything the layout depends on (ids, edges, sizes). */
export function structureKey(items: FlowItem[]): string {
  return JSON.stringify(items.map(i => [i.id, i.parentIds, i.width, i.height]));
}
