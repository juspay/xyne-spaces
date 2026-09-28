import { useEffect, useRef } from 'react';
import { Eye, Pencil, X } from 'lucide-react';
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

/**
 * What the drawer is editing. Steps are addressed by their stable `id`, never
 * by array index, so moving or deleting steps can't retarget an open editor.
 */
export type DrawerSelection =
  | { kind: 'trigger' | 'schedule' | 'conditions' }
  | { kind: 'step'; stepId: string };

export interface AutomationConfigDrawerProps {
  selection: DrawerSelection;
  onClose: () => void;
  config: AutomationConfig;
  editMode: boolean;
  /** Enters edit mode through the same confirm/propose flow as Builder Mode. */
  onRequestEdit?: (() => void) | undefined;
  /** Label for {@link onRequestEdit}: "Edit" or "Propose change". */
  editActionLabel?: string | undefined;
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

/** Index of the selected step in `config.steps`, or -1 if it no longer exists. */
export function resolveStepIndex(config: AutomationConfig, selection: DrawerSelection): number {
  if (selection.kind !== 'step') return -1;
  return config.steps.findIndex(s => s.id === selection.stepId);
}

function describeSelection(
  props: AutomationConfigDrawerProps,
  index: number,
): { kicker: string; title: string } {
  const { selection, config } = props;
  if (selection.kind === 'trigger') {
    return { kicker: 'Trigger', title: 'When this happens' };
  }
  if (selection.kind === 'schedule') return { kicker: 'Timing', title: 'When to run' };
  if (selection.kind === 'conditions') {
    return { kicker: 'Conditions', title: 'Only run when' };
  }
  const step = config.steps[index];
  const kicker = `Step ${index + 1} of ${config.steps.length}`;
  if (!step) return { kicker, title: 'Step' };
  if (step.type === CONDITIONAL_STEP_TYPE) return { kicker, title: 'If / else' };
  if (step.type === SWITCH_STEP_TYPE) return { kicker, title: 'Switch' };
  return {
    kicker,
    title: props.stepCatalog.find(c => c.type === step.type)?.name ?? step.type,
  };
}

/**
 * Right-docked editor for the selected canvas node. It renders the SAME form
 * components used by Builder Mode against the same `config`/handlers, so no
 * business logic is duplicated and Graph Mode has full feature parity by
 * construction. In view mode the form subtree is `inert` (mirroring Builder's
 * locked body) and the user is offered the same Edit / Propose change entry.
 */
export function AutomationConfigDrawer(props: AutomationConfigDrawerProps): React.ReactElement {
  const { selection, editMode, onClose } = props;
  const readOnly = !editMode;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const index = resolveStepIndex(props.config, selection);
  const { kicker, title } = describeSelection(props, index);
  const selectionKey = selection.kind === 'step' ? selection.stepId : selection.kind;

  // Move focus into the panel whenever a different node is opened so keyboard
  // and screen-reader users land on the editor they just asked for.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [selectionKey]);

  return (
    <aside
      aria-labelledby='automation-graph-drawer-title'
      data-slot='automation-graph-drawer'
      className={cn(
        'flex h-full shrink-0 flex-col border-l border-border bg-background',
        'absolute inset-y-0 right-0 z-10 w-full max-w-[480px] shadow-xl',
        'md:static md:w-[420px] md:shadow-none xl:w-[480px]',
        'animate-in slide-in-from-right-4 fade-in-0 duration-150',
      )}
    >
      <header className='flex items-start justify-between gap-3 border-b border-border px-5 py-3.5'>
        <div className='flex min-w-0 flex-col gap-0.5'>
          <span className='text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground'>
            {kicker}
          </span>
          <h2
            ref={headingRef}
            id='automation-graph-drawer-title'
            tabIndex={-1}
            className='truncate text-sm font-semibold text-foreground focus:outline-none'
          >
            {title}
          </h2>
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          {readOnly && (
            <span className='flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground'>
              <Eye className='size-3' aria-hidden='true' />
              View only
            </span>
          )}
          <button
            type='button'
            onClick={onClose}
            aria-label='Close configuration panel (Esc)'
            title='Close (Esc)'
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
      </header>
      {readOnly && props.onRequestEdit && (
        <div className='flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-5 py-2.5'>
          <span className='text-xs text-muted-foreground'>Changes are locked while viewing.</span>
          <button
            type='button'
            onClick={props.onRequestEdit}
            data-track-category='automation-graph'
            data-track-name='config-drawer-edit'
            className={cn(
              'flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground',
              'hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40',
            )}
          >
            <Pencil className='size-3' aria-hidden='true' />
            {props.editActionLabel ?? 'Edit'}
          </button>
        </div>
      )}
      <div className='min-h-0 flex-1 overflow-y-auto px-5 py-4'>
        <div
          aria-readonly={readOnly}
          // Same lock as Builder's read-only body: `inert` removes the subtree
          // from pointer, focus and keyboard interaction, so a saved automation
          // can't be edited from the drawer without going through Edit.
          inert={readOnly}
          className={cn(readOnly && 'select-none opacity-90')}
        >
          {renderBody(props, readOnly, index)}
        </div>
        {selection.kind === 'trigger' && props.config.trigger.type === 'WEBHOOK' && (
          // Outside the lock: copying the endpoint URL is a read action.
          <div className='mt-4'>
            <WebhookEndpointPanel automationId={props.savedId} />
          </div>
        )}
      </div>
    </aside>
  );
}

function renderBody(
  props: AutomationConfigDrawerProps,
  readOnly: boolean,
  index: number,
): React.ReactElement {
  const { selection, config } = props;

  if (selection.kind === 'trigger') {
    return (
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
  const common = {
    index: index + 1,
    total: config.steps.length,
    variableSources,
    onMoveUp: () => props.onMoveStep(index, -1),
    onMoveDown: () => props.onMoveStep(index, 1),
    onDelete: () => props.onDeleteStep(index),
    issues: stepIssues,
    readOnly,
  };

  if (step.type === CONDITIONAL_STEP_TYPE || step.type === SWITCH_STEP_TYPE) {
    const controlProps = {
      ...common,
      catalog: props.stepCatalog,
      schemaCache: props.stepSchemaCache,
      schemaLoadingFor: props.stepSchemaLoadingFor,
      operators: props.operators,
      onChange: (next: AutomationStepConfig) => props.onUpdateStepAt(index, next),
      pathPrefix: `steps[${index}]`,
      ensureSchema: props.ensureSchema,
      renderConditionalCard: props.renderConditionalCard,
      renderSwitchCard: props.renderSwitchCard,
    };
    return step.type === CONDITIONAL_STEP_TYPE ? (
      <ConditionalCard step={step as ConditionalStepConfig} {...controlProps} />
    ) : (
      <SwitchCard step={step as SwitchStepConfig} {...controlProps} />
    );
  }

  const action = step as ActionStepConfig;
  return (
    <StepCard
      {...common}
      step={action}
      catalogItem={props.stepCatalog.find(c => c.type === action.type) ?? null}
      schema={props.stepSchemaCache[action.type] ?? null}
      schemaLoading={props.stepSchemaLoadingFor(action.type)}
      onConfigChange={cfg => props.onStepConfigChange(index, cfg)}
      pathPrefix={`steps[${index}].config.`}
    />
  );
}
