import { useEffect, useMemo, useRef, useState } from 'react';
import { Variable, X } from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import { Popover } from '../../../ui/Popover/Popover';
import { VariablePicker } from '../VariablePicker/VariablePicker';
import {
  findSoleMatchingVariable,
  formatReferenceLabel,
} from '../VariablePicker/VariablePicker.utils';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';

export function useSeedSoleVariable(
  value: string | undefined,
  onChange: (next: string | undefined) => void,
  sources: VariablePickerSource[],
  targetEntityKind?: string | null,
): void {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const settledRef = useRef(false);
  const attemptsRef = useRef(0);

  useEffect(() => {
    if (settledRef.current) return;
    const isSet = value !== undefined && value !== null && value !== '';
    if (isSet) {
      settledRef.current = true;
      return;
    }
    if (!targetEntityKind || sources.length === 0 || attemptsRef.current >= 10) return;
    const sole = findSoleMatchingVariable(sources, targetEntityKind);
    if (!sole) return;
    attemptsRef.current += 1;
    onChangeRef.current(sole.reference);
  }, [value, sources, targetEntityKind]);
}

/**
 * Canonical "selected variable" chip. Shown wherever a field currently holds a
 * `{{...}}` reference. Single source of truth — reused by SchemaForm and every
 * step/trigger field component.
 */
export function ReferenceChip({
  value,
  sources,
  onClear,
}: {
  value: string;
  sources: VariablePickerSource[];
  onClear: () => void;
}): React.ReactElement {
  const label = formatReferenceLabel(value, sources);
  return (
    <div className='inline-flex items-center gap-2 self-start rounded-md border border-border bg-accent/30 px-2 py-1 text-xs text-foreground'>
      <Variable className='size-3 text-muted-foreground' />
      <span className='font-medium'>{label}</span>
      <button
        type='button'
        onClick={onClear}
        data-track-category='automation-builder'
        data-track-name='schema-form-detach-variable'
        className='ml-1 rounded-sm p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent/60'
        aria-label='Detach variable'
      >
        <X className='size-3' />
      </button>
    </div>
  );
}

export function UseVariableButton({
  sources,
  onPick,
  targetEntityKind,
  targetLeafType,
  modal = false,
}: {
  sources: VariablePickerSource[];
  onPick: (reference: string) => void;
  targetEntityKind?: string | null;
  targetLeafType?: string | null;
  modal?: boolean;
}): React.ReactElement {
  const [open, setOpen] = useState(false);

  const soleMatch = useMemo(
    () => findSoleMatchingVariable(sources, targetEntityKind ?? null, targetLeafType ?? null),
    [sources, targetEntityKind, targetLeafType],
  );

  const triggerButton = (
    <button
      type='button'
      aria-label='Use variable'
      data-track-category='automation-builder'
      data-track-name='use-variable-open'
      onClick={
        soleMatch
          ? (e): void => {
              e.preventDefault();
              e.stopPropagation();
              onPick(soleMatch.reference);
            }
          : undefined
      }
      className={cn(
        'mt-1 flex h-8 w-8 items-center justify-center rounded-md border border-border',
        'text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors',
      )}
    >
      <Variable className='size-4' />
    </button>
  );

  if (soleMatch) return triggerButton;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align='end'
      side='bottom'
      sideOffset={4}
      modal={modal}
      className='rounded-xl p-0 overflow-hidden'
      trigger={triggerButton}
    >
      <VariablePicker
        sources={sources}
        onSelect={entry => onPick(entry.reference)}
        onClose={() => setOpen(false)}
        targetEntityKind={targetEntityKind ?? null}
        targetLeafType={targetLeafType ?? null}
      />
    </Popover>
  );
}
