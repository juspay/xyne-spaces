import { ReactElement, useState, useEffect, useMemo, useRef } from 'react';
import { SearchDefault as Search, CheckTickSingle as Check } from '@xyne/icons';
import { FormFieldType } from '@xyne/shared';
import Input from '../../../../ui/Input/Input';
import { Button } from '../../../../ui/Button';
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

export const DynamicFieldSubmenu = ({
  fieldId: _fieldId,
  fieldName,
  fieldType,
  fieldEnum,
  selectedValue,
  onChange,
  onClose,
  className = '',
}: DynamicFieldSubmenuProps): ReactElement => {
  const [searchQuery, setSearchQuery] = useState('');
  const [stringValue, setStringValue] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>({});
  const searchInputRef = useRef<HTMLInputElement>(null);
  const stringInputRef = useRef<HTMLInputElement>(null);

  // Focus search input when component mounts
  useEffect(() => {
    if (fieldType === FormFieldType.STRING || fieldType === FormFieldType.NUMBER) {
      stringInputRef.current?.focus();
    } else {
      searchInputRef.current?.focus();
    }
  }, [fieldType]);

  // Prepare options and selected values for SELECT fields (always compute to maintain hook order)
  const options = fieldEnum || [];
  const selectedValues = Array.isArray(selectedValue) ? selectedValue : [];

  // Filter options for SELECT fields (always compute to maintain hook order)
  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    const lower = searchQuery.toLowerCase();
    return options.filter(opt => opt.toLowerCase().includes(lower));
  }, [options, searchQuery]);

  // Initialize values
  useEffect(() => {
    if (fieldType === FormFieldType.DATE && selectedValue && !Array.isArray(selectedValue)) {
      setDateRange(selectedValue);
    } else if (
      (fieldType === FormFieldType.STRING || fieldType === FormFieldType.NUMBER) &&
      Array.isArray(selectedValue)
    ) {
      setStringValue(selectedValue[0] || '');
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

  // Render SINGLE_SELECT or MULTI_SELECT
  if (fieldType === FormFieldType.SINGLE_SELECT || fieldType === FormFieldType.MULTI_SELECT) {
    const handleToggle = (option: string): void => {
      if (fieldType === FormFieldType.SINGLE_SELECT) {
        // Single select: replace value or clear if clicking selected
        onChange(selectedValues.includes(option) ? [] : [option]);
      } else {
        // Multi select: toggle in array
        const isSelected = selectedValues.includes(option);
        onChange(
          isSelected ? selectedValues.filter(v => v !== option) : [...selectedValues, option],
        );
      }
    };

    const isMultiSelect = fieldType === FormFieldType.MULTI_SELECT;
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

    return (
      <div
        className={`w-64 flex flex-col bg-background border border-border rounded-lg shadow-lg overflow-hidden ${className}`}
      >
        <div className='p-3 border-b sticky top-0 bg-background z-10'>
          <div className='text-sm font-medium text-foreground mb-2'>{fieldName}</div>
          {options.length > 5 && (
            <div className='relative'>
              <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground' />
              <Input
                ref={searchInputRef}
                type='text'
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder='Search options...'
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
          {filteredOptions.length > 0 ? (
            <div className='space-y-0.5'>
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
                    <span className='text-sm'>{option}</span>
                    {isSelected && <Check className='w-4 h-4 text-blue-600' />}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className='p-4 text-center text-sm text-muted-foreground'>No options found</div>
          )}
        </div>
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

  // Render STRING or NUMBER field
  if (fieldType === FormFieldType.STRING || fieldType === FormFieldType.NUMBER) {
    const handleApply = () => {
      if (stringValue.trim()) {
        onChange([stringValue.trim()]);
      } else {
        onChange([]);
      }
      onClose?.();
    };

    return (
      <div
        className={`w-64 flex flex-col bg-background border border-border rounded-lg shadow-lg overflow-hidden p-4 ${className}`}
      >
        <div className='text-sm font-medium text-foreground mb-3'>{fieldName}</div>
        <Input
          ref={stringInputRef}
          type={fieldType === FormFieldType.NUMBER ? 'number' : 'text'}
          value={stringValue}
          onChange={e => setStringValue(e.target.value)}
          placeholder={`Enter ${fieldName.toLowerCase()}...`}
          className={`mb-3 ${fieldType === FormFieldType.NUMBER ? '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none' : ''}`}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              handleApply();
            }
          }}
        />
        <div className='flex gap-2'>
          <Button
            onClick={() => {
              setStringValue('');
              onChange([]);
              onClose?.();
            }}
            variant='outline'
            size='sm'
            className='flex-1'
            data-track-category='Tickets'
            data-track-name='ClearStringFilter'
          >
            Clear
          </Button>
          <Button
            onClick={handleApply}
            variant='default'
            size='sm'
            className='flex-1'
            data-track-category='Tickets'
            data-track-name='ApplyStringFilter'
          >
            Apply
          </Button>
        </div>
      </div>
    );
  }

  // Render BOOLEAN field as toggle
  if (fieldType === FormFieldType.BOOLEAN) {
    const selectedValues = Array.isArray(selectedValue) ? selectedValue : [];
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
