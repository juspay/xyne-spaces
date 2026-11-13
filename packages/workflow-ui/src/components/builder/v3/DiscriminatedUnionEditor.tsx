import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import type { SchemaFormField } from '../../../hooks/use-schema-form.js';
import { cn } from '../../shared/cn.js';

export interface DiscriminatedUnionEditorProps {
  field: SchemaFormField;
  value: Record<string, unknown> | undefined;
  onChange: (value: Record<string, unknown>) => void;
  config: WorkflowConfig;
  atStepId: string;
  readOnly?: boolean | undefined;
  /** Render function for variant sub-fields — provided by the parent renderer */
  renderField: (
    field: SchemaFormField,
    value: unknown,
    onChange: (value: unknown) => void,
  ) => React.ReactNode;
}

// Icons for well-known discriminator values
const VARIANT_ICONS: Record<string, React.ReactNode> = {
  set: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" /><path d="m8 11 4 4 4-4" /><path d="M8 21h8" />
    </svg>
  ),
  rename: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 3h5v5" /><path d="M8 3H3v5" /><path d="m21 3-8.5 8.5" /><path d="m3 3 8.5 8.5" /><path d="M3 21h18" />
    </svg>
  ),
  remove: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  ),
  copy: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="13" height="13" x="9" y="9" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  delay: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
    </svg>
  ),
  webhook: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 16.98h1a2 2 0 0 0 1.7-3.08L13.4 2a2 2 0 0 0-3.5.1L2.3 13.9A2 2 0 0 0 4 16.98h1" /><path d="m6 17 6 4 6-4" />
    </svg>
  ),
  approval: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
};

const VARIANT_DESCRIPTIONS: Record<string, string> = {
  set: 'Write a value at a path',
  rename: 'Move a value between paths',
  remove: 'Delete a value at a path',
  copy: 'Duplicate a value to a new path',
  delay: 'Wait for a fixed duration',
  webhook: 'Wait for an external callback',
  approval: 'Wait for manual approval',
};

const VARIANT_COLORS: Record<string, { bg: string; border: string; text: string; activeBg: string; activeBorder: string }> = {
  set: { bg: 'bg-sky-50', border: 'border-sky-100', text: 'text-sky-700', activeBg: 'bg-sky-100', activeBorder: 'border-sky-300' },
  rename: { bg: 'bg-amber-50', border: 'border-amber-100', text: 'text-amber-700', activeBg: 'bg-amber-100', activeBorder: 'border-amber-300' },
  remove: { bg: 'bg-rose-50', border: 'border-rose-100', text: 'text-rose-700', activeBg: 'bg-rose-100', activeBorder: 'border-rose-300' },
  copy: { bg: 'bg-violet-50', border: 'border-violet-100', text: 'text-violet-700', activeBg: 'bg-violet-100', activeBorder: 'border-violet-300' },
  delay: { bg: 'bg-slate-50', border: 'border-slate-100', text: 'text-slate-700', activeBg: 'bg-slate-100', activeBorder: 'border-slate-300' },
  webhook: { bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-700', activeBg: 'bg-emerald-100', activeBorder: 'border-emerald-300' },
  approval: { bg: 'bg-indigo-50', border: 'border-indigo-100', text: 'text-indigo-700', activeBg: 'bg-indigo-100', activeBorder: 'border-indigo-300' },
};

const DEFAULT_COLOR = { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-700', activeBg: 'bg-slate-100', activeBorder: 'border-slate-400' };

export function DiscriminatedUnionEditor({
  field,
  value,
  onChange,
  readOnly,
  renderField,
}: DiscriminatedUnionEditorProps) {
  const disc = field.discriminator!;
  const currentValue = (value ?? field.defaultValue ?? {}) as Record<string, unknown>;
  const selectedVariant = String(currentValue[disc.field] ?? '');
  const variantKeys = Object.keys(disc.variants);
  const variantFields = disc.variants[selectedVariant] ?? [];

  const handleVariantChange = (newVariant: string) => {
    const next: Record<string, unknown> = { [disc.field]: newVariant };
    const newFields = disc.variants[newVariant] ?? [];
    for (const f of newFields) {
      if (f.defaultValue !== undefined) next[f.path.split('.').pop()!] = f.defaultValue;
    }
    onChange(next);
  };

  const handleFieldChange = (fieldPath: string, fieldValue: unknown) => {
    const key = fieldPath.split('.').pop()!;
    onChange({ ...currentValue, [key]: fieldValue });
  };

  // Use card-style selector for <= 6 variants, dropdown for more
  const useCards = variantKeys.length <= 6;

  return (
    <div className="space-y-3">
      {/* Variant selector */}
      {useCards ? (
        <div className={cn(
          'grid gap-1.5',
          variantKeys.length <= 3 ? 'grid-cols-1' : 'grid-cols-2',
        )}>
          {variantKeys.map((v) => {
            const isActive = v === selectedVariant;
            const colors = VARIANT_COLORS[v] ?? DEFAULT_COLOR;
            const icon = VARIANT_ICONS[v];
            const desc = VARIANT_DESCRIPTIONS[v];

            return (
              <button
                key={v}
                type="button"
                onClick={() => !readOnly && handleVariantChange(v)}
                disabled={readOnly}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-all',
                  isActive
                    ? `${colors.activeBg} ${colors.activeBorder} ring-1 ring-offset-0 ${colors.activeBorder.replace('border-', 'ring-')}`
                    : `${colors.bg} ${colors.border} hover:${colors.activeBg} hover:${colors.activeBorder}`,
                  readOnly && 'opacity-60 cursor-not-allowed',
                )}
              >
                {/* Selection indicator */}
                <div className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                  isActive
                    ? `${colors.activeBorder} bg-white`
                    : 'border-slate-300 bg-white',
                )}>
                  {isActive && (
                    <div className={cn('h-2 w-2 rounded-full', colors.text.replace('text-', 'bg-'))} />
                  )}
                </div>

                {/* Icon */}
                {icon && (
                  <span className={cn('shrink-0', isActive ? colors.text : 'text-slate-400')}>
                    {icon}
                  </span>
                )}

                {/* Label + description */}
                <div className="min-w-0">
                  <div className={cn(
                    'text-[12px] font-semibold capitalize',
                    isActive ? colors.text : 'text-slate-600',
                  )}>
                    {v}
                  </div>
                  {desc && (
                    <div className="text-[10px] text-slate-400 leading-tight mt-0.5">
                      {desc}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <select
          value={selectedVariant}
          onChange={(e) => handleVariantChange(e.target.value)}
          disabled={readOnly}
          className={cn(
            'w-full rounded-lg border px-3 py-2 text-sm',
            'bg-white outline-none transition-all',
            'border-[var(--wui-border)] focus:border-[var(--wui-primary)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--wui-primary)_12%,transparent)]',
            readOnly && 'opacity-60 cursor-not-allowed bg-[var(--wui-bg-subtle)]',
          )}
        >
          {!selectedVariant && <option value="">Select...</option>}
          {variantKeys.map((v) => (
            <option key={v} value={v}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </option>
          ))}
        </select>
      )}

      {/* Variant-specific fields */}
      {selectedVariant && variantFields.length > 0 && (
        <div className={cn(
          'space-y-3 rounded-lg border border-slate-100 bg-slate-50/50 p-3',
        )}>
          {variantFields.map((vf) => {
            const key = vf.path.split('.').pop()!;
            const fieldValue = currentValue[key];
            return (
              <div key={vf.path}>
                {renderField(vf, fieldValue, (val) => handleFieldChange(vf.path, val))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
