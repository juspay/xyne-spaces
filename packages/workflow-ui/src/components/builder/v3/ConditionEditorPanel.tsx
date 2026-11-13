import { useCallback, useEffect, useRef, useState } from 'react';
import type { Condition, LeafCondition, WorkflowConfig, OperatorDescriptor } from '@xyne/workflow-sdk/builder';
import {
  VALUE_LESS_OPERATORS,
  ConditionOperator,
} from '@xyne/workflow-sdk/builder';
import {
  isExpression,
} from '@xyne/workflow-sdk/expression';
import { useConditionEditor, type UseConditionEditorReturn } from '../../../hooks/use-condition-editor.js';
import { VariableRefInput } from './VariableRefInput.js';
import { ExpressionInput } from './ExpressionInput.js';
import { cn } from '../../shared/cn.js';

export interface ConditionEditorPanelProps {
  condition: Condition;
  onChange: (condition: Condition) => void;
  config: WorkflowConfig;
  atStepId: string;
  readOnly?: boolean | undefined;
}

export function ConditionEditorPanel({
  condition: externalCondition,
  onChange,
  config,
  atStepId,
  readOnly,
}: ConditionEditorPanelProps) {
  const skipSyncRef = useRef(false);

  const wrappedOnChange = useCallback(
    (c: Condition) => {
      skipSyncRef.current = true;
      onChange(c);
    },
    [onChange],
  );

  const editor = useConditionEditor({
    initialCondition: externalCondition,
    onChange: wrappedOnChange,
  });

  // Sync external condition changes (undo/redo) into the hook
  useEffect(() => {
    if (skipSyncRef.current) {
      skipSyncRef.current = false;
      return;
    }
    editor.setCondition(externalCondition);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalCondition]);

  return (
    <div className="space-y-2">
      <ConditionNodeRenderer
        condition={editor.condition}
        path={[]}
        operators={editor.operators}
        editor={editor}
        config={config}
        atStepId={atStepId}
        readOnly={readOnly}
        isRoot
      />
    </div>
  );
}

// ─── Type guard ───

function isLeaf(c: Condition): c is LeafCondition {
  return 'variable' in c;
}

// ─── Recursive renderer ───

interface ConditionNodeRendererProps {
  condition: Condition;
  path: number[];
  operators: readonly OperatorDescriptor[];
  editor: UseConditionEditorReturn;
  config: WorkflowConfig;
  atStepId: string;
  readOnly?: boolean | undefined;
  isRoot?: boolean | undefined;
}

function ConditionNodeRenderer({
  condition,
  path,
  operators,
  editor,
  config,
  atStepId,
  readOnly,
  isRoot,
}: ConditionNodeRendererProps) {
  if (isLeaf(condition)) {
    return (
      <LeafRow
        leaf={condition}
        path={path}
        operators={operators}
        onUpdate={(update) => editor.updateLeaf(path, update)}
        onRemove={() => editor.removeNode(path)}
        onWrapInGroup={(type) => editor.wrapInGroup(path, type)}
        config={config}
        atStepId={atStepId}
        readOnly={readOnly}
        isRoot={isRoot}
      />
    );
  }

  const groupType: 'all' | 'any' = 'all' in condition ? 'all' : 'any';
  const children = 'all' in condition ? condition.all : condition.any;

  return (
    <GroupBlock
      groupType={groupType}
      childConditions={children}
      path={path}
      operators={operators}
      editor={editor}
      config={config}
      atStepId={atStepId}
      readOnly={readOnly}
      isRoot={isRoot}
      onToggle={() => editor.toggleGroupType(path)}
      onAddLeaf={() => editor.addLeaf(path)}
      onRemove={() => editor.removeNode(path)}
    />
  );
}

// ─── Leaf Row ───

interface LeafRowProps {
  leaf: LeafCondition;
  path: number[];
  operators: readonly OperatorDescriptor[];
  onUpdate: (update: Partial<LeafCondition>) => void;
  onRemove: () => void;
  onWrapInGroup: (type: 'all' | 'any') => void;
  config: WorkflowConfig;
  atStepId: string;
  readOnly?: boolean | undefined;
  isRoot?: boolean | undefined;
}

function LeafRow({
  leaf,
  operators,
  onUpdate,
  onRemove,
  onWrapInGroup,
  config,
  atStepId,
  readOnly,
  isRoot,
}: LeafRowProps) {
  const needsValue = !VALUE_LESS_OPERATORS.has(leaf.operator);
  /** What this operator can hold against, when it insists. */
  const expects = operators.find((entry) => entry.value === leaf.operator)?.needs;

  // The left-hand side names *where* to look, so it has no literal mode — it is
  // either a reference or something worked out. Detected from the value, so
  // re-opening a condition shows what it actually holds.
  const [computing, setComputing] = useState(false);
  const isComputed = isExpression(String(leaf.variable ?? '').trim()) || computing;

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm">
      {/* What to test. A condition can compare anything, so no type is passed
          and the whole catalogue is offered. */}
      {isComputed ? (
        <ExpressionInput
          value={leaf.variable}
          onChange={(v) => onUpdate({ variable: String(v ?? '') })}
          config={config}
          atStepId={atStepId}
          // What this operator can hold against, when it insists — so a
          // comparison offers arithmetic and not text operations.
          fieldType={expects}
          disabled={readOnly}
        />
      ) : (
        <VariableRefInput
          value={leaf.variable}
          onChange={(v) => onUpdate({ variable: String(v ?? '') })}
          config={config}
          atStepId={atStepId}
          placeholder="Select variable..."
          disabled={readOnly}
          filterType={expects}
        />
      )}

      {!readOnly && (
        <button
          type="button"
          onClick={() => {
            setComputing(!isComputed);
            onUpdate({ variable: '' });
          }}
          className="text-[10px] font-medium text-indigo-500 hover:underline"
        >
          {isComputed ? 'Test a value directly' : 'Work the value out (ƒx)'}
        </button>
      )}

      {/* Operator + Value row */}
      <div className="flex items-center gap-2">
        <select
          value={leaf.operator}
          onChange={(e) => onUpdate({ operator: e.target.value as ConditionOperator })}
          disabled={readOnly}
          className={cn(
            'rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs',
            'outline-none focus:border-[var(--wui-primary)] focus:ring-1 focus:ring-[color-mix(in_srgb,var(--wui-primary)_22%,transparent)]',
            'min-w-[110px] cursor-pointer',
            readOnly && 'opacity-60 cursor-not-allowed',
          )}
        >
          {operators.length > 0 ? (
            operators.map((op) => (
              <option key={op.value} value={op.value}>
                {op.label}
              </option>
            ))
          ) : (
            // Fallback when operators haven't loaded yet
            Object.values(ConditionOperator).map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))
          )}
        </select>

        {/* What to compare against. A plain box until now, because the engine
            compared this side literally; it resolves references and
            expressions here too, so the picker belongs on it. */}
        {needsValue && (
          <div className="flex-1">
            <VariableRefInput
              value={leaf.value}
              onChange={(v) => onUpdate({ value: v })}
              config={config}
              atStepId={atStepId}
              placeholder="Value..."
              disabled={readOnly}
              compact
            />
          </div>
        )}

        {/* Actions */}
        {!readOnly && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={() => onWrapInGroup('all')}
              title="Wrap in AND group"
              className="flex h-6 w-6 items-center justify-center rounded text-slate-300 hover:text-blue-500 hover:bg-blue-50 transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </button>
            {!isRoot && (
              <button
                onClick={onRemove}
                title="Remove condition"
                className="flex h-6 w-6 items-center justify-center rounded text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Root leaf: quick-add buttons to promote to a group */}
      {isRoot && !readOnly && (
        <div className="flex gap-2 pt-1 border-t border-slate-100">
          <button
            onClick={() => onWrapInGroup('all')}
            className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-blue-500 hover:bg-blue-50 transition-colors"
          >
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            Add AND
          </button>
          <button
            onClick={() => onWrapInGroup('any')}
            className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-amber-500 hover:bg-amber-50 transition-colors"
          >
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            Add OR
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Group Block ───

interface GroupBlockProps {
  groupType: 'all' | 'any';
  childConditions: Condition[];
  path: number[];
  operators: readonly OperatorDescriptor[];
  editor: UseConditionEditorReturn;
  config: WorkflowConfig;
  atStepId: string;
  readOnly?: boolean | undefined;
  isRoot?: boolean | undefined;
  onToggle: () => void;
  onAddLeaf: () => void;
  onRemove: () => void;
}

function GroupBlock({
  groupType,
  childConditions,
  path,
  operators,
  editor,
  config,
  atStepId,
  readOnly,
  isRoot,
  onToggle,
  onAddLeaf,
  onRemove,
}: GroupBlockProps) {
  const isAll = groupType === 'all';

  return (
    <div
      className={cn(
        'rounded-lg border',
        isAll ? 'border-blue-200/80 bg-blue-50/20' : 'border-amber-200/80 bg-amber-50/20',
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 border-b',
          isAll ? 'border-blue-100/80' : 'border-amber-100/80',
        )}
      >
        <button
          onClick={readOnly ? undefined : onToggle}
          disabled={readOnly}
          className={cn(
            'rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors',
            isAll
              ? 'bg-blue-100 text-blue-600 hover:bg-blue-200'
              : 'bg-amber-100 text-amber-600 hover:bg-amber-200',
            readOnly && 'cursor-not-allowed opacity-60',
          )}
        >
          {isAll ? 'AND' : 'OR'}
        </button>
        <span className="text-[10px] text-slate-400">
          {isAll ? 'All must match' : 'Any can match'}
        </span>

        {!readOnly && !isRoot && (
          <button
            onClick={onRemove}
            title="Remove group"
            className="ml-auto flex h-5 w-5 items-center justify-center rounded text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors"
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Children */}
      <div className="space-y-2 p-2.5">
        {childConditions.map((child, i) => (
          <ConditionNodeRenderer
            key={i}
            condition={child}
            path={[...path, i]}
            operators={operators}
            editor={editor}
            config={config}
            atStepId={atStepId}
            readOnly={readOnly}
          />
        ))}

        {childConditions.length === 0 && (
          <div className="py-4 text-center text-[11px] text-slate-300">
            No conditions yet
          </div>
        )}

        {!readOnly && (
          <button
            onClick={onAddLeaf}
            className={cn(
              'flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed py-2 text-[11px] font-medium transition-colors',
              isAll
                ? 'border-blue-200 text-blue-400 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50/50'
                : 'border-amber-200 text-amber-400 hover:border-amber-300 hover:text-amber-500 hover:bg-amber-50/50',
            )}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            Add condition
          </button>
        )}
      </div>
    </div>
  );
}
