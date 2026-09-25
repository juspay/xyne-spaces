import type { ReactNode } from 'react';
import type {
  AutomationConfig,
  AutomationStepConfig,
  OperatorMeta,
  StepCatalogItem,
  StepSchema,
  TriggerCatalogItem,
  TriggerSchema,
  ValidationResult,
} from '../../Automation.types';

export type ViewStepPath = (string | number)[];

/** A slot in the step tree: `container` is `['root']` or `[...ownerPath, branchKey]`. */
export interface FlowInsertTarget {
  container: ViewStepPath;
  index: number;
}

export interface FlowItem {
  id: string;
  nodeType: 'trigger' | 'action' | 'conditional' | 'switch' | 'merge' | 'placeholder';
  path: ViewStepPath;
  parentIds: string[];
  width: number;
  height: number;
  step?: AutomationStepConfig;
  label?: string;
  /** Outline number shown on the node, e.g. "2" or "2.1.3". */
  stepNumber?: string;
  /** Placeholders only: where a step picked from this node is inserted. */
  insert?: FlowInsertTarget;
}

export interface FlowNodeData {
  item: FlowItem;
  readOnly: boolean;
  catalogItem?: StepCatalogItem | TriggerCatalogItem | undefined;
  /** One-line config summary rendered on the node. */
  summary?: string | undefined;
  issueMessages: string[];
  collapsed: boolean;
  /** Search is active and this node doesn't match. */
  dimmed: boolean;
  stepCatalog: StepCatalogItem[];
  onInsert: (target: FlowInsertTarget, type: string) => void;
  onToggleCollapse: (id: string) => void;
  onRequestEdit?: (() => void) | undefined;
}

export interface FlowEdgeData {
  label?: string | undefined;
  insert?: FlowInsertTarget | undefined;
  readOnly: boolean;
  hovered: boolean;
  stepCatalog: StepCatalogItem[];
  onInsert: (target: FlowInsertTarget, type: string) => void;
  onRequestEdit?: (() => void) | undefined;
}

export interface FlowAutomationViewProps {
  config: AutomationConfig;
  onConfigChange: (next: AutomationConfig) => void;
  triggerCatalog: TriggerCatalogItem[];
  triggerSchema: TriggerSchema | null;
  stepCatalog: StepCatalogItem[];
  stepSchemaCache: Record<string, StepSchema | undefined>;
  schemaLoadingFor: (type: string) => boolean;
  ensureSchema: (type: string) => void;
  operators: OperatorMeta[];
  validation: ValidationResult | null;
  readOnly: boolean;
  editMode: boolean;
  /** Inserts a new step of `type`; returns its id so the canvas can select it. */
  onAddStep: (type: string, index?: number, container?: ViewStepPath) => string;
  formFieldNameMap?: Map<string, string>;
  onFormFieldNamesResolved?: (map: Map<string, string>) => void;
  /** View mode only: asks the builder to enter edit / propose-change mode. */
  onRequestEdit?: (() => void) | undefined;
  /** Extra trigger UI (e.g. the webhook endpoint panel). */
  triggerExtras?: ReactNode;
  /** Persists the canvas viewport per automation when set. */
  viewportKey?: string | undefined;
  /** Validation-banner click: focus the node that owns this issue path. */
  focusRequest?: { issuePath: string; seq: number } | null;
}
