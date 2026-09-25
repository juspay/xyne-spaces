import { X } from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import {
  CONDITIONAL_STEP_TYPE,
  SWITCH_STEP_TYPE,
  type ActionStepConfig,
  type AutomationConfig,
  type AutomationStepConfig,
  type ConditionalStepConfig,
  type ScheduleConfig,
  type StepCatalogItem,
  type StepSchema,
  type SwitchStepConfig,
  type TriggerCatalogItem,
  type TriggerSchema,
  type ValidationIssue,
  type OperatorMeta,
} from '../../Automation.types';
import { TriggerCard } from '../TriggerCard/TriggerCard';
import { ScheduleCard } from '../ScheduleCard/ScheduleCard';
import { StepCard } from '../StepCard/StepCard';
import { ConditionalCard } from '../ConditionalCard/ConditionalCard';
import { SwitchCard } from '../SwitchCard/SwitchCard';
import { WebhookEndpointPanel } from '../WebhookEndpointPanel';
import type { ControlFlowRenderProps } from '../BranchSteps/BranchSteps';
import { buildVariableSources, issuesUnder } from '../AutomationBuilder.utils';
import type { AutoNodeKind } from './automationGraph.types';

export interface DrawerSelection {
  kind: AutoNodeKind;
  rootIndex: number;
}

export interface AutomationConfigDrawerProps {
  selection: DrawerSelection;
  onClose: () => void;
  config: AutomationConfig;
  editMode: boolean;
  triggerCatalog: TriggerCatalogItem[];
  triggerSchema: TriggerSchema | null;
  triggerSchemaLoading: boolean;
  triggerIssues: ValidationIssue[];
  savedId: string | null;
  stepCatalog: StepCatalogItem[];
  stepSchemaCache: Record<string, StepSchema | undefined>;
  stepSchemaLoadingFor: (type: string) => boolean;
  ensureSchema: (type: string) => void;
  operators: OperatorMeta[];
  formFieldNameMap: Map<string, string>;
  validationIssues: ValidationIssue[] | undefined;
  onTriggerTypeChange: (type: string) => void;
  onTriggerConfigChange: (config: Record<string, unknown>) => void;
  onFormFieldNamesResolved: (map: Map<string, string>) => void;
  onScheduleChange: (next: ScheduleConfig | undefined) => void;
  onUpdateStepAt: (index: number, next: AutomationStepConfig) => void;
  onStepConfigChange: (index: number, cfg: Record<string, unknown>) => void;
  onDeleteStep: (index: number) => void;
  onMoveStep: (index: number, direction: -1 | 1) => void;
  renderConditionalCard: (
    step: ConditionalStepConfig,
    props: ControlFlowRenderProps,
  ) => React.ReactElement;
  renderSwitchCard: (step: SwitchStepConfig, props: ControlFlowRenderProps) => React.ReactElement;
}

const DRAWER_TITLE: Record<AutoNodeKind, string> = {
  trigger: 'Trigger',
  schedule: 'Run timing',
  conditions: 'Conditions',
  action: 'Step',
  conditional: 'Conditional',
  switch: 'Switch',
  branchEmpty: 'Step',
  add: 'Add step',
};

/**
 * Right-docked editor for the selected canvas node. It renders the SAME form
 * components used by Builder Mode against the same `config`/handlers, so no
 * business logic is duplicated and Graph Mode has full feature parity by
 * construction.
 */
export function AutomationConfigDrawer(props: AutomationConfigDrawerProps): React.ReactElement {
  const { selection, editMode } = props;
  const readOnly = !editMode;

  return (
    <div className='flex h-full w-[440px] shrink-0 flex-col border-l border-border bg-background'>
      <div className='flex items-center justify-between border-b border-border px-4 py-3'>
        <span className='text-sm font-semibold text-foreground'>
          {DRAWER_TITLE[selection.kind]}
        </span>
        <button
          type='button'
          onClick={props.onClose}
          aria-label='Close configuration panel'
          data-track-category='automation-graph'
          data-track-name='config-drawer-close'
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground',
            'hover:bg-accent/40 hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
          )}
        >
          <X className='size-4' aria-hidden='true' />
        </button>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto px-4 py-4'>{renderBody(props, readOnly)}</div>
    </div>
  );
}

function renderBody(props: AutomationConfigDrawerProps, readOnly: boolean): React.ReactElement {
  const { selection, config } = props;

  if (selection.kind === 'trigger') {
    return (
      <div className='flex flex-col gap-4'>
        <TriggerCard
          view='event'
          trigger={config.trigger}
          catalog={props.triggerCatalog}
          schema={props.triggerSchema}
          schemaLoading={props.triggerSchemaLoading && !!config.trigger.type}
          onChangeType={props.onTriggerTypeChange}
          onConfigChange={props.onTriggerConfigChange}
          issues={props.triggerIssues}
        />
        {config.trigger.type === 'WEBHOOK' && <WebhookEndpointPanel automationId={props.savedId} />}
      </div>
    );
  }

  if (selection.kind === 'schedule') {
    return (
      <ScheduleCard
        schedule={config.schedule}
        triggerSchema={props.triggerSchema}
        onChange={props.onScheduleChange}
      />
    );
  }

  if (selection.kind === 'conditions') {
    return (
      <TriggerCard
        view='condition'
        trigger={config.trigger}
        catalog={props.triggerCatalog}
        schema={props.triggerSchema}
        schemaLoading={props.triggerSchemaLoading && !!config.trigger.type}
        onChangeType={props.onTriggerTypeChange}
        onConfigChange={props.onTriggerConfigChange}
        issues={props.triggerIssues}
        onFormFieldNamesResolved={props.onFormFieldNamesResolved}
      />
    );
  }

  const index = selection.rootIndex;
  const step = config.steps[index];
  if (!step) {
    return <p className='text-sm text-muted-foreground'>This step no longer exists.</p>;
  }

  const variableSources = buildVariableSources(
    props.triggerSchema,
    config.trigger.config,
    config.steps,
    props.stepSchemaCache,
    index,
    props.formFieldNameMap,
  );
  const stepIssues = issuesUnder(props.validationIssues, `steps[${index}]`);

  if (step.type === CONDITIONAL_STEP_TYPE) {
    return (
      <ConditionalCard
        step={step as ConditionalStepConfig}
        catalog={props.stepCatalog}
        schemaCache={props.stepSchemaCache}
        schemaLoadingFor={props.stepSchemaLoadingFor}
        operators={props.operators}
        variableSources={variableSources}
        index={index + 1}
        total={config.steps.length}
        onChange={next => props.onUpdateStepAt(index, next)}
        onMoveUp={() => props.onMoveStep(index, -1)}
        onMoveDown={() => props.onMoveStep(index, 1)}
        onDelete={() => props.onDeleteStep(index)}
        issues={stepIssues}
        pathPrefix={`steps[${index}]`}
        readOnly={readOnly}
        ensureSchema={props.ensureSchema}
        renderConditionalCard={props.renderConditionalCard}
        renderSwitchCard={props.renderSwitchCard}
      />
    );
  }

  if (step.type === SWITCH_STEP_TYPE) {
    return (
      <SwitchCard
        step={step as SwitchStepConfig}
        catalog={props.stepCatalog}
        schemaCache={props.stepSchemaCache}
        schemaLoadingFor={props.stepSchemaLoadingFor}
        operators={props.operators}
        variableSources={variableSources}
        index={index + 1}
        total={config.steps.length}
        onChange={next => props.onUpdateStepAt(index, next)}
        onMoveUp={() => props.onMoveStep(index, -1)}
        onMoveDown={() => props.onMoveStep(index, 1)}
        onDelete={() => props.onDeleteStep(index)}
        issues={stepIssues}
        pathPrefix={`steps[${index}]`}
        readOnly={readOnly}
        ensureSchema={props.ensureSchema}
        renderConditionalCard={props.renderConditionalCard}
        renderSwitchCard={props.renderSwitchCard}
      />
    );
  }

  const action = step as ActionStepConfig;
  return (
    <StepCard
      step={action}
      catalogItem={props.stepCatalog.find(c => c.type === action.type) ?? null}
      schema={props.stepSchemaCache[action.type] ?? null}
      schemaLoading={props.stepSchemaLoadingFor(action.type)}
      index={index + 1}
      total={config.steps.length}
      variableSources={variableSources}
      onConfigChange={cfg => props.onStepConfigChange(index, cfg)}
      onMoveUp={() => props.onMoveStep(index, -1)}
      onMoveDown={() => props.onMoveStep(index, 1)}
      onDelete={() => props.onDeleteStep(index)}
      issues={stepIssues}
      pathPrefix={`steps[${index}].config.`}
      readOnly={readOnly}
    />
  );
}
