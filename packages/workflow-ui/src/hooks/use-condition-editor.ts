import { useCallback, useEffect, useState } from 'react';
import type { Condition, LeafCondition, OperatorDescriptor } from '@xyne/workflow-sdk/builder';
import { ConditionOperator } from '@xyne/workflow-sdk/builder';
import { useWorkflowClient } from './use-workflow-client.js';

// ─── Path-based tree access ───

function updateAtPath(
  root: Condition,
  path: number[],
  updater: (node: Condition) => Condition,
): Condition {
  if (path.length === 0) return updater(root);

  const [head, ...rest] = path;
  if ('all' in root) {
    const children = [...root.all];
    children[head!] = updateAtPath(children[head!]!, rest, updater);
    return { all: children };
  }
  if ('any' in root) {
    const children = [...root.any];
    children[head!] = updateAtPath(children[head!]!, rest, updater);
    return { any: children };
  }
  return root;
}

function removeAtPath(root: Condition, path: number[]): Condition {
  if (path.length === 0) return root;
  if (path.length === 1) {
    const idx = path[0]!;
    if ('all' in root) return { all: root.all.filter((_, i) => i !== idx) };
    if ('any' in root) return { any: root.any.filter((_, i) => i !== idx) };
    return root;
  }

  const [head, ...rest] = path;
  return updateAtPath(root, [head!], (node) => removeAtPath(node, rest));
}

function addChildAtPath(root: Condition, parentPath: number[], child: Condition): Condition {
  return updateAtPath(root, parentPath, (node) => {
    if ('all' in node) return { all: [...node.all, child] };
    if ('any' in node) return { any: [...node.any, child] };
    return node;
  });
}

// ─── Default leaf ───

function defaultLeaf(): LeafCondition {
  return {
    variable: '',
    operator: ConditionOperator.EQ,
    value: '',
  };
}

// ─── Hook ───

export interface UseConditionEditorOptions {
  initialCondition: Condition;
  onChange: (condition: Condition) => void;
}

export interface UseConditionEditorReturn {
  condition: Condition;
  operators: readonly OperatorDescriptor[];
  isLoadingOperators: boolean;

  updateLeaf: (path: number[], update: Partial<LeafCondition>) => void;
  addLeaf: (parentPath: number[], leaf?: Partial<LeafCondition>) => void;
  removeNode: (path: number[]) => void;
  wrapInGroup: (path: number[], groupType: 'all' | 'any') => void;
  toggleGroupType: (path: number[]) => void;
  setCondition: (condition: Condition) => void;
}

export function useConditionEditor(opts: UseConditionEditorOptions): UseConditionEditorReturn {
  const { initialCondition, onChange } = opts;
  const client = useWorkflowClient();

  const [condition, setConditionInternal] = useState<Condition>(initialCondition);
  const [operators, setOperators] = useState<readonly OperatorDescriptor[]>([]);
  const [isLoadingOperators, setIsLoadingOperators] = useState(true);

  // Fetch operators once
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await client.schema.operators();
        if (!cancelled) setOperators(result);
      } catch {
        // Operators are optional — condition editor still works
      } finally {
        if (!cancelled) setIsLoadingOperators(false);
      }
    })();
    return () => { cancelled = true; };
  }, [client]);

  const setCondition = useCallback(
    (next: Condition) => {
      setConditionInternal(next);
      onChange(next);
    },
    [onChange],
  );

  const updateLeaf = useCallback(
    (path: number[], update: Partial<LeafCondition>) => {
      setCondition(
        updateAtPath(condition, path, (node) => ({ ...node, ...update }) as Condition),
      );
    },
    [condition, setCondition],
  );

  const addLeaf = useCallback(
    (parentPath: number[], leaf?: Partial<LeafCondition>) => {
      const newLeaf: LeafCondition = { ...defaultLeaf(), ...leaf };
      setCondition(addChildAtPath(condition, parentPath, newLeaf));
    },
    [condition, setCondition],
  );

  const removeNode = useCallback(
    (path: number[]) => {
      setCondition(removeAtPath(condition, path));
    },
    [condition, setCondition],
  );

  const wrapInGroup = useCallback(
    (path: number[], groupType: 'all' | 'any') => {
      setCondition(
        updateAtPath(condition, path, (node) => ({ [groupType]: [node] }) as Condition),
      );
    },
    [condition, setCondition],
  );

  const toggleGroupType = useCallback(
    (path: number[]) => {
      setCondition(
        updateAtPath(condition, path, (node) => {
          if ('all' in node) return { any: node.all };
          if ('any' in node) return { all: node.any };
          return node;
        }),
      );
    },
    [condition, setCondition],
  );

  return {
    condition,
    operators,
    isLoadingOperators,
    updateLeaf,
    addLeaf,
    removeNode,
    wrapInGroup,
    toggleGroupType,
    setCondition,
  };
}
