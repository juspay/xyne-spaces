import { ReactElement, useState, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SearchDefault as Search, CheckTickSingle as Check, Spinner as Loader2 } from '@xyne/icons';
import { FormFieldType } from '@xyne/shared';
import Input from '../../../../ui/Input/Input';
import { Button } from '../../../../ui/Button';
import {
  getFormFieldValues,
  type FormFieldValuesResponse,
} from '../../../../../services/ticketService';
import { UserSubmenu } from '../UserSubmenu/UserSubmenu';
import { DateRange } from '../../types';

interface DynamicFieldSubmenuProps {
  fieldId: string;
  fieldName: string;
  fieldType: FormFieldType;
  fieldEnum?: string[] | null;
  selectedValue: string[] | { start?: number; end?: number } | undefined;
  onChange: (value: string[] | { start?: number; end?: number }) => void;
  onClose?: () => void;
  className?: string;
}

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

// Stable identity: a fresh [] each render would invalidate the memos below.
const NO_VALUES: string[] = [];

export const DynamicFieldSubmenu = ({
  fieldId,
  fieldName,
  fieldType,
  fieldEnum,
  selectedValue,
  onChange,
  onClose,
  className = '',
}: DynamicFieldSubmenuProps): ReactElement => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>({});
  const searchInputRef = useRef<HTMLInputElement>(null);

  const enumOptions = fieldEnum ?? NO_VALUES;
  const selectedValues = Array.isArray(selectedValue) ? selectedValue : NO_VALUES;

  // Fields with no predefined options take their dropdown from the values already stored
  // on tickets, so the user picks a real value instead of typing one blind.
  const usesStoredValues =
    fieldType === FormFieldType.STRING ||
    fieldType === FormFieldType.NUMBER ||
    ((fieldType === FormFieldType.SINGLE_SELECT || fieldType === FormFieldType.MULTI_SELECT) &&
      enumOptions.length === 0);

  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Searched server-side (`q` + `limit`) rather than downloaded whole. Refetched per open
  // (the popover unmounts on close) so newly saved values show up.
  const { data: storedValues, isFetching } = useQuery({
    queryKey: ['form-field-values', fieldId, searchTerm],
    queryFn: (): Promise<FormFieldValuesResponse> =>
      getFormFieldValues({
        fieldId,
        ...(searchTerm ? { q: searchTerm } : {}),
        limit: PAGE_SIZE,
      }),
    enabled: usesStoredValues,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Focus search input when component mounts
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const options = useMemo(
    () => (usesStoredValues ? (storedValues?.values ?? NO_VALUES) : enumOptions),
    [usesStoredValues, storedValues, enumOptions],
  );

  const filteredOptions = useMemo(() => {
    const lower = searchQuery.trim().toLowerCase();
    const matching = lower ? options.filter(opt => opt.toLowerCase().includes(lower)) : options;
    // Enum options keep their configured order. Stored values are server-paged, so selected
    // ones are hoisted to the top to stay visible when the page omits them.
    if (!usesStoredValues) return matching;
    const visibleSelected = selectedValues.filter(
      value => !lower || value.toLowerCase().includes(lower),
    );
    const selectedSet = new Set(visibleSelected);
    return [...visibleSelected, ...matching.filter(opt => !selectedSet.has(opt))];
  }, [options, searchQuery, selectedValues, usesStoredValues]);

  // Initialize values
  useEffect(() => {
    if (fieldType === FormFieldType.DATE && selectedValue && !Array.isArray(selectedValue)) {
      setDateRange(selectedValue);
    }
  }, [fieldType, selectedValue]);

  // Render USER field using existing UserSubmenu
  if (fieldType === FormFieldType.USER) {
    return (
      <UserSubmenu
        selectedUsers={Array.isArray(selectedValue) ? selectedValue : []}
        onChange={onChange}
        label={fieldName}
        className={className}
      />
    );
  }

  // Render SINGLE_SELECT, MULTI_SELECT, STRING or NUMBER as a value list
  if (
    fieldType === FormFieldType.SINGLE_SELECT ||
    fieldType === FormFieldType.MULTI_SELECT ||
    fieldType === FormFieldType.STRING ||
    fieldType === FormFieldType.NUMBER
  ) {
    const handleToggle = (option: string): void => {
      const isSelected = selectedValues.includes(option);
      onChange(isSelected ? selectedValues.filter(v => v !== option) : [...selectedValues, option]);
    };

    // Select-all only makes sense over a complete list, which a server-paged one is not.
    const isMultiSelect =
      !usesStoredValues &&
      (fieldType === FormFieldType.SINGLE_SELECT || fieldType === FormFieldType.MULTI_SELECT);
    const allVisibleSelected =
      filteredOptions.length > 0 && filteredOptions.every(o => selectedValues.includes(o));

    const handleSelectAllToggle = (): void => {
      if (allVisibleSelected) {
        onChange(selectedValues.filter(v => !filteredOptions.includes(v)));
      } else {
        const merged = new Set([...selectedValues, ...filteredOptions]);
        onChange([...merged]);
      }
    };

    // A value outside the current page — or on no ticket yet — can still be typed in.
    const typedValue = searchQuery.trim();
    const isTypedValueUsable =
      fieldType !== FormFieldType.NUMBER || Number.isFinite(Number(typedValue));
    const canAddTyped =
      usesStoredValues &&
      typedValue.length > 0 &&
      isTypedValueUsable &&
      !filteredOptions.includes(typedValue);

    const addTypedValue = (): void => {
      if (!canAddTyped) return;
      onChange([...new Set([...selectedValues, typedValue])]);
      setSearchQuery('');
      // A typed value keeps the old free-text flow: apply and close.
      if (fieldType === FormFieldType.STRING || fieldType === FormFieldType.NUMBER) {
        onClose?.();
      }
    };

    const showSearch = usesStoredValues || options.length > 5;
    const isLoadingValues = usesStoredValues && isFetching && options.length === 0;

    return (
      <div
        className={`w-64 flex flex-col bg-background border border-border rounded-lg shadow-lg overflow-hidden ${className}`}
      >
        <div className='p-3 border-b sticky top-0 bg-background z-10'>
          <div className='text-sm font-medium text-foreground mb-2'>{fieldName}</div>
          {showSearch && (
            <div className='relative'>
              <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground' />
              <Input
                ref={searchInputRef}
                type='text'
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTypedValue();
                  }
                }}
                placeholder={usesStoredValues ? 'Search or type a value...' : 'Search options...'}
                className='pl-9'
              />
            </div>
          )}
        </div>
        <div
          className='max-h-80 overflow-y-auto p-1'
          onWheel={e => e.stopPropagation()}
          onTouchMove={e => e.stopPropagation()}
        >
          {isLoadingValues ? (
            <div
              className='flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground'
              role='status'
              aria-live='polite'
            >
              <Loader2 className='w-4 h-4 animate-spin' aria-hidden='true' />
              Loading values...
            </div>
          ) : filteredOptions.length > 0 || canAddTyped ? (
            <div className='space-y-0.5'>
              {canAddTyped && (
                <button
                  type='button'
                  onClick={addTypedValue}
                  className='w-full flex items-center px-3 py-2 rounded-md transition-all hover:bg-muted text-foreground focus-visible:ring-2 focus-visible:ring-ring border-b border-border/50'
                  data-track-category='Tickets'
                  data-track-name='AddTypedDynamicFieldFilter'
                >
                  <span className='flex-1 text-left text-sm truncate'>
                    Use &ldquo;{typedValue}&rdquo;
                  </span>
                </button>
              )}
              {isMultiSelect && (
                <button
                  type='button'
                  onClick={handleSelectAllToggle}
                  className={`
                    w-full flex items-center justify-between px-3 py-2 rounded-md transition-all
                    ${allVisibleSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'}
                    focus-visible:ring-2 focus-visible:ring-ring border-b border-border/50
                  `}
                  data-track-category='Tickets'
                  data-track-name='ToggleSelectAllDynamicField'
                >
                  <span className='text-sm font-medium text-primary'>
                    {allVisibleSelected ? 'Deselect all' : 'Select all'}
                  </span>
                  {allVisibleSelected && <Check className='w-4 h-4 text-primary shrink-0' />}
                </button>
              )}
              {filteredOptions.map(option => {
                const isSelected = selectedValues.includes(option);
                return (
                  <button
                    key={option}
                    type='button'
                    onClick={() => handleToggle(option)}
                    className={`
                      w-full flex items-center justify-between px-3 py-2 rounded-md transition-all
                      ${isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'}
                    `}
                    data-track-category='Tickets'
                    data-track-name='ToggleDynamicFieldFilter'
                    data-track-metadata={JSON.stringify({ option, selected: !isSelected })}
                  >
                    <span className='text-sm text-left truncate'>{option}</span>
                    {isSelected && <Check className='w-4 h-4 text-blue-600 shrink-0' />}
                  </button>
                );
              })}
              {usesStoredValues && storedValues?.hasMore && (
                <div className='px-3 py-2 text-xs text-muted-foreground'>
                  Showing first {PAGE_SIZE} — type to narrow the search.
                </div>
              )}
            </div>
          ) : (
            <div className='p-4 text-center text-sm text-muted-foreground'>
              {usesStoredValues ? 'No values found' : 'No options found'}
            </div>
          )}
        </div>
        {/* Footer only for stored-value fields: it replaces the old free-text Clear button.
            Enum-backed selects never had one. */}
        {usesStoredValues && selectedValues.length > 0 && (
          <div className='p-3 border-t bg-muted flex items-center justify-between'>
            <div className='text-xs text-muted-foreground'>{selectedValues.length} selected</div>
            <button
              type='button'
              onClick={() => onChange([])}
              className='text-xs text-primary hover:underline'
              data-track-category='Tickets'
              data-track-name='ClearDynamicFieldFilter'
            >
              Clear
            </button>
          </div>
        )}
      </div>
    );
  }

  // Render DATE field with range picker
  if (fieldType === FormFieldType.DATE) {
    const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
      const value = e.target.value;
      const newRange = { ...dateRange };
      if (value) {
        newRange.start = new Date(`${value}T00:00:00.000Z`).getTime();
      } else {
        delete newRange.start;
      }
      setDateRange(newRange);
      onChange(newRange.start || newRange.end ? newRange : {});
    };

    const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
      const value = e.target.value;
      const newRange = { ...dateRange };
      if (value) {
        newRange.end = new Date(`${value}T23:59:59.999Z`).getTime();
      } else {
        delete newRange.end;
      }
      setDateRange(newRange);
      onChange(newRange.start || newRange.end ? newRange : {});
    };

    return (
      <div className={`w-80 bg-background border border-border rounded-lg shadow-lg ${className}`}>
        <div className='p-4'>
          <div className='text-sm font-medium text-foreground mb-3'>{fieldName}</div>

          <div className='space-y-3'>
            <div>
              <label
                htmlFor='dynamic-start-date'
                className='block text-xs font-medium text-foreground mb-1'
              >
                Start date
              </label>
              <Input
                id='dynamic-start-date'
                type='date'
                value={dateRange.start ? new Date(dateRange.start).toISOString().split('T')[0] : ''}
                onChange={handleStartDateChange}
                {...(dateRange.end
                  ? { max: new Date(dateRange.end).toISOString().split('T')[0] }
                  : {})}
              />
            </div>

            <div>
              <label
                htmlFor='dynamic-end-date'
                className='block text-xs font-medium text-foreground mb-1'
              >
                End date
              </label>
              <Input
                id='dynamic-end-date'
                type='date'
                value={dateRange.end ? new Date(dateRange.end).toISOString().split('T')[0] : ''}
                onChange={handleEndDateChange}
                {...(dateRange.start
                  ? { min: new Date(dateRange.start).toISOString().split('T')[0] }
                  : {})}
              />
            </div>
          </div>

          {(dateRange.start || dateRange.end) && (
            <div className='border-t border-border pt-3 mt-4'>
              <Button
                onClick={() => {
                  setDateRange({});
                  onChange({});
                }}
                variant='ghost'
                size='sm'
                className='w-full'
                data-track-category='Tickets'
                data-track-name='ClearDynamicDateRange'
              >
                Clear date range
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Render BOOLEAN field as toggle
  if (fieldType === FormFieldType.BOOLEAN) {
    const isTrueSelected = selectedValues.includes('true');
    const isFalseSelected = selectedValues.includes('false');

    const handleBooleanToggle = (value: string) => {
      if (selectedValues.includes(value)) {
        onChange(selectedValues.filter(v => v !== value));
      } else {
        onChange([value]); // Only one value for boolean (true or false)
      }
    };

    return (
      <div
        className={`w-48 flex flex-col bg-background border border-border rounded-lg shadow-lg overflow-hidden p-3 ${className}`}
      >
        <div className='text-sm font-medium text-foreground mb-3'>{fieldName}</div>
        <div className='space-y-2'>
          <button
            onClick={() => handleBooleanToggle('true')}
            className={`
              w-full flex items-center justify-between px-3 py-2 rounded-md transition-all border
              ${isTrueSelected ? 'bg-accent text-accent-foreground border-input' : 'hover:bg-muted text-foreground border-border'}
            `}
            data-track-category='Tickets'
            data-track-name='FilterBooleanTrue'
            data-track-metadata={JSON.stringify({ fieldName })}
          >
            <span className='text-sm'>True</span>
            {isTrueSelected && <Check className='w-4 h-4 text-blue-600' />}
          </button>
          <button
            onClick={() => handleBooleanToggle('false')}
            className={`
              w-full flex items-center justify-between px-3 py-2 rounded-md transition-all border
              ${isFalseSelected ? 'bg-accent text-accent-foreground border-input' : 'hover:bg-muted text-foreground border-border'}
            `}
            data-track-category='Tickets'
            data-track-name='FilterBooleanFalse'
            data-track-metadata={JSON.stringify({ fieldName })}
          >
            <span className='text-sm'>False</span>
            {isFalseSelected && <Check className='w-4 h-4 text-blue-600' />}
          </button>
        </div>
      </div>
    );
  }

  return <div>Unsupported field type</div>;
};
