/**
 * Pure, targeted edits to an AutomationConfig step tree. Steps nest: CONDITIONAL
 * holds if_true/if_false, SWITCH holds cases[].steps and default.
 */
import { ControlFlowStepType } from '../types/known-types';
import type {
  AutomationConfig,
  AutomationStepConfig,
  Condition,
  ConditionalStepConfig,
  SwitchStepConfig,
} from '../types/automation-config';

/** Which list inside a control-flow step an add/move targets. */
export type StepBranch = 'if_true' | 'if_false' | 'default' | { caseIndex: number };

export type ConfigOperation =
  | {
      op: 'add-step';
      step: AutomationStepConfig;
      /** Omit to append at the top level. */
      parentId?: string;
      /** Which branch of the parent control-flow step. */
      branch?: StepBranch;
      /** Insert position within the target list; appends when omitted. */
      index?: number;
    }
  | { op: 'update-step'; stepId: string; config?: Record<string, unknown>; replace?: boolean }
  | { op: 'delete-step'; stepId: string }
  | {
      op: 'move-step';
      stepId: string;
      parentId?: string;
      branch?: StepBranch;
      index?: number;
    }
  | { op: 'set-condition'; stepId: string; condition: Condition }
  | { op: 'set-case-condition'; stepId: string; caseIndex: number; condition: Condition }
  | { op: 'set-trigger'; trigger: { type: string; config?: Record<string, unknown> } }
  | { op: 'set-schedule'; schedule: AutomationConfig['schedule'] | null };

export class ConfigOpError extends Error {}

function isConditional(step: AutomationStepConfig): step is ConditionalStepConfig {
  return step.type === ControlFlowStepType.CONDITIONAL;
}

function isSwitch(step: AutomationStepConfig): step is SwitchStepConfig {
  return step.type === ControlFlowStepType.SWITCH;
}

/** Every step list in the tree, parents before children. */
function allStepLists(config: AutomationConfig): AutomationStepConfig[][] {
  const lists: AutomationStepConfig[][] = [config.steps];
  const walk = (steps: AutomationStepConfig[]): void => {
    for (const step of steps) {
      if (isConditional(step)) {
        lists.push(step.config.if_true);
        walk(step.config.if_true);
        if (step.config.if_false) {
          lists.push(step.config.if_false);
          walk(step.config.if_false);
        }
      } else if (isSwitch(step)) {
        for (const entry of step.config.cases) {
          lists.push(entry.steps);
          walk(entry.steps);
        }
        lists.push(step.config.default);
        walk(step.config.default);
      }
    }
  };
  walk(config.steps);
  return lists;
}

function findStep(
  config: AutomationConfig,
  stepId: string,
): { list: AutomationStepConfig[]; index: number; step: AutomationStepConfig } | null {
  for (const list of allStepLists(config)) {
    const index = list.findIndex(s => s.id === stepId);
    if (index !== -1) return { list, index, step: list[index]! };
  }
  return null;
}

function collectIds(config: AutomationConfig): Set<string> {
  const ids = new Set<string>();
  for (const list of allStepLists(config)) for (const s of list) ids.add(s.id);
  return ids;
}

/** Resolve the step list an add/move targets. */
function resolveTargetList(
  config: AutomationConfig,
  parentId: string | undefined,
  branch: StepBranch | undefined,
): AutomationStepConfig[] {
  if (!parentId) return config.steps;

  const found = findStep(config, parentId);
  if (!found) throw new ConfigOpError(`Parent step "${parentId}" not found.`);
  const parent = found.step;

  if (isConditional(parent)) {
    if (branch === 'if_false') {
      parent.config.if_false ??= [];
      return parent.config.if_false;
    }
    if (branch === undefined || branch === 'if_true') return parent.config.if_true;
    throw new ConfigOpError(
      `Step "${parentId}" is a CONDITIONAL; branch must be "if_true" or "if_false".`,
    );
  }

  if (isSwitch(parent)) {
    if (branch === 'default') return parent.config.default;
    if (branch && typeof branch === 'object' && typeof branch.caseIndex === 'number') {
      const entry = parent.config.cases[branch.caseIndex];
      if (!entry) {
        throw new ConfigOpError(
          `Step "${parentId}" has no case at index ${branch.caseIndex}.`,
        );
      }
      return entry.steps;
    }
    throw new ConfigOpError(
      `Step "${parentId}" is a SWITCH; branch must be "default" or { caseIndex }.`,
    );
  }

  throw new ConfigOpError(
    `Step "${parentId}" is not a control-flow step, so it cannot contain steps.`,
  );
}

function insertAt(list: AutomationStepConfig[], step: AutomationStepConfig, index?: number): void {
  if (index === undefined || index < 0 || index >= list.length) list.push(step);
  else list.splice(index, 0, step);
}

/** Applies operations in order to a deep copy; throws on the first invalid one. */
export function applyConfigOperations(
  config: AutomationConfig,
  operations: ConfigOperation[],
): AutomationConfig {
  const next = JSON.parse(JSON.stringify(config)) as AutomationConfig;
  next.steps ??= [];

  for (const operation of operations) {
    switch (operation.op) {
      case 'add-step': {
        if (!operation.step?.id) throw new ConfigOpError('add-step requires step.id.');
        if (collectIds(next).has(operation.step.id)) {
          throw new ConfigOpError(`A step with id "${operation.step.id}" already exists.`);
        }
        const list = resolveTargetList(next, operation.parentId, operation.branch);
        insertAt(list, operation.step, operation.index);
        break;
      }

      case 'update-step': {
        const found = findStep(next, operation.stepId);
        if (!found) throw new ConfigOpError(`Step "${operation.stepId}" not found.`);
        if (operation.config) {
          // Merge by default; `replace` opts into a full swap.
          found.step.config = (
            operation.replace
              ? operation.config
              : { ...(found.step.config as Record<string, unknown>), ...operation.config }
          ) as never;
        }
        break;
      }

      case 'delete-step': {
        const found = findStep(next, operation.stepId);
        if (!found) throw new ConfigOpError(`Step "${operation.stepId}" not found.`);
        found.list.splice(found.index, 1);
        break;
      }

      case 'move-step': {
        const found = findStep(next, operation.stepId);
        if (!found) throw new ConfigOpError(`Step "${operation.stepId}" not found.`);
        // Moving a control-flow step into its own subtree would detach it.
        const moving = found.step;
        if (operation.parentId) {
          const descendantIds = collectIds({ ...next, steps: [moving] });
          if (descendantIds.has(operation.parentId)) {
            throw new ConfigOpError(
              `Cannot move step "${operation.stepId}" inside itself.`,
            );
          }
        }
        found.list.splice(found.index, 1);
        const list = resolveTargetList(next, operation.parentId, operation.branch);
        insertAt(list, moving, operation.index);
        break;
      }

      case 'set-condition': {
        const found = findStep(next, operation.stepId);
        if (!found) throw new ConfigOpError(`Step "${operation.stepId}" not found.`);
        if (!isConditional(found.step)) {
          throw new ConfigOpError(
            `Step "${operation.stepId}" is not a CONDITIONAL step; use set-case-condition for SWITCH.`,
          );
        }
        found.step.config.condition = operation.condition;
        break;
      }

      case 'set-case-condition': {
        const found = findStep(next, operation.stepId);
        if (!found) throw new ConfigOpError(`Step "${operation.stepId}" not found.`);
        if (!isSwitch(found.step)) {
          throw new ConfigOpError(`Step "${operation.stepId}" is not a SWITCH step.`);
        }
        const entry = found.step.config.cases[operation.caseIndex];
        if (!entry) {
          throw new ConfigOpError(
            `Step "${operation.stepId}" has no case at index ${operation.caseIndex}.`,
          );
        }
        entry.condition = operation.condition;
        break;
      }

      case 'set-trigger': {
        if (!operation.trigger?.type) throw new ConfigOpError('set-trigger requires trigger.type.');
        next.trigger = {
          type: operation.trigger.type,
          config: operation.trigger.config ?? next.trigger?.config ?? {},
        };
        break;
      }

      case 'set-schedule': {
        if (operation.schedule === null) delete next.schedule;
        else next.schedule = operation.schedule;
        break;
      }

      default: {
        const unknownOp = (operation as { op?: unknown }).op;
        throw new ConfigOpError(`Unknown operation "${String(unknownOp)}".`);
      }
    }
  }

  return next;
}
