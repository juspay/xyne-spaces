import type {
  AutomationConfig,
  TriggerCatalogItem,
  TriggerSchema,
  ValidationIssue,
} from '../../Automation.types';

export interface TriggerCardProps {
  trigger: AutomationConfig['trigger'];
  catalog: TriggerCatalogItem[];
  schema: TriggerSchema | null;
  schemaLoading?: boolean;
  onChangeType: (type: string) => void;
  onConfigChange: (config: Record<string, unknown>) => void;
  issues?: ValidationIssue[];
  view?: 'event' | 'condition';
  onFormFieldNamesResolved?: (map: Map<string, string>) => void;
}
