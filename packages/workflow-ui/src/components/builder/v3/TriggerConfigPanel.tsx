import { useMemo, useState } from 'react';
import type { ValidationIssue } from '@xyne/workflow-sdk';
import type {
  Condition,
  TriggerFilter,
  TriggerStart,
  WorkflowConfig,
  WorkflowRunNaming,
} from '@xyne/workflow-sdk/builder';
import { ConditionOperator, TRIGGER_FILTER_SCOPE, isDelayedStart } from '@xyne/workflow-sdk/builder';
import { TriggerCategory } from '@xyne/workflow-sdk/types';
import { useTriggerConfig } from '../../../hooks/use-trigger-config.js';
import { SchemaFormRenderer } from '../../schema-form/SchemaFormRenderer.js';
import { LoadingSpinner } from '../../shared/LoadingSpinner.js';
import { fieldErrors } from '../../../utils/issue-mapping.js';
import { getTriggerIcon } from '../icons.js';
import { ConditionEditorPanel } from './ConditionEditorPanel.js';
import { TriggerStartPanel } from './TriggerStartPanel.js';
import { FieldOptionsScopeProvider } from './field-options.js';
import type { TriggerMeta } from '../../../hooks/use-step-metadata.js';

export interface TriggerConfigPanelProps {
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  triggerMeta: TriggerMeta[];
  /** Validation issues for the trigger — field errors + summary banner. */
  issues?: ValidationIssue[] | undefined;
  onUpdateConfig: (config: Record<string, unknown>) => void;
  /** Set or clear how each run is identified. */
  onUpdateRunNaming: (runNaming: WorkflowRunNaming | undefined) => void;
  onRequestChangeTrigger: () => void;
  readOnly: boolean;
  /** Full workflow config — the filter's variable picker reads the trigger's output from it. */
  workflowConfig: WorkflowConfig;
  /** Which arriving events start a run. Absent means every event does. */
  filter?: TriggerFilter | undefined;
  /** Set the filter, or remove it with `undefined`. */
  onUpdateFilter: (filter: TriggerFilter | undefined) => void;
  /** When a matching event becomes a run. Absent means as soon as it arrives. */
  start?: TriggerStart | undefined;
  /** Set the start policy, or remove the delay with `undefined`. */
  onUpdateStart: (start: TriggerStart | undefined) => void;
  /** The saved workflow's id. A workflow that was never saved has no webhook URL yet. */
  workflowId?: string | undefined;
}

/** A new filter starts as one empty condition inside an "all" group. */
function newFilterCondition(): Condition {
  return { all: [{ variable: '', operator: ConditionOperator.EQ, value: '' }] };
}

const sectionHeading = 'mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400';

/**
 * The trigger's config panel. Keyed by trigger type, so choosing another trigger starts a fresh
 * form: the form holds its values in state, and without the key a field both triggers have (such
 * as `actions`) would carry the old trigger's selections into the new trigger's config.
 */
export function TriggerConfigPanel(props: TriggerConfigPanelProps) {
  return <TriggerConfigForm key={props.triggerType} {...props} />;
}

function TriggerConfigForm({
  triggerType,
  triggerConfig,
  triggerMeta,
  issues,
  onUpdateConfig,
  onUpdateRunNaming,
  onRequestChangeTrigger,
  readOnly,
  workflowConfig,
  filter,
  onUpdateFilter,
  start,
  onUpdateStart,
  workflowId,
}: TriggerConfigPanelProps) {
  const { fields, values, errors, setFieldValue, descriptor, isLoading } = useTriggerConfig({
    triggerType,
    initialValues: triggerConfig,
    onValuesChange: onUpdateConfig,
  });

  const mergedErrors = useMemo(
    () => ({ ...fieldErrors(issues), ...errors }),
    [issues, errors],
  );

  const currentTrigger = triggerMeta.find((t) => t.type === triggerType);

  const isWebhook = descriptor?.webhook === true;
  // Only webhook ingest and event dispatch consult the filter; a manual or cron
  // run is started on purpose and never checks it, so offering one there would mislead.
  const supportsFilter = isWebhook || descriptor?.category === TriggerCategory.EVENT;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
            {getTriggerIcon(currentTrigger?.icon, { size: 18 })}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-800">
              {descriptor?.name ?? currentTrigger?.name ?? triggerType}
            </div>
            <div className="text-[10px] text-indigo-500 uppercase tracking-wider font-medium mt-0.5">
              Trigger
            </div>
          </div>
        </div>
        {!readOnly && (
          <button
            onClick={onRequestChangeTrigger}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50 hover:border-slate-300 transition-all"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" />
            </svg>
            Change trigger
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
        {issues && issues.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3" data-testid="trigger-issues">
            <ul className="space-y-0.5 text-[12px] text-red-700">
              {issues.map((iss, i) => (
                <li key={i}>
                  {iss.location?.field && <span className="font-mono text-[11px] text-red-500">{iss.location.field}: </span>}
                  {iss.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* Config form */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner size="md" />
          </div>
        ) : fields.length > 0 ? (
          <div>
            <h4 className={sectionHeading}>Watch</h4>
            <p className="mb-3 text-[11px] text-slate-400">
              Which events this workflow follows. Checked as soon as an event arrives.
            </p>
            <FieldOptionsScopeProvider scope={{ kind: 'triggers', type: triggerType, workflowId }}>
            <SchemaFormRenderer
              fields={fields}
              values={values}
              errors={mergedErrors}
              onChange={(path, value) => setFieldValue(path, value)}
              readOnly={readOnly}
            />
            </FieldOptionsScopeProvider>
          </div>
        ) : (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 ring-1 ring-indigo-100">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="text-indigo-300" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <p className="text-[13px] font-medium text-slate-400">No configuration needed</p>
            <p className="mt-1 text-[11px] text-slate-300">This trigger works with default settings</p>
          </div>
        )}

        {!isLoading && supportsFilter && (
          <TriggerStartPanel
            start={start}
            onChange={onUpdateStart}
            workflowConfig={workflowConfig}
            readOnly={readOnly}
            error={mergedErrors['start']}
          />
        )}

        {!isLoading && supportsFilter && (
          <TriggerFilterSection
            filter={filter}
            onUpdateFilter={onUpdateFilter}
            workflowConfig={workflowConfig}
            readOnly={readOnly}
            error={mergedErrors['filter']}
            delayed={isDelayedStart(start)}
          />
        )}

        {!isLoading && isWebhook && <WebhookEndpointSection workflowId={workflowId} />}

        {!isLoading && (
          <RunIdentifierSection
            runNaming={workflowConfig.settings?.runNaming}
            onChange={onUpdateRunNaming}
            inputFields={Object.keys(
              ((triggerConfig['inputSchema'] as { properties?: Record<string, unknown> } | undefined)
                ?.properties) ?? {},
            )}
            // Only a person starting the run by hand can be asked for a name;
            // a webhook or a schedule has nobody to ask.
            canAskPerson={descriptor?.category === TriggerCategory.MANUAL}
            readOnly={readOnly}
          />
        )}
      </div>
    </div>
  );
}

type RunNamingMode = 'auto' | 'template' | 'user';

/**
 * How each run of this workflow is identified — "Loan 4521" instead of a
 * generated id — so people can find and refer to a specific run.
 */
function RunIdentifierSection({
  runNaming,
  onChange,
  inputFields,
  canAskPerson,
  readOnly,
}: {
  runNaming: WorkflowRunNaming | undefined;
  onChange: (runNaming: WorkflowRunNaming | undefined) => void;
  /** The trigger's input fields, offered as one-click template pieces. */
  inputFields: string[];
  canAskPerson: boolean;
  readOnly: boolean;
}) {
  const mode: RunNamingMode = runNaming?.mode ?? 'auto';
  const template = runNaming?.mode === 'template' ? runNaming.template : '';

  const setMode = (next: RunNamingMode) => {
    if (next === 'auto') onChange(undefined);
    else if (next === 'user') onChange({ mode: 'user' });
    else onChange({ mode: 'template', template });
  };

  return (
    <section aria-label="Workflow run identifier" className="mt-6 border-t border-slate-100 pt-4">
      <h4 className={sectionHeading}>Workflow run identifier</h4>
      <p className="mb-3 text-[11px] text-slate-400">
        The name each run is shown and searched by. Unique within this workflow.
      </p>
      <select
        aria-label="How runs are identified"
        value={mode}
        disabled={readOnly}
        onChange={(e) => { setMode(e.target.value as RunNamingMode); }}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-400 disabled:bg-slate-50"
      >
        <option value="auto">Generate automatically</option>
        <option value="template">Build from the run's inputs</option>
        {/* Kept selectable if already chosen, so switching the trigger never
            silently rewrites a saved setting. */}
        {(canAskPerson || mode === 'user') && <option value="user">Ask the person starting it</option>}
      </select>

      {mode === 'template' && (
        <div className="mt-3 space-y-2">
          <input
            aria-label="Identifier template"
            value={template}
            disabled={readOnly}
            onChange={(e) => { onChange({ mode: 'template', template: e.target.value }); }}
            placeholder="{{trigger.loanId}}-{{trigger.customer}}"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700 outline-none focus:border-indigo-400 disabled:bg-slate-50"
          />
          {inputFields.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {inputFields.map((field) => (
                <button
                  key={field}
                  type="button"
                  disabled={readOnly}
                  onClick={() => { onChange({ mode: 'template', template: `${template}{{trigger.${field}}}` }); }}
                  className="rounded bg-indigo-50 px-2 py-1 font-mono text-[10px] text-indigo-600 hover:bg-indigo-100 disabled:opacity-60"
                >
                  {field}
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-slate-400">
            Click a field to add it. A repeated name gets #1, #2… on the end.
          </p>
        </div>
      )}

      {mode === 'user' && (
        <p className="mt-2 text-[11px] text-slate-400">
          Whoever starts a run types its identifier. A name already used in this workflow is refused,
          so they can choose another. Left blank, one is generated.
        </p>
      )}
    </section>
  );
}

function TriggerFilterSection({
  filter,
  onUpdateFilter,
  workflowConfig,
  readOnly,
  error,
  delayed,
}: {
  filter: TriggerFilter | undefined;
  onUpdateFilter: (filter: TriggerFilter | undefined) => void;
  workflowConfig: WorkflowConfig;
  readOnly: boolean;
  error: string | undefined;
  /** Whether the binding waits — which changes WHEN these are judged, and how a miss looks. */
  delayed: boolean;
}) {
  const conditions = filter?.conditions;
  return (
    <section aria-label="Only run if">
      <h4 className={sectionHeading}>Only run if</h4>
      <p className="mb-3 text-[11px] text-slate-400">
        {delayed
          ? 'Checked when the run starts, not when the event arrives — so this reads the world as it is by then. A run that no longer matches is skipped, and says why.'
          : 'Start a run only for events that match. Events that don’t match are ignored.'}
      </p>
      {conditions ? (
        <div className="space-y-2">
          <ConditionEditorPanel
            condition={conditions}
            onChange={(c) => onUpdateFilter({ conditions: c })}
            config={workflowConfig}
            atStepId={TRIGGER_FILTER_SCOPE}
            readOnly={readOnly}
          />
          {!readOnly && (
            <button
              type="button"
              onClick={() => onUpdateFilter(undefined)}
              className="text-[11px] font-medium text-slate-500 transition-colors hover:text-red-600"
            >
              Remove conditions
            </button>
          )}
        </div>
      ) : readOnly ? (
        <p className="text-[12px] text-slate-500">
          {delayed ? 'No conditions. The run acts whenever it wakes.' : 'No conditions. Every event starts a run.'}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => onUpdateFilter({ conditions: newFilterCondition() })}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-[12px] font-medium text-slate-500 transition-colors hover:border-slate-400 hover:bg-slate-50"
        >
          Add condition
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[11px] text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}

function WebhookEndpointSection({ workflowId }: { workflowId: string | undefined }) {
  const [copied, setCopied] = useState(false);

  const copy = (id: string) => {
    void navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <section aria-label="Endpoint">
      <h4 className={`${sectionHeading} mb-2`}>Endpoint</h4>
      {workflowId ? (
        <div>
          <div className="mb-1 text-[11px] font-medium text-slate-500">Workflow ID</div>
          <div className="flex items-stretch gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 font-mono text-[11px] text-slate-700">
              {workflowId}
            </code>
            <button
              type="button"
              onClick={() => copy(workflowId)}
              className="shrink-0 rounded-lg border border-slate-200 px-3 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[12px] text-slate-500">Save the workflow to get its ID.</p>
      )}
    </section>
  );
}
