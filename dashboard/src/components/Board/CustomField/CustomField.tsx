import { ReactElement, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { GripVertical, Trash2, CornerDownLeft, Check, ChevronDown } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import type { TicketField } from '../BoardEditScreen/BoardEditScreen.types';
import { mapFromFormFieldType, mapToFormFieldType } from '../BoardEditScreen/BoardEditScreen.types';
import { type FieldType, type CustomFieldProps } from './CustomField.types';
import {
  GlobalFieldNameAutocomplete,
  type GlobalFieldSuggestion,
} from '../GlobalFieldNameAutocomplete';
import {
  MAX_FIELD_OPTIONS,
  mergeFieldOptions,
  normalizeFieldOptions,
  parseBulkOptions,
  createBulkOptionInputHandlers,
} from '../../../utils/board';

type OptionsEditMode = 'individual' | 'bulk';

interface BulkOptionsFeedback {
  duplicatesRemoved: number;
  truncated: boolean;
}

const fieldTypeOptions = [
  { value: 'text', label: 'String' },
  { value: 'select', label: 'Single Select' },
  { value: 'multiselect', label: 'Multi Select' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'date', label: 'Date' },
  { value: 'user', label: 'User' },
];

export const CustomField = ({
  mode,
  field,
  projectId,
  onSave,
  onCancel,
}: CustomFieldProps): ReactElement => {
  const [fieldName, setFieldName] = useState(field?.label || '');
  const [fieldType, setFieldType] = useState<FieldType>((field?.type as FieldType) || 'text');
  const [fieldRequired, setFieldRequired] = useState(field?.required || false);
  const [fieldOptions, setFieldOptions] = useState<string[]>(field?.options || []);
  const [createAsNew, setCreateAsNew] = useState(false);
  const [selectedField, setSelectedField] = useState<GlobalFieldSuggestion | undefined>(() =>
    field?.id
      ? {
          id: field.id,
          fieldName: field.label || field.name,
          fieldType: mapToFormFieldType(field.type),
          ...(field.options ? { fieldEnum: field.options } : {}),
        }
      : undefined,
  );
  const [optionInput, setOptionInput] = useState('');
  const [optionsEditMode, setOptionsEditMode] = useState<OptionsEditMode>('individual');
  const [bulkDraft, setBulkDraft] = useState('');
  const [bulkFeedback, setBulkFeedback] = useState<BulkOptionsFeedback | null>(null);
  const [draggingOptionIndex, setDraggingOptionIndex] = useState<number | null>(null);
  const [fieldTypeDropdownOpen, setFieldTypeDropdownOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fieldTypeDropdownRef = useRef<HTMLDivElement>(null);
  const isSavingRef = useRef(false);

  useEffect(() => {
    if (mode === 'create' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [mode]);

  const handleSave = useCallback(() => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;

    if (!fieldName.trim()) {
      onCancel();
      return;
    }

    let optionsToSave = fieldOptions;
    if ((fieldType === 'select' || fieldType === 'multiselect') && optionsEditMode === 'bulk') {
      const { options } = normalizeFieldOptions(parseBulkOptions(bulkDraft));
      optionsToSave = options;
    }

    // Don't save select/multiselect if no options added
    if ((fieldType === 'select' || fieldType === 'multiselect') && optionsToSave.length === 0) {
      onCancel();
      return;
    }

    const updatedField: Omit<TicketField, 'id' | 'order'> & { id?: string } = {
      name: fieldName.trim(),
      type: fieldType,
      label: fieldName.trim(),
      required: fieldRequired,
      visibleInCreate: true,
      ...(!createAsNew && selectedField
        ? { id: selectedField.id }
        : !createAsNew && field?.id
          ? { id: field.id }
          : {}),
    };

    // Only add options for select/multiselect types
    if ((fieldType === 'select' || fieldType === 'multiselect') && optionsToSave.length > 0) {
      updatedField['options'] = optionsToSave;
    }

    onSave(updatedField);
  }, [
    bulkDraft,
    fieldName,
    fieldType,
    fieldRequired,
    fieldOptions,
    field?.id,
    onCancel,
    onSave,
    optionsEditMode,
    createAsNew,
    selectedField,
  ]);

  // Click outside to save
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        handleSave();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [handleSave]);

  // Click outside handler for field type dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        fieldTypeDropdownRef.current &&
        !fieldTypeDropdownRef.current.contains(event.target as Node)
      ) {
        setFieldTypeDropdownOpen(false);
      }
    };

    if (fieldTypeDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [fieldTypeDropdownOpen]);

  const handleAddOption = useCallback(() => {
    if (!optionInput.trim()) return;

    const { options, duplicatesRemoved, truncated } = mergeFieldOptions(fieldOptions, [
      optionInput.trim(),
    ]);
    setFieldOptions(options);
    setBulkFeedback({ duplicatesRemoved, truncated });
    setOptionInput('');
  }, [optionInput, fieldOptions]);

  const addBulkOptions = useCallback(
    (incoming: string[]) => {
      const { options, duplicatesRemoved, truncated } = mergeFieldOptions(fieldOptions, incoming);
      setFieldOptions(options);
      setBulkFeedback({ duplicatesRemoved, truncated });
    },
    [fieldOptions],
  );

  const bulkOptionInputHandlers = useMemo(
    () => createBulkOptionInputHandlers(addBulkOptions, () => setOptionInput('')),
    [addBulkOptions],
  );

  const applyBulkDraft = useCallback(() => {
    const parsed = parseBulkOptions(bulkDraft);
    const { options, duplicatesRemoved, truncated } = normalizeFieldOptions(parsed);
    setFieldOptions(options);
    setBulkDraft(options.join('\n'));
    setBulkFeedback({ duplicatesRemoved, truncated });
  }, [bulkDraft]);

  const toggleOptionsEditMode = useCallback(() => {
    if (optionsEditMode === 'individual') {
      setOptionsEditMode('bulk');
      setBulkDraft(fieldOptions.join('\n'));
      setBulkFeedback(null);
      return;
    }

    applyBulkDraft();
    setOptionsEditMode('individual');
  }, [applyBulkDraft, fieldOptions, optionsEditMode]);

  const handleRemoveOption = useCallback((optionToRemove: string) => {
    setFieldOptions(prev => prev.filter(opt => opt !== optionToRemove));
  }, []);

  const handleOptionDragStart = useCallback((index: number) => {
    setDraggingOptionIndex(index);
  }, []);

  const handleOptionDragOver = useCallback(
    (e: React.DragEvent, targetIndex: number) => {
      e.preventDefault();
      if (draggingOptionIndex === null || draggingOptionIndex === targetIndex) return;

      setFieldOptions(prev => {
        const newOptions = [...prev];
        const [removed] = newOptions.splice(draggingOptionIndex, 1);
        if (removed) {
          newOptions.splice(targetIndex, 0, removed);
        }
        return newOptions;
      });
      setDraggingOptionIndex(targetIndex);
    },
    [draggingOptionIndex],
  );

  const handleOptionDragEnd = useCallback(() => {
    setDraggingOptionIndex(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      } else if (e.key === 'Escape') {
        onCancel();
      }
    },
    [handleSave, onCancel],
  );

  return (
    <div ref={containerRef} className='border border-border rounded-[12px] shadow-md p-4'>
      <div className='flex items-center justify-between mb-4'>
        {/* Grip icon placeholder for alignment */}
        <div className='w-4 flex-shrink-0'>
          <GripVertical size={16} className='text-xyne-gray-300' />
        </div>

        {/* Left side: Input + Dropdown */}
        <div className='flex items-center gap-3 flex-1'>
          <GlobalFieldNameAutocomplete
            value={fieldName}
            onChange={setFieldName}
            projectId={projectId}
            inputRef={inputRef}
            placeholder={mode === 'create' ? 'Custom Field' : 'Field name'}
            className='w-40 px-3 py-2 border-0 bg-transparent text-[14px] focus:outline-none focus:ring-0 placeholder:text-muted-foreground'
            onSelectExisting={suggestion => {
              setFieldName(suggestion.fieldName);
              setFieldType(mapFromFormFieldType(suggestion.fieldType) as FieldType);
              setCreateAsNew(false);
              setSelectedField(suggestion);
              if (suggestion.fieldEnum?.length) {
                setFieldOptions(suggestion.fieldEnum);
              }
            }}
            selectedField={!createAsNew ? selectedField : undefined}
            onCreateNew={
              selectedField
                ? () => {
                    setCreateAsNew(true);
                    setSelectedField(undefined);
                  }
                : undefined
            }
            onKeyDown={handleKeyDown}
          />

          <div className='relative w-[140px] shrink-0' ref={fieldTypeDropdownRef}>
            <button
              type='button'
              onClick={e => {
                e.stopPropagation();
                setFieldTypeDropdownOpen(!fieldTypeDropdownOpen);
              }}
              className='h-8 w-[140px] rounded-md border border-input bg-background px-3 py-1.5 text-[13px] flex items-center justify-between'
              data-track-category='form'
              data-track-name='field-type-dropdown-toggle'
            >
              <span>{fieldTypeOptions.find(opt => opt.value === fieldType)?.label || 'Field'}</span>
              <ChevronDown className='h-4 w-4 text-muted-foreground' />
            </button>
            {fieldTypeDropdownOpen && (
              <div className='absolute top-full left-0 mt-1 w-[140px] bg-background border border-input rounded-md shadow-lg z-50 overflow-hidden max-h-[240px] overflow-y-auto'>
                {fieldTypeOptions.map(option => (
                  <button
                    key={option.value}
                    type='button'
                    onClick={e => {
                      e.stopPropagation();
                      setFieldType(option.value as FieldType);
                      setFieldTypeDropdownOpen(false);
                      if (option.value !== 'select' && option.value !== 'multiselect') {
                        setOptionsEditMode('individual');
                        setBulkDraft('');
                        setBulkFeedback(null);
                      }
                    }}
                    className='w-full px-3 py-2 text-left text-[13px] hover:bg-muted flex items-center justify-between'
                    data-track-category='form'
                    data-track-name={`select-field-type-${option.value}`}
                  >
                    <span>{option.label}</span>
                    {fieldType === option.value && <Check className='h-4 w-4' />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right side: Required + Show in Create + Delete */}
        <div className='flex items-center gap-3 ml-3'>
          <div className='flex items-center gap-2'>
            <span className='text-[13px] text-[#505b62] whitespace-nowrap leading-[18px] tracking-[-0.2px]'>
              Required
            </span>
            <button
              onClick={() => setFieldRequired(!fieldRequired)}
              className={`w-[28px] h-[18px] rounded-full transition-colors relative flex-shrink-0 ${
                fieldRequired ? 'bg-xyne-primary-500' : 'bg-gray-600'
              }`}
              data-track-category='form'
              data-track-name='required-toggle'
              type='button'
            >
              <span
                className={`absolute top-[3px] left-[3px] w-[12px] h-[12px] bg-white rounded-full transition-transform ${
                  fieldRequired ? 'translate-x-[10px]' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <Button
            onClick={onCancel}
            variant='ghost'
            size='iconSm'
            className='w-8 h-8 text-muted-foreground hover:text-xyne-red-500'
            data-track-category='form'
            data-track-name='cancel-field'
          >
            <Trash2 size={16} />
          </Button>
        </div>
      </div>

      {/* Options Input for Select/Multiselect Types */}
      {(fieldType === 'select' || fieldType === 'multiselect') && (
        <div className='border-t border-border mt-2 pt-4'>
          <div className='flex items-center justify-between mb-4'>
            <p className='text-[13px] font-semibold text-foreground'>
              {mode === 'create' ? 'Enter Options' : 'Options'}
            </p>
            <button
              type='button'
              onClick={toggleOptionsEditMode}
              className='text-[12px] text-[#6276be] font-medium hover:underline'
              data-track-category='form'
              data-track-name={
                optionsEditMode === 'bulk'
                  ? 'switch_to_individual_options'
                  : 'switch_to_bulk_options'
              }
            >
              {optionsEditMode === 'bulk' ? 'Edit one at a time' : 'Bulk add'}
            </button>
          </div>

          {optionsEditMode === 'bulk' ? (
            <div className='flex flex-col gap-[6px]'>
              <textarea
                value={bulkDraft}
                onChange={e => setBulkDraft(e.target.value)}
                onBlur={applyBulkDraft}
                placeholder='One option per line. Paste from a spreadsheet, comma-separated list, etc.'
                rows={8}
                className='w-full min-h-[120px] max-h-[240px] px-[10px] py-[8px] text-[13px] text-foreground bg-background border border-border rounded-[8px] resize-y focus:outline-none focus:ring-1 focus:ring-[#6276be]/40'
                data-track-category='form'
                data-track-name='bulk_options_textarea'
              />
              <div className='flex flex-col gap-[2px]'>
                <span className='text-[11px] text-muted-foreground'>
                  {fieldOptions.length > 0
                    ? `${fieldOptions.length} option${fieldOptions.length === 1 ? '' : 's'}`
                    : 'No options yet'}
                  {bulkFeedback?.duplicatesRemoved
                    ? ` · ${bulkFeedback.duplicatesRemoved} duplicate${
                        bulkFeedback.duplicatesRemoved === 1 ? '' : 's'
                      } removed`
                    : ''}
                </span>
                {bulkFeedback?.truncated && (
                  <span className='text-[11px] text-amber-600'>
                    Maximum {MAX_FIELD_OPTIONS} options. Extra entries were removed.
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className='space-y-[6px]'>
              {fieldOptions.map((option, idx) => (
                <div
                  key={idx}
                  draggable
                  onDragStart={() => handleOptionDragStart(idx)}
                  onDragOver={e => handleOptionDragOver(e, idx)}
                  onDragEnd={handleOptionDragEnd}
                  className={`group flex items-center gap-2 px-2 py-2 hover:bg-muted rounded-[10px] border border-border cursor-move ${
                    draggingOptionIndex === idx ? 'opacity-50' : ''
                  }`}
                >
                  <GripVertical
                    size={16}
                    className='text-muted-foreground flex-shrink-0 cursor-grab'
                  />
                  <input
                    type='text'
                    value={option}
                    onChange={e => {
                      const newValue = e.target.value;
                      setFieldOptions(prev => prev.map((opt, i) => (i === idx ? newValue : opt)));
                    }}
                    className='flex-1 bg-transparent text-[13px] text-foreground focus:outline-none'
                    data-track-category='form'
                    data-track-name='edit-option'
                  />
                  <Button
                    onClick={() => handleRemoveOption(option)}
                    variant='ghost'
                    size='iconSm'
                    className='w-6 h-6 text-muted-foreground hover:text-xyne-red-500 opacity-0 group-hover:opacity-100'
                    data-track-category='form'
                    data-track-name='remove-option'
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
              <div className='flex flex-col gap-[4px]'>
                <div className='flex items-center gap-2 px-2 py-2'>
                  <input
                    type='text'
                    value={optionInput}
                    onChange={e => setOptionInput(e.target.value)}
                    onKeyDown={bulkOptionInputHandlers.onKeyDown}
                    onPaste={bulkOptionInputHandlers.onPaste}
                    placeholder={
                      fieldOptions.length
                        ? 'Add another option (paste multiple at once)'
                        : 'Add option (paste multiple at once)'
                    }
                    className='flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none'
                    data-track-category='form'
                    data-track-name='option-input'
                  />
                  <Button
                    onClick={handleAddOption}
                    disabled={!optionInput.trim()}
                    variant='ghost'
                    size='iconSm'
                    className='w-6 h-6 text-muted-foreground hover:text-xyne-gray-600 disabled:opacity-50'
                    data-track-category='form'
                    data-track-name='add-option'
                  >
                    <CornerDownLeft size={14} />
                  </Button>
                </div>
                {bulkFeedback && (bulkFeedback.duplicatesRemoved > 0 || bulkFeedback.truncated) && (
                  <span className='text-[11px] text-muted-foreground px-2'>
                    {bulkFeedback.duplicatesRemoved > 0 &&
                      `${bulkFeedback.duplicatesRemoved} duplicate${
                        bulkFeedback.duplicatesRemoved === 1 ? '' : 's'
                      } skipped`}
                    {bulkFeedback.duplicatesRemoved > 0 && bulkFeedback.truncated && ' · '}
                    {bulkFeedback.truncated && `Maximum ${MAX_FIELD_OPTIONS} options`}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Boolean Type - Pre-populated Yes/No options */}
      {fieldType === 'boolean' && (
        <div className='border-t border-xyne-gray-200 mt-2 pt-4 ml-7'>
          <p className='text-[13px] font-semibold text-foreground mb-4'>Options</p>
          <div className='space-y-3'>
            <div className='flex items-center gap-1.5 bg-xyne-gray-100 border border-xyne-gray-200 rounded-[10px] px-1.5 py-2 h-[34px]'>
              <GripVertical size={16} className='text-muted-foreground' />
              <span className='flex-1 text-[13px] text-foreground'>Yes</span>
              <div className='w-6 h-6 flex items-center justify-center bg-background border border-xyne-gray-200 rounded-md text-muted-foreground'>
                <span className='text-[14px]'>⏎</span>
              </div>
            </div>
            <div className='flex items-center gap-1.5 bg-background border border-xyne-gray-200 rounded-[10px] px-1.5 py-2 h-[34px]'>
              <GripVertical size={16} className='text-muted-foreground' />
              <span className='flex-1 text-[13px] text-foreground'>No</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
