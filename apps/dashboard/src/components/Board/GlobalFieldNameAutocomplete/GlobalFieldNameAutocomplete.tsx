import { ReactElement, useEffect, useRef, useState } from 'react';
import { Link2, Plus } from 'lucide-react';
import { FormFieldType, type FieldEnumOption } from '@xyne/shared';
import { useGlobalFieldSearch } from '../../../hooks/useGlobalFieldSearch';
import { mapFromFormFieldType } from '../BoardEditScreen/BoardEditScreen.types';
import type { GlobalFieldListResult } from '../../../services/Form/formService';
import { Popover } from '../../ui/Popover';
import { Tooltip } from '../../ui/Tooltip';

export interface GlobalFieldSuggestion {
  id: string;
  fieldName: string;
  fieldType: FormFieldType;
  fieldEnum?: FieldEnumOption[];
}

const toSuggestion = (field: GlobalFieldListResult): GlobalFieldSuggestion => {
  const options = field.fieldOptions ?? field.fieldEnum;
  const fieldEnum = options && options.length > 0 ? options : undefined;
  return {
    id: field.id,
    fieldName: field.fieldName,
    fieldType: field.fieldType,
    ...(fieldEnum ? { fieldEnum } : {}),
  };
};

// The suggestion panel is portaled outside containerRef; clicks there are not "outside".
// Matched by its own attribute so other popovers and tooltips on the page still count.
export const GLOBAL_FIELD_SUGGESTIONS_ATTR = 'data-global-field-suggestions';
const isPopoverClick = (target: EventTarget | null): boolean =>
  target instanceof Element && !!target.closest(`[${GLOBAL_FIELD_SUGGESTIONS_ATTR}]`);

// Bolds the part of the name that matches what the user typed.
const HighlightedName = ({ name, query }: { name: string; query: string }): ReactElement => {
  const start = query ? name.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (start < 0) return <>{name}</>;
  const end = start + query.length;
  return (
    <>
      {name.slice(0, start)}
      <span className='font-semibold'>{name.slice(start, end)}</span>
      {name.slice(end)}
    </>
  );
};

export interface GlobalFieldNameAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  projectId: string | undefined;
  onSelectExisting?: (field: GlobalFieldSuggestion) => void;
  selectedField?: GlobalFieldSuggestion | undefined;
  onCreateNew?: (() => void) | undefined;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  inputRef?: React.RefObject<HTMLInputElement | null> | ((el: HTMLInputElement | null) => void);
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}

/**
 * Field-name input that surfaces existing global fields without covering the card:
 * a one-line hint under the input, and a side panel (opened on demand) listing matches.
 */
export const GlobalFieldNameAutocomplete = ({
  value,
  onChange,
  projectId,
  onSelectExisting,
  selectedField,
  onCreateNew,
  disabled,
  placeholder,
  className,
  inputRef,
  onKeyDown,
}: GlobalFieldNameAutocompleteProps): ReactElement => {
  // True while the user is working in this input; gates the "N fields match" hint.
  const [isActive, setIsActive] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // One cached list per project, so searching while idle is cheap and lets the
  // exact-match warning show for pre-filled names too.
  const { results, debouncedQuery } = useGlobalFieldSearch(projectId, value, {
    enabled: !disabled && !selectedField,
  });

  const suggestions = results.map(toSuggestion);
  const normalizedValue = value.trim().toLowerCase();
  const exactMatches = suggestions.filter(
    s => s.fieldName.trim().toLowerCase() === normalizedValue,
  );
  const firstExactMatch = exactMatches[0];
  const hasMatches = !selectedField && debouncedQuery.length >= 1 && suggestions.length > 0;
  const showHint = hasMatches && (isActive || isPanelOpen || !!firstExactMatch);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (isPopoverClick(event.target)) return;
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsActive(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return function cleanup(): void {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Nothing left to show (name cleared, field linked): drop the panel.
  useEffect(() => {
    if (!hasMatches) setIsPanelOpen(false);
  }, [hasMatches]);

  const setInputRef = (el: HTMLInputElement | null): void => {
    localInputRef.current = el;
    if (typeof inputRef === 'function') inputRef(el);
    else if (inputRef) inputRef.current = el;
  };

  const handleSelect = (field: GlobalFieldSuggestion): void => {
    onChange(field.fieldName);
    onSelectExisting?.(field);
    setIsPanelOpen(false);
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' && hasMatches && !isPanelOpen) {
      event.preventDefault();
      setIsPanelOpen(true);
      return;
    }
    onKeyDown?.(event);
  };

  const handlePanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-suggestion]'),
    );
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'ArrowDown'
        ? (index + 1) % items.length
        : index <= 0
          ? items.length - 1
          : index - 1;
    items[next]?.focus();
  };

  const matchLabel = `${suggestions.length} existing field${suggestions.length === 1 ? '' : 's'}`;

  return (
    <div ref={containerRef} className='relative w-full'>
      <input
        ref={setInputRef}
        type='text'
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={e => {
          onChange(e.target.value);
          setIsActive(true);
        }}
        onFocus={() => setIsActive(true)}
        onBlur={e => {
          // Tabbing away hides the hint; moving focus into the suggestion panel does not.
          const next = e.relatedTarget;
          if (next instanceof Node && containerRef.current?.contains(next)) return;
          if (isPopoverClick(next)) return;
          setIsActive(false);
        }}
        onKeyDown={handleInputKeyDown}
        className={className}
        data-track-category='form'
        data-track-name='global-field-name-autocomplete-input'
      />

      {selectedField && (
        <div className='mt-2 flex items-center justify-between gap-2'>
          <Tooltip content='Changes to this field apply wherever it is used.' side='bottom'>
            <span className='inline-flex min-w-0 items-center gap-1 rounded-full bg-[#6276be]/10 px-2 py-0.5 text-[11px] text-[#6276be]'>
              <Link2 size={11} className='shrink-0' />
              <span className='truncate'>
                Shared field · {mapFromFormFieldType(selectedField.fieldType)}
              </span>
            </span>
          </Tooltip>
          {onCreateNew && (
            <Tooltip
              content='Make an editable copy for this form only. Other forms keep using the shared field.'
              side='bottom'
            >
              <button
                type='button'
                className='shrink-0 cursor-pointer text-[12px] text-muted-foreground transition-colors hover:text-[#6276be] focus-visible:text-[#6276be] focus-visible:outline-none'
                onClick={onCreateNew}
                data-track-category='form'
                data-track-name='create-as-new-global-field'
              >
                Create a copy
              </button>
            </Tooltip>
          )}
        </div>
      )}

      {showHint && (
        <div className='mt-1 flex items-center gap-1 text-[11px] text-muted-foreground'>
          {firstExactMatch ? (
            <span className='truncate'>
              &quot;{firstExactMatch.fieldName}&quot; already exists as{' '}
              {exactMatches.map(match => mapFromFormFieldType(match.fieldType)).join('/')}
            </span>
          ) : (
            <span className='truncate'>{matchLabel} match</span>
          )}
          <span aria-hidden>·</span>
          {firstExactMatch && exactMatches.length === 1 && (
            <>
              <button
                type='button'
                className='shrink-0 font-medium text-[#6276be] hover:underline'
                onClick={() => handleSelect(firstExactMatch)}
                data-track-category='form'
                data-track-name='use-exact-global-field-match'
              >
                Use it
              </button>
              {suggestions.length > 1 && <span aria-hidden>·</span>}
            </>
          )}
          {(!firstExactMatch || exactMatches.length > 1 || suggestions.length > 1) && (
            <Popover
              open={isPanelOpen}
              onOpenChange={setIsPanelOpen}
              anchor={containerRef}
              side='left'
              align='start'
              sideOffset={28}
              collisionPadding={12}
              className='w-[288px] rounded-[10px] p-1'
              onOpenAutoFocus={event => {
                // Focus the list, not its first row, so nothing looks pre-selected.
                event.preventDefault();
                panelRef.current?.focus();
              }}
              onCloseAutoFocus={event => {
                event.preventDefault();
                localInputRef.current?.focus();
              }}
              trigger={
                <button
                  type='button'
                  className='shrink-0 font-medium text-[#6276be] hover:underline'
                  data-track-category='form'
                  data-track-name='view-global-field-suggestions'
                >
                  View
                </button>
              }
            >
              <div
                ref={panelRef}
                {...{ [GLOBAL_FIELD_SUGGESTIONS_ATTR]: '' }}
                role='menu'
                tabIndex={-1}
                aria-label='Existing fields'
                className='outline-none'
                onKeyDown={handlePanelKeyDown}
              >
                <p className='px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground'>
                  Reuse an existing field · {suggestions.length}
                </p>
                <ul className='max-h-[264px] overflow-y-auto'>
                  {suggestions.map(field => (
                    <li key={field.id} role='none'>
                      <button
                        type='button'
                        role='menuitem'
                        data-suggestion
                        className='flex w-full items-center justify-between gap-3 rounded-[6px] px-2 py-1.5 text-left text-[13px] text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent'
                        onClick={() => handleSelect(field)}
                        data-track-category='form'
                        data-track-name='select-global-field-suggestion'
                      >
                        <span className='truncate'>
                          <HighlightedName name={field.fieldName} query={debouncedQuery} />
                        </span>
                        <span className='shrink-0 rounded-[4px] bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground'>
                          {mapFromFormFieldType(field.fieldType)}
                          {field.fieldEnum?.length ? ` · ${field.fieldEnum.length}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className='mt-1 flex items-center gap-1.5 border-t border-border px-2 pt-2 pb-1.5 text-[11px] text-muted-foreground'>
                  <Plus className='size-3 shrink-0' />
                  Keep typing to create a new field instead
                </div>
              </div>
            </Popover>
          )}
        </div>
      )}
    </div>
  );
};
