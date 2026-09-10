/**
 * The date filter's vocabulary and its calendar sheet. `DATE_MODES` are the two explicit
 * modes ("before", "after"/range) that sit alongside the presets in the Date select.
 */
import { ReactElement, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../../ui/Button';
import { cn } from '../../../../utils/classNames';
import { FIELD_BOX } from './styles';
import { Dialog } from '../../../ui/Dialog';
import { Calendar } from '../../../ui/Calendar';
import { type SearchResultsFilters } from '../../../../hooks/useSearchResultsScreen';

// Keywords `parseSearchFilters` already understands, so a preset here and a typed
// `range:last 7 days` mean exactly the same thing to the backend.
/**
 * The explicit date modes below the presets. Each is a shape of the same two bounds:
 * On sets them equal, Before/After set one, Range sets both.
 */
export const DATE_MODES = [
  { value: '__on__', label: 'On…' },
  { value: '__before__', label: 'Before…' },
  { value: '__after__', label: 'After…' },
  { value: '__range__', label: 'Range…' },
] as const;

export type DateMode = (typeof DATE_MODES)[number]['value'];

/** Human-readable summary of explicit bounds, shown under the Date select once set. */
export function describeDateBounds(after: string, before: string): string {
  if (after && after === before) return `On ${after}`;
  if (after && before) return `${after} – ${before}`;
  if (after) return `After ${after}`;
  if (before) return `Before ${before}`;
  return '';
}

/** Which mode a filter's existing bounds represent, so reopening lands on the right row. */
export function dateModeFor(filters: SearchResultsFilters): DateMode | '' {
  const { after, before } = filters;
  if (after && before) return after === before ? '__on__' : '__range__';
  if (after) return '__after__';
  if (before) return '__before__';
  return '';
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const toIso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Parses a typed YYYY-MM-DD as a local date, so the calendar highlights the day typed. */
const fromIso = (value: string): Date | undefined => {
  if (!ISO_DATE.test(value)) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/**
 * The date sheet the Date dropdown opens for On… / Before… / After… / Range…, matching
 * Slack: a typed field, a calendar, and explicit Cancel/Save. Nothing reaches the filter
 * draft until Save, so an abandoned pick leaves the search untouched.
 */
export function DateModeDialog({
  mode,
  initial,
  onCancel,
  onSave,
}: {
  mode: DateMode;
  initial: { after: string; before: string };
  onCancel: () => void;
  onSave: (next: { after: string; before: string }) => void;
}): ReactElement {
  const isRange = mode === '__range__';
  // Before… edits the upper bound; the rest start from the lower one.
  const [start, setStart] = useState(mode === '__before__' ? initial.before : initial.after);
  const [end, setEnd] = useState(initial.before);

  const title = DATE_MODES.find(m => m.value === mode)?.label ?? 'Date';
  const startDate = fromIso(start);
  const endDate = fromIso(end);
  const canSave = isRange ? Boolean(startDate && endDate) : Boolean(startDate);

  const commit = (): void => {
    if (!canSave) return;
    if (isRange) onSave({ after: start, before: end });
    else if (mode === '__on__') onSave({ after: start, before: start });
    else if (mode === '__after__') onSave({ after: start, before: '' });
    else onSave({ after: '', before: start });
  };

  const field = (
    label: string,
    value: string,
    setValue: (v: string) => void,
    autoFocus: boolean,
  ): ReactElement => (
    <div className={isRange ? 'flex-1' : ''}>
      {isRange && <span className='block pb-1 text-xs text-muted-foreground'>{label}</span>}
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        placeholder='E.g. 2026-08-25'
        aria-label={isRange ? label : title}
        className={cn(FIELD_BOX, 'focus:border-primary')}
        data-track-category='SEARCH_FILTERS'
        data-track-name='DATE_MODE_INPUT'
      />
    </div>
  );

  return (
    <Dialog
      open
      onOpenChange={next => {
        if (!next) onCancel();
      }}
      title={title}
      className='max-w-[380px]'
      zIndexClassName='z-[70]'
    >
      <div className='flex items-center justify-between px-5 pb-2 pt-4'>
        <h3 className='text-base font-bold'>{title}</h3>
        <button
          type='button'
          onClick={onCancel}
          className='rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground'
          aria-label='Close date picker'
          data-track-category='SEARCH_FILTERS'
          data-track-name='CLOSE_DATE_MODE'
        >
          <X className='size-4' />
        </button>
      </div>

      <div className='px-5'>
        {isRange ? (
          <div className='flex items-start gap-2'>
            {field('Start', start, setStart, true)}
            {field('End', end, setEnd, false)}
          </div>
        ) : (
          field(title, start, setStart, true)
        )}
      </div>

      <div className='px-3 pt-1'>
        {isRange ? (
          <Calendar
            mode='range'
            weekStartsOn={1}
            defaultMonth={startDate ?? new Date()}
            selected={{ from: startDate, to: endDate }}
            onSelect={picked => {
              setStart(picked?.from ? toIso(picked.from) : '');
              setEnd(picked?.to ? toIso(picked.to) : '');
            }}
          />
        ) : (
          <Calendar
            mode='single'
            weekStartsOn={1}
            defaultMonth={startDate ?? new Date()}
            selected={startDate}
            onSelect={picked => setStart(picked ? toIso(picked) : '')}
          />
        )}
      </div>

      <div className='flex items-center justify-end gap-2 px-5 pb-4 pt-2'>
        <Button
          variant='outline'
          size='sm'
          onClick={onCancel}
          data-track-category='SEARCH_FILTERS'
          data-track-name='CANCEL_DATE_MODE'
        >
          Cancel
        </Button>
        <Button
          size='sm'
          onClick={commit}
          disabled={!canSave}
          data-track-category='SEARCH_FILTERS'
          data-track-name='SAVE_DATE_MODE'
        >
          Save
        </Button>
      </div>
    </Dialog>
  );
}
