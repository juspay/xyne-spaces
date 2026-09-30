import type { ReactNode } from 'react';
import type { ControlFlowRenderProps } from '../BranchSteps/BranchSteps';
import type {
  AutomationConfig,
  AutomationStepConfig,
  ConditionalStepConfig,
  SwitchStepConfig,
  OperatorMeta,
  ScheduleConfig,
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
  /** Placeholders only: where a step picked from this node is inserted. */
  insert?: FlowInsertTarget;
}

export interface FlowNodeData {
  item: FlowItem;
  readOnly: boolean;
  catalogItem?: StepCatalogItem | TriggerCatalogItem | undefined;
  issueMessages: string[];
  /** Steps only: the same number the List view's card shows (`stepNumberForPrefix`). */
  stepNumber?: string | undefined;
  stepCatalog: StepCatalogItem[];
  onInsert: (target: FlowInsertTarget, type: string) => void;
  onRequestEdit?: (() => void) | undefined;
  /** Run view only: the step row's status, or null when the run never reached it. */
  runStatus?: string | null | undefined;
}

/** Turns the canvas into a read-only picture of one run. */
export interface FlowRunOverlay {
  /**
   * Badge status keyed by the executor's positional name (see `stepNameForPath`).
   * A step missing here is drawn as not reached.
   */
  statusByStepName: Record<string, string>;
  /** If/Switch step name → the branch key it took (`if_true`, `case:0`, `default`…). */
  takenBranchByStepName: Record<string, string>;
  /** Replaces the side panel; `item` is null when nothing is selected. */
  renderPanel: (item: FlowItem | null) => ReactNode;
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
  /** The builder's own trigger/schedule handlers, shared with the List view. */
  onTriggerTypeChange: (type: string) => void;
  onTriggerConfigChange: (next: Record<string, unknown>) => void;
  onScheduleChange: (next: ScheduleConfig | undefined) => void;
  triggerCatalog: TriggerCatalogItem[];
  triggerSchema: TriggerSchema | null;
  stepCatalog: StepCatalogItem[];
  stepSchemaCache: Record<string, StepSchema | undefined>;
  schemaLoadingFor: (type: string) => boolean;
  /** True while the trigger schema for the current trigger type is being fetched. */
  triggerSchemaLoading: boolean;
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
  /** The builder's own control-flow card renderers, reused for the side panel. */
  renderConditionalCard: (
    step: ConditionalStepConfig,
    props: ControlFlowRenderProps,
  ) => React.ReactElement;
  renderSwitchCard: (step: SwitchStepConfig, props: ControlFlowRenderProps) => React.ReactElement;
  /** Extra trigger UI (e.g. the webhook endpoint panel). */
  triggerExtras?: ReactNode;
  /** Run detail: overlay step statuses and show run data in the side panel. */
  runOverlay?: FlowRunOverlay | undefined;
  /** Select and centre this node (a step id, or the trigger); each new object applies once. */
  focusRequest?: { id: string } | null | undefined;
}
