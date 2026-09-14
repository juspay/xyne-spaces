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

export interface FlowItem {
  id: string;
  nodeType: 'trigger' | 'action' | 'conditional' | 'switch' | 'merge';
  path: ViewStepPath;
  parentIds: string[];
  width: number;
  height: number;
  step?: AutomationStepConfig;
  label?: string;
}

export interface FlowNodeData {
  item: FlowItem;
  selected: boolean;
  readOnly: boolean;
  catalogItem?: StepCatalogItem | TriggerCatalogItem | undefined;
  onSelect: (id: string) => void;
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
  onAddStep: (type: string, index?: number) => void;
  formFieldNameMap?: Map<string, string>;
  onFormFieldNamesResolved?: (map: Map<string, string>) => void;
}
