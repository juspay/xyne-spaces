import { ReactElement, useState, useCallback, useRef, useEffect } from 'react';
import { GripVertical, Trash2, CornerDownLeft, Check, ChevronDown } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import type { TicketField } from '../BoardEditScreen/BoardEditScreen.types';
import { type FieldType, type CustomFieldProps } from './CustomField.types';

const fieldTypeOptions = [
  { value: 'text', label: 'String' },
  { value: 'select', label: 'Single Select' },
  { value: 'multiselect', label: 'Multi Select' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'date', label: 'Date' },
  { value: 'user', label: 'User' },
];

export const CustomField = ({ mode, field, onSave, onCancel }: CustomFieldProps): ReactElement => {
  const [fieldName, setFieldName] = useState(field?.label || '');
  const [fieldType, setFieldType] = useState<FieldType>((field?.type as FieldType) || 'text');
  const [fieldRequired, setFieldRequired] = useState(field?.required || false);
  const [fieldOptions, setFieldOptions] = useState<string[]>(field?.options || []);
  const [optionInput, setOptionInput] = useState('');
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

    // Don't save select/multiselect if no options added
    if ((fieldType === 'select' || fieldType === 'multiselect') && fieldOptions.length === 0) {
      onCancel();
      return;
    }

    const updatedField: Omit<TicketField, 'id' | 'order'> & { id?: string } = {
      name: fieldName.trim(),
      type: fieldType,
      label: fieldName.trim(),
      required: fieldRequired,
      visibleInCreate: true,
      ...(field?.id && { id: field.id }),
    };

    // Only add options for select/multiselect types
    if ((fieldType === 'select' || fieldType === 'multiselect') && fieldOptions.length > 0) {
      updatedField['options'] = fieldOptions;
    }

    onSave(updatedField);
  }, [fieldName, fieldType, fieldRequired, fieldOptions, field?.id, onCancel, onSave]);

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
    if (optionInput.trim() && !fieldOptions.includes(optionInput.trim())) {
      setFieldOptions(prev => [...prev, optionInput.trim()]);
      setOptionInput('');
    }
  }, [optionInput, fieldOptions]);

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
    <div ref={containerRef} className='border border-xyne-gray-200 rounded-[12px] shadow-md p-4'>
      <div className='flex items-center justify-between gap-3 mb-4'>
        {/* Left side: Input + Dropdown */}
        <div className='flex items-center gap-3'>
          <input
            ref={inputRef}
            type='text'
            value={fieldName}
            onChange={e => setFieldName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={mode === 'create' ? 'Custom Field' : 'Field name'}
            className='w-40 px-3 py-2 border-0 bg-transparent text-[14px] focus:outline-none focus:ring-0 placeholder:text-xyne-gray-400'
            data-track-category='form'
            data-track-name='field-name-input'
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

        {/* Right side: Required + Delete */}
        <div className='flex items-center gap-3'>
          <div className='flex items-center gap-2'>
            <span className='text-[13px] text-xyne-gray-700 whitespace-nowrap leading-[18px] tracking-[-0.2px]'>
              Required
            </span>
            <button
              onClick={() => setFieldRequired(!fieldRequired)}
              className={`w-8 h-5 rounded-full transition-colors relative flex-shrink-0 ${
                fieldRequired ? 'bg-xyne-primary-500' : 'bg-xyne-gray-200'
              }`}
              data-track-category='form'
              data-track-name='required-toggle'
              type='button'
            >
              <span
                className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform ${
                  fieldRequired ? 'translate-x-3' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <Button
            onClick={onCancel}
            variant='ghost'
            size='iconSm'
            className='w-8 h-8 text-xyne-gray-400 hover:text-xyne-red-500'
            data-track-category='form'
            data-track-name='cancel-field'
          >
            <Trash2 size={16} />
          </Button>
        </div>
      </div>

      {/* Options Input for Select/Multiselect Types */}
      {(fieldType === 'select' || fieldType === 'multiselect') && (
        <div className='border-t border-xyne-gray-200 mt-2 pt-4'>
          <div className='flex items-center justify-between mb-4'>
            <p className='text-[13px] font-semibold text-xyne-gray-900'>
              {mode === 'create' ? 'Enter Options' : 'Options'}
            </p>
          </div>
          <div className='space-y-[6px]'>
            {fieldOptions.map((option, idx) => (
              <div
                key={idx}
                draggable
                onDragStart={() => handleOptionDragStart(idx)}
                onDragOver={e => handleOptionDragOver(e, idx)}
                onDragEnd={handleOptionDragEnd}
                className={`group flex items-center gap-2 px-2 py-2 hover:bg-xyne-gray-50 rounded-[10px] border border-[#E4E6E7] cursor-move ${
                  draggingOptionIndex === idx ? 'opacity-50' : ''
                }`}
              >
                <GripVertical size={16} className='text-xyne-gray-300 flex-shrink-0 cursor-grab' />
                <input
                  type='text'
                  value={option}
                  onChange={e => {
                    const newValue = e.target.value;
                    setFieldOptions(prev => prev.map((opt, i) => (i === idx ? newValue : opt)));
                  }}
                  className='flex-1 bg-transparent text-[13px] text-xyne-gray-900 focus:outline-none'
                  data-track-category='form'
                  data-track-name='edit-option'
                />
                <Button
                  onClick={() => handleRemoveOption(option)}
                  variant='ghost'
                  size='iconSm'
                  className='w-6 h-6 text-xyne-gray-400 hover:text-xyne-red-500 opacity-0 group-hover:opacity-100'
                  data-track-category='form'
                  data-track-name='remove-option'
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
            <div className='flex items-center gap-2 px-2 py-2'>
              <input
                type='text'
                value={optionInput}
                onChange={e => setOptionInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddOption();
                  }
                }}
                placeholder='Add Option'
                className='flex-1 bg-transparent text-[13px] text-xyne-gray-900 placeholder:text-xyne-gray-400 focus:outline-none'
                data-track-category='form'
                data-track-name='option-input'
              />
              <Button
                onClick={handleAddOption}
                disabled={!optionInput.trim()}
                variant='ghost'
                size='iconSm'
                className='w-6 h-6 text-xyne-gray-400 hover:text-xyne-gray-600 disabled:opacity-50'
                data-track-category='form'
                data-track-name='add-option'
              >
                <CornerDownLeft size={14} />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Boolean Type - Pre-populated Yes/No options */}
      {fieldType === 'boolean' && (
        <div className='border-t border-xyne-gray-200 mt-2 pt-4 ml-7'>
          <p className='text-[13px] font-semibold text-xyne-gray-900 mb-4'>Options</p>
          <div className='space-y-3'>
            <div className='flex items-center gap-1.5 bg-xyne-gray-100 border border-xyne-gray-200 rounded-[10px] px-1.5 py-2 h-[34px]'>
              <GripVertical size={16} className='text-xyne-gray-300' />
              <span className='flex-1 text-[13px] text-xyne-gray-900'>Yes</span>
              <div className='w-6 h-6 flex items-center justify-center bg-white border border-xyne-gray-200 rounded-md text-xyne-gray-400'>
                <span className='text-[14px]'>⏎</span>
              </div>
            </div>
            <div className='flex items-center gap-1.5 bg-white border border-xyne-gray-200 rounded-[10px] px-1.5 py-2 h-[34px]'>
              <GripVertical size={16} className='text-xyne-gray-300' />
              <span className='flex-1 text-[13px] text-xyne-gray-900'>No</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomField;
