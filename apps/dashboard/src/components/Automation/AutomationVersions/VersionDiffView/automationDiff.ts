import type { Automation } from '../../Automation.types';

export type DiffStatus = 'unchanged' | 'added' | 'removed' | 'modified';

export interface ScalarDiff<T = unknown> {
  kind: 'scalar';
  status: DiffStatus;
  oldValue: T | undefined;
  newValue: T | undefined;
}

export interface ObjectDiff {
  kind: 'object';
  status: DiffStatus;
  fields: Record<string, DiffNode>;
}

export interface ArrayItemDiff {
  id?: string;
  index: number;
  status: DiffStatus;
  value: DiffNode;
}

export interface ArrayDiff {
  kind: 'array';
  status: DiffStatus;
  items: ArrayItemDiff[];
}

export type DiffNode = ScalarDiff<unknown> | ObjectDiff | ArrayDiff;

export interface TriggerDiff {
  kind: 'trigger';
  status: DiffStatus;
  type: ScalarDiff<string>;
  config: ObjectDiff;
}

export interface AutomationVersionDiff {
  name: ScalarDiff<string>;
  description: ScalarDiff<string | null>;
  status: ScalarDiff<string>;
  eventType: ScalarDiff<string>;
  schedule: DiffNode;
  trigger: TriggerDiff;
  steps: ArrayDiff;
}

function isNil(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isNil(a) && isNil(b)) return true;
  if (isNil(a) || isNil(b)) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffScalar<T>(
  oldValue: T | undefined,
  newValue: T | undefined,
  forcedStatus?: DiffStatus,
): ScalarDiff<T> {
  const status: DiffStatus =
    forcedStatus ?? (sameValue(oldValue, newValue) ? 'unchanged' : 'modified');
  return { kind: 'scalar', status, oldValue, newValue };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIdArray(value: unknown): value is Array<Record<string, unknown> & { id: string }> {
  return (
    Array.isArray(value) &&
    value.every(item => isRecord(item) && typeof item['id'] === 'string')
  );
}

function singleSideObject(
  record: Record<string, unknown> | undefined,
  status: Extract<DiffStatus, 'added' | 'removed'>,
): ObjectDiff {
  const fields: Record<string, DiffNode> = {};
  if (isNil(record)) {
    return { kind: 'object', status, fields };
  }
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (status === 'added') {
      fields[key] =
        isRecord(value) && !isIdArray(value)
          ? singleSideObject(value, status)
          : isIdArray(value)
            ? singleSideArray(value, status)
            : diffScalar(undefined, value, status);
    } else {
      fields[key] =
        isRecord(value) && !isIdArray(value)
          ? singleSideObject(value, status)
          : isIdArray(value)
            ? singleSideArray(value, status)
            : diffScalar(value, undefined, status);
    }
  }
  return { kind: 'object', status, fields };
}

function singleSideArray(
  items: Array<Record<string, unknown> & { id: string }>,
  status: Extract<DiffStatus, 'added' | 'removed'>,
): ArrayDiff {
  return {
    kind: 'array',
    status,
    items: items.map((item, index) => ({
      id: item['id'],
      index,
      status,
      value: singleSideObject(item, status),
    })),
  };
}

export function diffObject(
  oldObj: Record<string, unknown> | undefined,
  newObj: Record<string, unknown> | undefined,
): ObjectDiff {
  if (isNil(oldObj) && isNil(newObj)) {
    return { kind: 'object', status: 'unchanged', fields: {} };
  }
  if (isNil(oldObj)) {
    return singleSideObject(newObj, 'added');
  }
  if (isNil(newObj)) {
    return singleSideObject(oldObj, 'removed');
  }

  const keys = Array.from(new Set([...Object.keys(oldObj), ...Object.keys(newObj)]));
  const fields: Record<string, DiffNode> = {};
  let anyChanged = false;

  for (const key of keys) {
    const fieldDiff = diffNode(oldObj[key], newObj[key]);
    fields[key] = fieldDiff;
    if (fieldDiff.status !== 'unchanged') {
      anyChanged = true;
    }
  }

  return {
    kind: 'object',
    status: anyChanged ? 'modified' : 'unchanged',
    fields,
  };
}

export function diffArrayById<T extends Record<string, unknown> & { id: string }>(
  oldItems: T[] | undefined,
  newItems: T[] | undefined,
  itemDiff: (oldItem: T | undefined, newItem: T | undefined) => DiffNode = (oldItem, newItem) =>
    diffObject(oldItem, newItem as Record<string, unknown>),
): ArrayDiff {
  const oldList = oldItems ?? [];
  const newList = newItems ?? [];
  const oldById = new Map(oldList.map(i => [i['id'], i]));
  const seen = new Set<string>();
  const items: ArrayItemDiff[] = [];
  let anyChanged = false;

  // Walk the new order first so added/modified/unchanged items appear in new order.
  newList.forEach((newItem, index) => {
    const id = newItem['id'];
    seen.add(id);
    const oldItem = oldById.get(id);
    let status: DiffStatus;
    if (oldItem === undefined) {
      status = 'added';
    } else if (sameValue(oldItem, newItem)) {
      status = 'unchanged';
    } else {
      status = 'modified';
    }
    const value = itemDiff(oldItem, newItem);
    if (value.kind === 'object' && value.status === 'unchanged' && status !== 'unchanged') {
      // Force object wrapper to reflect array-level status.
      value.status = status;
    }
    items.push({ id, index, status, value });
    if (status !== 'unchanged') anyChanged = true;
  });

  // Removed items keep their original order.
  oldList.forEach((oldItem, index) => {
    const id = oldItem.id;
    if (!seen.has(id)) {
      const value = itemDiff(oldItem, undefined);
      items.push({ id, index, status: 'removed', value });
      anyChanged = true;
    }
  });

  return {
    kind: 'array',
    status: anyChanged ? 'modified' : 'unchanged',
    items,
  };
}

export function diffNode(oldValue: unknown, newValue: unknown): DiffNode {
  if (isIdArray(oldValue) || isIdArray(newValue)) {
    return diffArrayById(
      isIdArray(oldValue) ? oldValue : undefined,
      isIdArray(newValue) ? newValue : undefined,
    );
  }

  if (isRecord(oldValue) || isRecord(newValue)) {
    return diffObject(
      isRecord(oldValue) ? oldValue : undefined,
      isRecord(newValue) ? newValue : undefined,
    );
  }

  return diffScalar(oldValue, newValue);
}

function diffStep(
  oldStep: Record<string, unknown> | undefined,
  newStep: Record<string, unknown> | undefined,
): DiffNode {
  return diffObject(oldStep, newStep);
}

export function buildAutomationVersionDiff(
  from: Automation,
  to: Automation,
): AutomationVersionDiff {
  const fromConfig = from.config as {
    trigger: { type: string; config: Record<string, unknown> };
    schedule?: unknown;
    steps: unknown;
  };
  const toConfig = to.config as {
    trigger: { type: string; config: Record<string, unknown> };
    schedule?: unknown;
    steps: unknown;
  };

  return {
    name: diffScalar<string>(from.name, to.name),
    description: diffScalar<string | null>(from.description, to.description),
    status: diffScalar<string>(from.status, to.status),
    eventType: diffScalar<string>(from.eventType, to.eventType),
    schedule: diffNode(fromConfig.schedule, toConfig.schedule),
    trigger: {
      kind: 'trigger',
      status: diffScalar<string>(fromConfig.trigger.type, toConfig.trigger.type).status,
      type: diffScalar<string>(fromConfig.trigger.type, toConfig.trigger.type),
      config: diffObject(fromConfig.trigger.config, toConfig.trigger.config),
    },
    steps: diffArrayById(
      fromConfig.steps as Array<Record<string, unknown> & { id: string }>,
      toConfig.steps as Array<Record<string, unknown> & { id: string }>,
      diffStep,
    ),
  };
}

export function countChanges(diff: AutomationVersionDiff): number {
  let count = 0;

  function visit(node: DiffNode): void {
    if (node.kind === 'scalar') {
      if (node.status !== 'unchanged') {
        count += 1;
      }
      return;
    }
    if (node.kind === 'array') {
      if (node.status !== 'unchanged') {
        count += 1;
      }
      for (const item of node.items) {
        visit(item.value);
      }
      return;
    }
    // object
    if (node.status !== 'unchanged') {
      count += 1;
    }
    for (const key of Object.keys(node.fields)) {
      const child = node.fields[key];
      if (child) {
        visit(child);
      }
    }
  }

  visit(diff.name);
  visit(diff.description);
  visit(diff.status);
  visit(diff.eventType);
  visit(diff.schedule);
  visit(diff.trigger.type);
  visit(diff.trigger.config);
  visit(diff.steps);

  return count;
}
