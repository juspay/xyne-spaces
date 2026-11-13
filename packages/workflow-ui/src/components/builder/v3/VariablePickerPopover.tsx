import { useMemo, useState } from 'react';
import type { WorkflowConfig, WorkflowStepConfig } from '@xyne/workflow-sdk/builder';
import { useVariablePicker, type VariableNode } from '../../../hooks/use-variable-picker.js';
import { useStepMetadata } from '../../../hooks/use-step-metadata.js';
import { LoadingSpinner } from '../../shared/LoadingSpinner.js';
import { cn } from '../../shared/cn.js';

export interface VariablePickerPopoverProps {
  config: WorkflowConfig;
  atStepId: string;
  /** Restrict suggestions to refs of this schema type. */
  filterType?: string | undefined;
  onSelect: (refString: string, schemaType?: string) => void;
  onClose: () => void;
}

const TYPE_BADGES: Record<string, { label: string; className: string }> = {
  string:  { label: 'str',  className: 'bg-emerald-50 text-emerald-600' },
  number:  { label: 'num',  className: 'bg-sky-50 text-sky-600' },
  integer: { label: 'int',  className: 'bg-sky-50 text-sky-600' },
  boolean: { label: 'bool', className: 'bg-amber-50 text-amber-600' },
  array:   { label: 'arr',  className: 'bg-violet-50 text-violet-600' },
  object:  { label: 'obj',  className: 'bg-slate-100 text-slate-500' },
};

function TypeBadge({ type }: { type: string }) {
  const badge = TYPE_BADGES[type] ?? { label: type, className: 'bg-slate-100 text-slate-500' };
  return (
    <span className={cn('rounded px-1 py-0.5 text-[8px] font-bold uppercase', badge.className)}>
      {badge.label}
    </span>
  );
}

function VariableTreeNode({
  node,
  onSelect,
  depth = 0,
}: {
  node: VariableNode;
  onSelect: (refString: string, schemaType?: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 1);

  if (node.isLeaf) {
    return (
      <button
        onClick={() => onSelect(node.refString, node.schemaType)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-indigo-50 active:scale-[0.99]"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <span className="truncate text-[11px] font-mono text-slate-700">{node.label}</span>
        <TypeBadge type={node.schemaType} />
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-slate-50"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={cn('shrink-0 text-slate-400 transition-transform', expanded && 'rotate-90')}
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        <span className="truncate text-[11px] font-semibold text-slate-600">{node.label}</span>
        <TypeBadge type={node.schemaType} />
      </button>
      {expanded && (
        <div>
          {node.children.map((child) => (
            <VariableTreeNode key={child.path} node={child} onSelect={onSelect} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Recursively collect step ID → type from config (including nested branches/bodies).
 */
function collectStepTypes(steps: WorkflowStepConfig[], map: Map<string, string>) {
  for (const s of steps) {
    map.set(s.id, s.type);
    if (s.config && typeof s.config === 'object') {
      const cfg = s.config as Record<string, unknown>;
      const branches = cfg['branches'];
      if (branches && typeof branches === 'object' && !Array.isArray(branches)) {
        for (const branch of Object.values(branches as Record<string, unknown>)) {
          if (Array.isArray(branch)) collectStepTypes(branch as WorkflowStepConfig[], map);
        }
      }
      if (Array.isArray(cfg['body'])) {
        collectStepTypes(cfg['body'] as WorkflowStepConfig[], map);
      }
    }
  }
}

export function VariablePickerPopover({
  config,
  atStepId,
  filterType,
  onSelect,
  onClose,
}: VariablePickerPopoverProps) {
  const [query, setQuery] = useState('');
  const { stepMeta } = useStepMetadata(config);

  // Build step ID → display name map from config + metadata
  const stepLabelMap = useMemo(() => {
    const typeMap = new Map<string, string>();
    collectStepTypes(config.steps, typeMap);

    const labelMap = new Map<string, string>();
    for (const [id, type] of typeMap) {
      const meta = stepMeta.get(type);
      labelMap.set(id, meta?.name ?? type);
    }
    return labelMap;
  }, [config.steps, stepMeta]);

  const { variables, isLoading, search } = useVariablePicker({
    config,
    atStepId,
    enabled: true,
    stepLabelMap,
    ...(filterType ? { filterType } : {}),
  });

  const displayItems = query ? search(query) : null;

  return (
    <div
      className={cn(
        'absolute right-0 top-full z-30 mt-1 w-72 rounded-xl border border-slate-200/80 bg-white shadow-xl',
        'animate-[wui-scale-in_150ms_ease-out]',
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-slate-400">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search variables..."
          autoFocus
          className="flex-1 bg-transparent text-[11px] text-slate-700 placeholder:text-slate-400 outline-none"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') onClose();
          }}
        />
        <button
          onClick={onClose}
          className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:text-slate-600 transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="max-h-60 overflow-y-auto p-1.5">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <LoadingSpinner size="sm" />
          </div>
        ) : displayItems ? (
          // Search results (flat list)
          displayItems.length > 0 ? (
            displayItems.map((node) => (
              <button
                key={node.path}
                onClick={() => { onSelect(node.refString, node.schemaType); onClose(); }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-indigo-50"
              >
                <div className="flex-1 min-w-0">
                  <span className="block truncate text-[11px] font-medium text-slate-700">{node.label}</span>
                  <span className="block truncate text-[9px] font-mono text-slate-400">{node.path}</span>
                </div>
                <TypeBadge type={node.schemaType} />
              </button>
            ))
          ) : (
            <div className="py-4 text-center text-[11px] text-slate-400">No matching variables</div>
          )
        ) : variables.length > 0 ? (
          // Tree view
          variables.map((node) => (
            <VariableTreeNode key={node.path} node={node} onSelect={(ref, schemaType) => { onSelect(ref, schemaType); onClose(); }} />
          ))
        ) : (
          <div className="py-4 text-center text-[11px] text-slate-400">
            No variables available at this step
          </div>
        )}
      </div>
    </div>
  );
}
