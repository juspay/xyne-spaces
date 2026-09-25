import type {
  AutomationConfig,
  AutomationStepConfig,
  StepCatalogItem,
  TriggerSchema,
  ValidationIssue,
} from '../../Automation.types';

/**
 * Every canvas node is one of these kinds. `trigger` / `schedule` / `conditions`
 * are the three "meta" nodes that mirror the first three Builder sections; the
 * rest map to entries in {@link AutomationConfig.steps}. `join` is the point
 * where the arms of a Conditional / Switch reconverge before the next step, and
 * `add` nodes are the inline insertion affordances on the main spine (edit
 * mode only).
 */
export type AutoNodeKind =
  | 'trigger'
  | 'schedule'
  | 'conditions'
  | 'action'
  | 'conditional'
  | 'switch'
  | 'branchEmpty'
  | 'join'
  | 'add';

/** Kinds whose editor is the top-level step card (`config.steps[i]`). */
export const STEP_KINDS: ReadonlySet<AutoNodeKind> = new Set([
  'action',
  'conditional',
  'switch',
  'branchEmpty',
]);

/**
 * Data carried by a React Flow node. Kept as a plain object type (not an
 * interface) so it satisfies `Record<string, unknown>` for `@xyflow/react`'s
 * `Node<T>` generic. Layout is pure — interaction callbacks are supplied via
 * {@link AutomationGraphContext}, never stored on the node.
 */
export type AutoNodeData = {
  kind: AutoNodeKind;
  /**
   * Id of the owning top-level step in `config.steps` (nested branch nodes
   * resolve to their root step). Selection is keyed on this id, never on an
   * array index, so reordering/deleting steps cannot retarget the editor.
   */
  rootStepId?: string;
  /** Small uppercase label above the title, e.g. "Step 2" or "Trigger". */
  kicker: string;
  title: string;
  subtitle?: string;
  /** Number of validation issues attributed to this node. */
  issueCount: number;
  /** Nesting depth (0 = spine, >0 = inside a branch). Used for muted styling. */
  depth: number;
  /** For `add` nodes: the top-level index the new step is inserted at. */
  insertAt?: number;
  /** Whether this node opens an editor when activated. */
  interactive: boolean;
};

export interface BuildGraphArgs {
  config: AutomationConfig;
  stepCatalog: StepCatalogItem[];
  triggerSchema: TriggerSchema | null;
  issues: ValidationIssue[] | undefined;
  editMode: boolean;
}

/** Interaction surface shared with node components via React context. */
export interface AutomationGraphContextValue {
  stepCatalog: StepCatalogItem[];
  editMode: boolean;
  selectedNodeId: string | null;
  onAddStep: (type: string, insertAt?: number) => void;
  onActivateNode: (nodeId: string, data: AutoNodeData) => void;
}

export const AUTO_NODE_TYPE = 'automationNode';

export function stepGraphId(step: AutomationStepConfig): string {
  return `step:${step.id}`;
}
