import { cn } from '../../../../utils/classNames';
import { CONDITIONAL_STEP_TYPE, SWITCH_STEP_TYPE, makeStepId } from '../../Automation.types';
import {
  buildOutputSchemaFromRunAgentConfig,
  buildOutputSchemaFromWebhookConfig,
} from '../AutomationBuilder.utils';
import type {
  ActionStepConfig,
  AutomationStepConfig,
  ConditionalStepConfig,
  SwitchStepConfig,
  OperatorMeta,
  StepCatalogItem,
  StepSchema,
  ValidationIssue,
} from '../../Automation.types';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import { AddStepRow } from '../AddStepRow/AddStepRow';
import { StepCard } from '../StepCard/StepCard';

export interface BranchStepsProps {
  label: string;
  accent: 'green' | 'red' | 'blue' | 'gray';
  steps: AutomationStepConfig[];
  catalog: StepCatalogItem[];
  schemaCache: Record<string, StepSchema | undefined>;
  schemaLoadingFor: (type: string) => boolean;
  operators: OperatorMeta[];
  variableSources: VariablePickerSource[];
  onChange: (next: AutomationStepConfig[]) => void;
  ensureSchema: (type: string) => void;
  issues: ValidationIssue[];
  pathPrefix: string;
  renderConditionalCard: (
    step: ConditionalStepConfig,
    props: ControlFlowRenderProps,
  ) => React.ReactElement;
  renderSwitchCard: (step: SwitchStepConfig, props: ControlFlowRenderProps) => React.ReactElement;
}

export interface ControlFlowRenderProps {
  catalog: StepCatalogItem[];
  schemaCache: Record<string, StepSchema | undefined>;
  schemaLoadingFor: (type: string) => boolean;
  operators: OperatorMeta[];
  variableSources: VariablePickerSource[];
  index: number;
  total: number;
  onChange: (next: AutomationStepConfig) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  issues: ValidationIssue[];
  pathPrefix: string;
  ensureSchema: (type: string) => void;
  renderConditionalCard: (
    step: ConditionalStepConfig,
    props: ControlFlowRenderProps,
  ) => React.ReactElement;
  renderSwitchCard: (step: SwitchStepConfig, props: ControlFlowRenderProps) => React.ReactElement;
}

const ACCENT_CLASSES: Record<BranchStepsProps['accent'], string> = {
  green: 'border-green-500/30 bg-green-500/5',
  red: 'border-red-500/30 bg-red-500/5',
  blue: 'border-blue-500/30 bg-blue-500/5',
  gray: 'border-border bg-accent/5',
};

function buildBranchVariableSources(
  parentSources: VariablePickerSource[],
  steps: AutomationStepConfig[],
  schemaCache: Record<string, StepSchema | undefined>,
  upToIndex: number,
): VariablePickerSource[] {
  if (upToIndex === 0) return parentSources;

  const sources: VariablePickerSource[] = [...parentSources];
  for (let i = 0; i < upToIndex; i++) {
    const s = steps[i];
    if (!s || s.type === CONDITIONAL_STEP_TYPE || s.type === SWITCH_STEP_TYPE) continue;
    const schema = schemaCache[s.type];
    if (!schema) continue;
    const groupLabel = `Branch step ${i + 1} — ${schema.name}`;
    sources.push({
      sourceKey: s.id,
      role: 'input',
      label: `Branch step ${i + 1} input`,
      sublabel: schema.name,
      groupKey: s.id,
      groupLabel,
      schema: schema.configSchema,
    });
    const outputSchema =
      s.type === 'RUN_AGENT'
        ? buildOutputSchemaFromRunAgentConfig(s.config)
        : s.type === 'TRIGGER_WEBHOOK'
          ? buildOutputSchemaFromWebhookConfig(s.config)
          : schema.outputSchema;
    sources.push({
      sourceKey: s.id,
      role: 'output',
      label: `Branch step ${i + 1} output`,
      sublabel: schema.name,
      groupKey: s.id,
      groupLabel,
      schema: outputSchema,
    });
  }
  return sources;
}

export function BranchSteps({
  label,
  accent,
  steps,
  catalog,
  schemaCache,
  schemaLoadingFor,
  operators,
  variableSources,
  onChange,
  ensureSchema,
  issues,
  pathPrefix,
  renderConditionalCard,
  renderSwitchCard,
}: BranchStepsProps): React.ReactElement {
  const handleAdd = (type: string): void => {
    if (type === CONDITIONAL_STEP_TYPE) {
      const cond: ConditionalStepConfig = {
        id: makeStepId(),
        type: CONDITIONAL_STEP_TYPE,
        config: {
          condition: { variable: '', operator: 'eq', value: '' },
          if_true: [],
          if_false: [],
        },
      };
      onChange([...steps, cond]);
      return;
    }
    if (type === SWITCH_STEP_TYPE) {
      const sw: SwitchStepConfig = {
        id: makeStepId(),
        type: SWITCH_STEP_TYPE,
        config: { cases: [], default: [] },
      };
      onChange([...steps, sw]);
      return;
    }
    const newStep: ActionStepConfig = {
      id: makeStepId(),
      type,
      config: {},
    };
    onChange([...steps, newStep]);
    ensureSchema(type);
  };

  const handleStepUpdate = (index: number, next: AutomationStepConfig): void => {
    const copy = steps.slice();
    copy[index] = next;
    onChange(copy);
  };

  const handleStepConfigChange = (index: number, config: Record<string, unknown>): void => {
    const target = steps[index];
    if (!target || target.type === CONDITIONAL_STEP_TYPE || target.type === SWITCH_STEP_TYPE)
      return;
    const copy = steps.slice();
    copy[index] = { ...target, config } as ActionStepConfig;
    onChange(copy);
  };

  const handleRemove = (index: number): void => {
    onChange(steps.filter((_, i) => i !== index));
  };

  const handleMove = (index: number, direction: -1 | 1): void => {
    const next = index + direction;
    if (next < 0 || next >= steps.length) return;
    const copy = steps.slice();
    const a = copy[index];
    const b = copy[next];
    if (!a || !b) return;
    copy[index] = b;
    copy[next] = a;
    onChange(copy);
  };

  const issuesUnder = (prefix: string): ValidationIssue[] =>
    issues.filter(i => i.path.startsWith(prefix));

  return (
    <div className={cn('flex flex-1 flex-col gap-2 rounded-lg border p-3', ACCENT_CLASSES[accent])}>
      <div className='text-xs font-medium uppercase tracking-wide text-foreground'>{label}</div>
      <div className='flex flex-col gap-2'>
        {steps.length === 0 ? (
          <div className='py-3 text-center text-[11px] text-muted-foreground italic'>
            No steps in this branch yet.
          </div>
        ) : (
          steps.map((s, i) => {
            const stepIssues = issuesUnder(`${pathPrefix}[${i}]`);
            const stepVariableSources = buildBranchVariableSources(
              variableSources,
              steps,
              schemaCache,
              i,
            );
            const renderProps: ControlFlowRenderProps = {
              catalog,
              schemaCache,
              schemaLoadingFor,
              operators,
              variableSources: stepVariableSources,
              index: i + 1,
              total: steps.length,
              onChange: (next: AutomationStepConfig) => handleStepUpdate(i, next),
              onMoveUp: () => handleMove(i, -1),
              onMoveDown: () => handleMove(i, 1),
              onDelete: () => handleRemove(i),
              issues: stepIssues,
              pathPrefix: `${pathPrefix}[${i}]`,
              ensureSchema,
              renderConditionalCard,
              renderSwitchCard,
            };

            if (s.type === CONDITIONAL_STEP_TYPE) {
              return (
                <div key={s.id}>
                  {renderConditionalCard(s as ConditionalStepConfig, renderProps)}
                </div>
              );
            }

            if (s.type === SWITCH_STEP_TYPE) {
              return <div key={s.id}>{renderSwitchCard(s as SwitchStepConfig, renderProps)}</div>;
            }

            const action = s as ActionStepConfig;
            const catalogItem = catalog.find(c => c.type === action.type) ?? null;
            const schema = schemaCache[action.type] ?? null;
            return (
              <StepCard
                key={action.id}
                step={action}
                catalogItem={catalogItem}
                schema={schema}
                schemaLoading={schemaLoadingFor(action.type)}
                index={i + 1}
                total={steps.length}
                variableSources={stepVariableSources}
                onConfigChange={cfg => handleStepConfigChange(i, cfg)}
                onMoveUp={() => handleMove(i, -1)}
                onMoveDown={() => handleMove(i, 1)}
                onDelete={() => handleRemove(i)}
                issues={stepIssues ?? []}
                pathPrefix={`${pathPrefix}[${i}].config.`}
              />
            );
          })
        )}
        <AddStepRow catalog={catalog} onPick={handleAdd} variant='compact' />
      </div>
    </div>
  );
}
