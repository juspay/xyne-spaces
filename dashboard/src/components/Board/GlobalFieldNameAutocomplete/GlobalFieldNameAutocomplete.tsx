import { ReactElement, useEffect, useRef, useState } from 'react';
import { FormFieldType } from '@xyne/shared';
import { useGlobalFieldSearch } from '../../../hooks/useGlobalFieldSearch';
import { mapFromFormFieldType } from '../BoardEditScreen/BoardEditScreen.types';
import type { GlobalFieldListResult } from '../../../services/Form/formService';
import { parseFieldEnumOptions } from '../../../utils/formFieldEnum';

export interface GlobalFieldSuggestion {
  id: string;
  fieldName: string;
  fieldType: FormFieldType;
  fieldEnum?: string[];
}

const toSuggestion = (field: GlobalFieldListResult): GlobalFieldSuggestion => {
  const fieldEnum = parseFieldEnumOptions(field.fieldEnum);
  return {
    id: field.id,
    fieldName: field.fieldName,
    fieldType: field.fieldType,
    ...(fieldEnum ? { fieldEnum } : {}),
  };
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
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { results, debouncedQuery } = useGlobalFieldSearch(projectId, value, {
    enabled: !disabled && isOpen,
  });

  const suggestions = results.map(toSuggestion);
  const exactMatches = suggestions.filter(
    s => s.fieldName.trim().toLowerCase() === value.trim().toLowerCase(),
  );
  const firstExactMatch = exactMatches[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return function cleanup(): void {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSelect = (field: GlobalFieldSuggestion): void => {
    onChange(field.fieldName);
    onSelectExisting?.(field);
    setIsOpen(false);
  };

  const showDropdown = isOpen && debouncedQuery.length >= 1 && suggestions.length > 0;

  return (
    <div ref={containerRef} className='relative w-full'>
      <input
        ref={inputRef}
        type='text'
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={e => {
          onChange(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={onKeyDown}
        className={className}
        data-track-category='form'
        data-track-name='global-field-name-autocomplete-input'
      />

      {selectedField && (
        <div className='mt-1 rounded-[8px] border border-[#6276be]/20 bg-[#6276be]/5 px-2 py-1.5'>
          <p className='text-[11px] text-[#6276be]'>
            Editing field: {selectedField.fieldName} ·{' '}
            {mapFromFormFieldType(selectedField.fieldType)}
          </p>
          <p className='mt-0.5 text-[11px] text-muted-foreground'>
            Changes to this field apply wherever it is used.
          </p>
          {onCreateNew && (
            <button
              type='button'
              className='mt-1 text-[11px] font-medium text-[#6276be] hover:underline'
              onClick={() => {
                onCreateNew();
                setIsOpen(false);
              }}
              data-track-category='form'
              data-track-name='create-as-new-global-field'
            >
              Create as new field
            </button>
          )}
        </div>
      )}

      {!selectedField && firstExactMatch && value.trim().length > 0 && (
        <p className='mt-1 text-[11px] text-[#6276be]'>
          &quot;{firstExactMatch.fieldName}&quot; already exists as{' '}
          {exactMatches.map(match => mapFromFormFieldType(match.fieldType)).join('/')} — select this
          field to reuse it, or change name/type to create a new one
        </p>
      )}

      {showDropdown && (
        <ul className='absolute z-[100] mt-1 w-full max-h-[200px] overflow-y-auto rounded-[8px] border border-border bg-background shadow-md'>
          {suggestions.map(field => (
            <li key={field.id}>
              <button
                type='button'
                className='w-full px-3 py-2 text-left text-[13px] hover:bg-muted flex items-center justify-between gap-2'
                onMouseDown={e => {
                  e.preventDefault();
                  handleSelect(field);
                }}
                data-track-category='form'
                data-track-name='select-global-field-suggestion'
              >
                <span className='text-foreground'>{field.fieldName}</span>
                <span className='text-[11px] text-muted-foreground shrink-0'>
                  {mapFromFormFieldType(field.fieldType)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
