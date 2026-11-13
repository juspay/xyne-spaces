import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import { kindsCompatible, type TypeKind } from '@xyne/workflow-sdk/builder';
import { useWorkflowClient } from './use-workflow-client.js';

// ─── Variable tree node ───

export interface VariableNode {
  path: string;
  label: string;
  schemaType: string;
  children: VariableNode[];
  isLeaf: boolean;
  refString: string;
}

// ─── JSON Schema → tree ───

function schemaToTree(
  contextMap: Record<string, Record<string, unknown>>,
  labelMap?: Map<string, string>,
): VariableNode[] {
  const roots: VariableNode[] = [];

  for (const [path, schema] of Object.entries(contextMap)) {
    const displayLabel = resolveRootLabel(path, labelMap);
    const rootNode = buildNodeFromSchema(path, displayLabel, schema);
    roots.push(rootNode);
  }

  return roots;
}

/**
 * Resolve a root-level context path to a human-readable label.
 *
 * Context paths look like:
 *   "trigger"                         → "Trigger"
 *   "steps.agent_analysis.output"     → "Code (agent_analysis)" if labelMap has the mapping
 *
 * The refString stays as the raw path; only the display label changes.
 */
function resolveRootLabel(path: string, labelMap?: Map<string, string>): string {
  if (path === 'trigger') return 'Trigger';
  if (path === 'vars') return 'Variables';

  // Extract step ID from "steps.<stepId>.output" pattern
  const match = path.match(/^steps\.([^.]+)/);
  if (match) {
    const stepId = match[1]!;
    const stepName = labelMap?.get(stepId);
    if (stepName) return `${stepName} (${stepId})`;
    return stepId;
  }

  return path;
}

function buildNodeFromSchema(
  path: string,
  label: string,
  schema: Record<string, unknown>,
): VariableNode {
  const type = (schema['type'] as string | undefined) ?? 'unknown';
  const format = schema['format'] as string | undefined;
  const items = schema['items'] as Record<string, unknown> | undefined;
  if (format === 'attachment') {
    return { path, label, schemaType: 'attachment', children: [], isLeaf: true, refString: `{{${path}}}` };
  }
  if (type === 'array' && items?.['format'] === 'attachment') {
    return { path, label, schemaType: 'attachment[]', children: [], isLeaf: true, refString: `{{${path}}}` };
  }

  const children: VariableNode[] = [];
  if (type === 'object' && schema['properties']) {
    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    for (const [key, propSchema] of Object.entries(props)) {
      if (!key) continue; // never emit a `{{path.}}` ref for an empty property key
      children.push(
        buildNodeFromSchema(`${path}.${key}`, key, propSchema),
      );
    }
  }

  return {
    path,
    label,
    schemaType: type,
    children,
    isLeaf: children.length === 0,
    refString: `{{${path}}}`,
  };
}

function flattenLeaves(nodes: VariableNode[]): VariableNode[] {
  const result: VariableNode[] = [];
  for (const node of nodes) {
    if (node.isLeaf) {
      result.push(node);
    } else {
      result.push(...flattenLeaves(node.children));
    }
  }
  return result;
}

function searchNodes(nodes: VariableNode[], query: string): VariableNode[] {
  const lower = query.toLowerCase();
  return flattenLeaves(nodes).filter(
    (n) => n.path.toLowerCase().includes(lower)
      || n.label.toLowerCase().includes(lower)
      || n.refString.toLowerCase().includes(lower),
  );
}

// ─── Hook ───

export interface UseVariablePickerOptions {
  config: WorkflowConfig;
  atStepId: string;
  filterType?: string;
  enabled?: boolean;
  /** Map of step ID → human-readable name (e.g. "agent_analysis" → "Code"). Built from step metadata. */
  stepLabelMap?: Map<string, string>;
}

export interface UseVariablePickerReturn {
  variables: VariableNode[];
  flatPaths: VariableNode[];
  isLoading: boolean;
  error: Error | null;
  search: (query: string) => VariableNode[];
}

export function useVariablePicker(opts: UseVariablePickerOptions): UseVariablePickerReturn {
  const { config, atStepId, filterType, enabled = true, stepLabelMap } = opts;
  const client = useWorkflowClient();

  const [contextMap, setContextMap] = useState<Record<string, Record<string, unknown>> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled || !atStepId) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    void (async () => {
      try {
        const result = await client.schema.availableContext(config, atStepId);
        if (!cancelled) {
          setContextMap(result as Record<string, Record<string, unknown>> | null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [client, config, atStepId, enabled]);

  const variables = useMemo(() => {
    if (!contextMap) return [];
    let tree = schemaToTree(contextMap, stepLabelMap);
    if (filterType) {
      tree = tree.map((node) => filterByType(node, filterType)).filter(Boolean) as VariableNode[];
    }
    return tree;
  }, [contextMap, filterType, stepLabelMap]);

  const flatPaths = useMemo(() => flattenLeaves(variables), [variables]);

  const search = useCallback(
    (query: string): VariableNode[] => {
      if (!query) return flatPaths;
      return searchNodes(variables, query);
    },
    [variables, flatPaths],
  );

  return { variables, flatPaths, isLoading, error, search };
}

/** Map a picker/JSON-schema type string to the SDK's neutral TypeKind. */
function normalizeKind(t: string): TypeKind {
  if (t === 'integer') return 'number';
  // Attachment nodes are format-qualified; collapse to their base kind so the
  // shared rule treats them like object/array for non-attachment targets.
  if (t === 'attachment') return 'object';
  if (t === 'attachment[]') return 'array';
  if (t === 'string' || t === 'number' || t === 'boolean' || t === 'array' || t === 'object') {
    return t;
  }
  return 'unknown';
}

/**
 * Can a source ref of `sourceKind` be bound into a field of `target` type?
 * Delegates to the SDK's shared `kindsCompatible` (the same rule the config
 * validator uses) so picker and validator never drift — except attachment
 * input fields, which stay attachment-only (exact, format-qualified match).
 */
function compatible(sourceKind: string, target: string): boolean {
  if (target === 'attachment' || target === 'attachment[]') return sourceKind === target;
  return kindsCompatible(normalizeKind(sourceKind), normalizeKind(target));
}

/**
 * Keep only refs that can be bound into a `type` field. A matching node is kept
 * (objects/arrays/strings are themselves selectable); non-matching containers
 * are kept only if a descendant matches.
 */
function filterByType(node: VariableNode, type: string): VariableNode | null {
  const selfMatches = compatible(node.schemaType, type);

  if (node.isLeaf) {
    return selfMatches ? node : null;
  }

  const filtered = node.children
    .map((child) => filterByType(child, type))
    .filter(Boolean) as VariableNode[];

  if (selfMatches) {
    // The node itself is a valid target (e.g. an object/array ref) — keep its
    // full subtree browseable.
    return { ...node, children: filtered.length ? filtered : node.children };
  }
  if (filtered.length === 0) return null;
  return { ...node, children: filtered };
}
