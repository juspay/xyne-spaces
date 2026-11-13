import { useMemo } from 'react';
import type { WorkflowConfig, WorkflowStepConfig, Condition, StepGroup, Citation } from '@xyne/workflow-sdk/builder';
import type { ValidationIssue } from '@xyne/workflow-sdk';
import { ConditionOperator } from '@xyne/workflow-sdk/builder';
import { useStepConfig } from '../../../hooks/use-step-config.js';
import { fieldErrors } from '../../../utils/issue-mapping.js';
import { detectBranchesFromConfig } from '../../../utils/branch-detection.js';
import { EnhancedSchemaFormRenderer } from './EnhancedSchemaFormRenderer.js';
import { FieldOptionsScopeProvider } from './field-options.js';
import { ConditionEditorPanel } from './ConditionEditorPanel.js';
import { SwitchCaseEditor, type SwitchCase } from './SwitchCaseEditor.js';
import { LoadingSpinner } from '../../shared/LoadingSpinner.js';
import { cn } from '../../shared/cn.js';
import { getCategoryTheme } from '../theme.js';
import { getStepIcon } from '../icons.js';

function defaultCondition(): Condition {
  return { variable: '', operator: ConditionOperator.EQ, value: '' };
}

export interface StepConfigPanelProps {
  step: WorkflowStepConfig;
  config: WorkflowConfig;
  category?: string | undefined;
  icon?: string | undefined;
  onUpdateConfig: (config: Record<string, unknown>) => void;
  /** Update the step's documentation fields (alias title/description, group membership). */
  onUpdateMeta?: (meta: { title?: string; description?: string; groupId?: string | null }) => void;
  /** Existing step groups (for the group selector). */
  groups?: StepGroup[] | undefined;
  /** Create/update a group (used when creating a new group or editing its title). */
  onUpsertGroup?: (group: StepGroup) => void;
  /** Add an author citation to a field (step-scoped). Enables per-field "source" controls. */
  onAddCitation?: (fieldPath: string, citation: Citation) => void;
  /** Remove a citation under a stable CitationPath (step-scoped). */
  onRemoveCitation?: (citationPath: string, index: number) => void;
  /** Validation issues for this step — field errors + a summary banner. */
  issues?: ValidationIssue[] | undefined;
  onDelete: () => void;
  onDuplicate: () => void;
  /** Put a new step directly above this one. */
  onAddAbove: () => void;
  onToggleDisabled: () => void;
  readOnly: boolean;
  /** The saved workflow's id — a picker reads data for that workflow's workspace. */
  workflowId?: string | undefined;
}

function genGroupId(): string {
  return `group_${Math.random().toString(36).slice(2, 8)}`;
}

function formatTypeName(type: string): string {
  return type
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function StepConfigPanel({
  step,
  config,
  category,
  icon,
  onUpdateConfig,
  onUpdateMeta,
  groups,
  onUpsertGroup,
  onAddCitation,
  onRemoveCitation,
  issues,
  onDelete,
  onDuplicate,
  onAddAbove,
  onToggleDisabled,
  readOnly,
  workflowId,
}: StepConfigPanelProps) {
  const isConditional = step.type === 'CONDITIONAL';
  const isSwitch = step.type === 'SWITCH';
  const hasSpecialEditor = isConditional || isSwitch;

  const { fields, values, errors, setFieldValue, descriptor, isLoading } = useStepConfig({
    stepType: step.type,
    initialValues: (step.config as Record<string, unknown>) ?? {},
    onValuesChange: hasSpecialEditor ? () => {} : onUpdateConfig,
  });

  // Merge validator field errors with the form's local (required) errors.
  const mergedErrors = useMemo(
    () => ({ ...fieldErrors(issues), ...errors }),
    [issues, errors],
  );

  const theme = getCategoryTheme(category);
  const displayName = descriptor?.name ?? formatTypeName(step.type);
  const isDisabled = !!(step as unknown as Record<string, unknown>)['disabled'];
  const stepConfig = (step.config as Record<string, unknown>) ?? {};

  // Detect branch-related config keys so we can hide them from the form
  // (branches are already managed visually in the tree)
  const branchTopKeys = useMemo(() => {
    const branches = detectBranchesFromConfig(stepConfig, descriptor?.configSchema);
    return new Set(Object.keys(branches).map((k) => k.split('.')[0]));
  }, [stepConfig, descriptor?.configSchema]);

  const visibleFields = useMemo(
    () => fields.filter((f) => !branchTopKeys.has(f.path)),
    [fields, branchTopKeys],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            theme.iconBg, theme.iconText,
          )}>
            {getStepIcon(icon, { size: 18 })}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-800">
              {displayName}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={cn('h-1.5 w-1.5 rounded-full', theme.dot)} />
              <span className="text-[10px] text-slate-400 uppercase tracking-wide">
                {category ?? step.type}
              </span>
            </div>
          </div>
        </div>

        {/* Step ID reference hint */}
        <div className="mt-3 flex items-center gap-2 rounded-md bg-slate-50 px-3 py-1.5">
          <span className="text-[10px] text-slate-400 font-medium">Ref</span>
          <code className="text-[11px] font-mono text-indigo-500 select-all">
            {`{{${step.id}.output}}`}
          </code>
        </div>
      </div>

      {/* Config form */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {/* Validation issues summary for this step */}
        {issues && issues.length > 0 && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3" data-testid="step-issues">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-red-600">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" />
              </svg>
              {issues.length} {issues.length === 1 ? 'issue' : 'issues'}
            </div>
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

        {/* Annotations: alias title/description + group */}
        {onUpdateMeta && !readOnly && (
          <div className="mb-5 space-y-3 rounded-lg border border-slate-100 bg-slate-50/50 p-3">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Annotations
            </h4>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-500">Title</label>
              <input
                type="text"
                value={step.title ?? ''}
                onChange={(e) => onUpdateMeta({ title: e.target.value })}
                placeholder={displayName}
                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-800 placeholder:text-slate-400 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-500">Description</label>
              <textarea
                value={step.description ?? ''}
                onChange={(e) => onUpdateMeta({ description: e.target.value })}
                rows={2}
                placeholder="What this step does…"
                className="w-full resize-y rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-800 placeholder:text-slate-400 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-slate-500">Group</label>
              <select
                value={step.groupId ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '__new__') {
                    const id = genGroupId();
                    onUpsertGroup?.({ id, title: 'New Group' });
                    onUpdateMeta({ groupId: id });
                  } else {
                    onUpdateMeta({ groupId: v || null });
                  }
                }}
                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-800 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100"
              >
                <option value="">No group</option>
                {(groups ?? []).map((g) => (
                  <option key={g.id} value={g.id}>{g.title}</option>
                ))}
                <option value="__new__">＋ Create group…</option>
              </select>
              {step.groupId && onUpsertGroup && (() => {
                const current = (groups ?? []).find((g) => g.id === step.groupId);
                return current ? (
                  <div className="mt-2 space-y-1.5 rounded-md border border-slate-200 bg-white p-2">
                    <span className="block text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      Group details
                    </span>
                    <input
                      type="text"
                      value={current.title}
                      onChange={(e) => onUpsertGroup({ ...current, title: e.target.value })}
                      placeholder="Group title"
                      className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-800 placeholder:text-slate-400 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100"
                    />
                    <textarea
                      value={current.description ?? ''}
                      onChange={(e) => onUpsertGroup({ ...current, description: e.target.value })}
                      rows={2}
                      placeholder="What this group of steps does…"
                      className="w-full resize-y rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-800 placeholder:text-slate-400 outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100"
                    />
                  </div>
                ) : null;
              })()}
            </div>
          </div>
        )}
        {isConditional ? (
          <div>
            <h4 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Condition
            </h4>
            <p className="mb-3 text-[11px] text-slate-400">
              Define when the true branch executes
            </p>
            <ConditionEditorPanel
              condition={(stepConfig['condition'] as Condition) ?? defaultCondition()}
              onChange={(c) => onUpdateConfig({ ...stepConfig, condition: c })}
              config={config}
              atStepId={step.id}
              readOnly={readOnly}
            />
          </div>
        ) : isSwitch ? (
          <div>
            <h4 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Switch Cases
            </h4>
            <p className="mb-3 text-[11px] text-slate-400">
              Route to the first matching case
            </p>
            <SwitchCaseEditor
              cases={(stepConfig['cases'] as SwitchCase[]) ?? []}
              onChange={(c) => onUpdateConfig({ ...stepConfig, cases: c })}
              config={config}
              atStepId={step.id}
              readOnly={readOnly}
            />
          </div>
        ) : isLoading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner size="md" />
          </div>
        ) : visibleFields.length > 0 ? (
          <div>
            <h4 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Configuration
            </h4>
            {/* The picker needs to know who owns the field and whose data to
                read; both are known here and nowhere deeper. */}
            <FieldOptionsScopeProvider
              scope={{ kind: 'steps', type: step.type, workflowId }}
            >
            <EnhancedSchemaFormRenderer
              fields={visibleFields}
              values={values}
              errors={mergedErrors}
              onChange={(path, value) => setFieldValue(path, value)}
              config={config}
              atStepId={step.id}
              readOnly={readOnly}
              citations={(step as { citations?: Record<string, Citation[]> }).citations}
              onAddCitation={onAddCitation}
              onRemoveCitation={onRemoveCitation}
            />
            </FieldOptionsScopeProvider>
          </div>
        ) : (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-slate-50 ring-1 ring-slate-100">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="text-slate-300" strokeLinecap="round">
                <path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="10" />
              </svg>
            </div>
            <p className="text-[13px] font-medium text-slate-400">No configuration needed</p>
            <p className="mt-1 text-[11px] text-slate-300">This step works with default settings</p>
          </div>
        )}
      </div>

      {/* Footer actions */}
      {!readOnly && (
        <div className="flex gap-2 border-t border-slate-100 px-5 py-3">
          <button
            onClick={onToggleDisabled}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-medium transition-all',
              isDisabled
                ? 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                : 'border-slate-200 text-slate-500 hover:bg-slate-50 hover:border-slate-300',
            )}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {isDisabled
                ? <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>
                : <><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" x2="22" y1="2" y2="22" /></>}
            </svg>
            {isDisabled ? 'Enable' : 'Disable'}
          </button>
          <button
            onClick={onAddAbove}
            title="Insert a step directly above this one"
            className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[12px] font-medium text-slate-500 hover:bg-slate-50 hover:border-slate-300 transition-all"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5" /><path d="m5 12 7-7 7 7" />
            </svg>
            Add above
          </button>
          <button
            onClick={onDuplicate}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[12px] font-medium text-slate-500 hover:bg-slate-50 hover:border-slate-300 transition-all"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="13" height="13" x="9" y="9" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Duplicate
          </button>
          <button
            onClick={onDelete}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-red-200/60 px-3 py-2 text-[12px] font-medium text-red-500 hover:bg-red-50 hover:border-red-300 transition-all ml-auto"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
