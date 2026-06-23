import { ReactElement, useState, useEffect, useRef } from 'react';
import { X, Plus, GripVertical, Trash2, ChevronDown } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { FormFieldType } from '@xyne/shared';
import { Button } from '../../ui/Button/Button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../ui/dropdown-menu';
import { FIELD_TYPE_OPTIONS } from '../../../utils/board';
import {
  type FormField,
  type CreateFormSlideOutProps,
  type SelectDropdownProps,
} from './CreateFormSlideOut.types';

const SelectDropdown = ({
  value,
  onChange,
  options,
  disabled,
  placeholder,
}: SelectDropdownProps): ReactElement => {
  const selectedLabel =
    options.find(opt => opt.value === value)?.label || placeholder || 'Select...';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type='button'
          className='w-full h-[32px] px-[8px] py-[7px] bg-background border border-border rounded-[8px] text-[13px] text-left focus:outline-none focus:ring-0 cursor-pointer disabled:text-muted-foreground/50 disabled:cursor-not-allowed flex items-center justify-between'
        >
          <span className={value ? 'text-foreground' : 'text-muted-foreground/50'}>
            {selectedLabel}
          </span>
          <ChevronDown size={14} className='text-muted-foreground shrink-0 ml-1' />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className='w-full max-h-[280px] overflow-y-auto'>
        {options.map(option => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => onChange(option.value)}
            className={value === option.value ? 'bg-muted font-medium' : ''}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

// ─── Component ─────────────────────────────────────────────────────────────
export const CreateFormSlideOut = ({
  isOpen,
  onClose,
  onSave,
  onUpdate,
  formId,
  initialData,
  title = 'Create Form',
}: CreateFormSlideOutProps): ReactElement | null => {
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [fields, setFields] = useState<FormField[]>([]);
  const [expandedFieldId, setExpandedFieldId] = useState<string | null>(null);
  const fieldInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});
  const fieldsContainerRef = useRef<HTMLDivElement>(null);
  // Track whether we've already seeded the form with initialData for this open session
  const hasSeededRef = useRef(false);

  // When the panel opens, seed with initialData (if provided) or a blank first field
  useEffect(() => {
    if (!isOpen) {
      // Reset seed flag when closed so next open starts fresh
      hasSeededRef.current = false;
      return;
    }
    if (hasSeededRef.current) return;
    hasSeededRef.current = true;

    if (initialData) {
      setFormName(initialData.formName);
      setFormDescription(initialData.formDescription);
      setFields(initialData.fields);
      setExpandedFieldId(null);
    } else if (fields.length === 0) {
      const firstField: FormField = {
        id: uuidv4(),
        fieldName: '',
        fieldType: FormFieldType.STRING,
        isOptional: false,
      };
      setFields([firstField]);
      setExpandedFieldId(firstField.id);
      setTimeout(() => {
        fieldInputRefs.current[firstField.id]?.focus();
      }, 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Handle click outside to close expanded field
  useEffect(() => {
    if (!expandedFieldId) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const fieldsContainer = fieldsContainerRef.current;

      // Check if click is on a dropdown menu (portaled content)
      const isDropdownClick = (target as Element).closest(
        '[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]',
      );

      // Check if click is outside the fields container
      if (fieldsContainer && !fieldsContainer.contains(target) && !isDropdownClick) {
        // Don't close if the field name is empty
        const expandedField = fields.find(f => f.id === expandedFieldId);
        if (expandedField && !expandedField.fieldName.trim()) {
          return;
        }
        setExpandedFieldId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [expandedFieldId, fields]);

  // Add a new field
  const handleAddField = (): void => {
    const newField: FormField = {
      id: uuidv4(),
      fieldName: '',
      fieldType: FormFieldType.STRING,
      isOptional: false,
    };
    setFields(prev => [...prev, newField]);
    setExpandedFieldId(newField.id);
    // Focus the new field after a short delay
    setTimeout(() => {
      fieldInputRefs.current[newField.id]?.focus();
    }, 100);
  };

  // Update field
  const handleUpdateField = (fieldId: string, updates: Partial<FormField>): void => {
    setFields(prev => prev.map(field => (field.id === fieldId ? { ...field, ...updates } : field)));
  };

  // Delete field
  const handleDeleteField = (fieldId: string): void => {
    setFields(prev => prev.filter(field => field.id !== fieldId));
    if (expandedFieldId === fieldId) {
      setExpandedFieldId(null);
    }
  };

  // Toggle field expansion
  const handleToggleExpand = (fieldId: string): void => {
    setExpandedFieldId(prev => (prev === fieldId ? null : fieldId));
  };

  // Check if field is a select type
  const isSelectField = (fieldType: FormFieldType): boolean => {
    return fieldType === FormFieldType.SINGLE_SELECT || fieldType === FormFieldType.MULTI_SELECT;
  };

  // Handle save
  const handleSave = (): void => {
    if (!formName.trim() || fields.length === 0) return;

    const formData = {
      formName: formName.trim(),
      formDescription: formDescription.trim(),
      fields,
    };

    // If formId is provided, we're in edit mode
    if (formId && onUpdate) {
      onUpdate({
        formId,
        ...formData,
      });
    } else {
      onSave(formData);
    }

    // Reset form
    setFormName('');
    setFormDescription('');
    setFields([]);
    setExpandedFieldId(null);
    hasSeededRef.current = false;
  };

  // Check if form is valid
  const isValid =
    formName.trim() &&
    fields.length > 0 &&
    fields.every(
      f => f.fieldName.trim() && (!isSelectField(f.fieldType) || (f.fieldEnum?.length ?? 0) > 0),
    );

  if (!isOpen) return null;

  return (
    <div className='fixed right-[130px] top-[280px] bottom-[120px] z-50'>
      <div className='w-[500px] h-full bg-background rounded-[12px] shadow-[0px_0px_4px_0px_rgba(0,0,0,0.14),0px_8px_24px_0px_rgba(43,45,47,0.08)] flex flex-col overflow-hidden relative'>
        {/* Header */}
        <div className='flex items-center justify-between px-[16px] pt-[14px]'>
          <h2 className='text-[14px] font-medium text-foreground'>{title}</h2>
          <Button
            type='button'
            onClick={onClose}
            variant='ghost'
            size='iconSm'
            className='text-muted-foreground hover:text-foreground'
            data-track-category='board_config'
            data-track-name='close_create_form'
          >
            <X size={16} />
          </Button>
        </div>

        {/* Content */}
        <div className='flex-1 overflow-y-auto p-[16px] flex flex-col'>
          {/* Form Title Input */}
          <div>
            <input
              type='text'
              value={formName}
              onChange={e => setFormName(e.target.value)}
              placeholder='Form Title'
              className='w-full text-[17px] font-semibold text-foreground bg-transparent border-0 focus:outline-none focus:ring-0 p-0 placeholder:text-muted-foreground/50'
              data-track-category='board_config'
              data-track-name='form_title_input'
            />
            <textarea
              value={formDescription}
              onChange={e => setFormDescription(e.target.value)}
              placeholder='Add description'
              rows={2}
              className='w-full text-[14px] text-foreground bg-transparent border-0 focus:outline-none focus:ring-0 p-0 mt-1 resize-none placeholder:text-muted-foreground/50'
              data-track-category='board_config'
              data-track-name='form_description_input'
            />
          </div>

          {/* Fields List */}
          <div className='flex flex-col gap-[8px]' ref={fieldsContainerRef}>
            {fields.map(field => {
              const isExpanded = expandedFieldId === field.id;
              const showOptions = isSelectField(field.fieldType);

              return (
                <div
                  key={field.id}
                  className={`${isExpanded ? 'border border-border shadow-md' : ''} rounded-[12px] bg-background overflow-hidden transition-shadow`}
                >
                  {/* Field Header - Always visible */}
                  <div className='flex items-start justify-between px-[12px] py-[10px] gap-3'>
                    {/* GripVertical - Only in expanded state for drag */}
                    {isExpanded && (
                      <GripVertical size={16} className='text-muted-foreground mt-1' />
                    )}
                    <button
                      type='button'
                      className='flex flex-col gap-2 flex-1 text-left bg-transparent border-0 p-0 cursor-pointer'
                      onClick={() => {
                        if (!isExpanded) {
                          setExpandedFieldId(field.id);
                          setTimeout(() => {
                            fieldInputRefs.current[field.id]?.focus();
                          }, 100);
                        }
                      }}
                      data-track-category='board_config'
                      data-track-name='expand_field_header'
                    >
                      {!isExpanded && field.fieldName && (
                        <>
                          <span className='text-[14px] text-foreground font-medium mb-1'>
                            {field.fieldName}
                            {!field.isOptional && <span className='text-[#ff4f4f] ml-1'>*</span>}
                          </span>
                          <div className='w-full h-[36px] px-[12px] bg-background border border-border rounded-[12px] text-[13px] flex items-center justify-between mb-1'>
                            <span className='text-foreground'>
                              {FIELD_TYPE_OPTIONS.find(opt => opt.value === field.fieldType)
                                ?.label || 'Text'}
                            </span>
                            <ChevronDown size={14} className='text-muted-foreground' />
                          </div>
                          {(isSelectField(field.fieldType) ||
                            field.fieldType === FormFieldType.BOOLEAN) &&
                            field.fieldEnum &&
                            field.fieldEnum.length > 0 && (
                              <span className='text-[12px] text-muted-foreground'>
                                {field.fieldEnum.length} option
                                {field.fieldEnum.length > 1 ? 's' : ''}
                              </span>
                            )}
                        </>
                      )}
                    </button>
                    <div className='flex items-center gap-[12px]'>
                      {/* Required Toggle - Only in expanded state */}
                      {isExpanded && (
                        <div className='flex items-center gap-[10px]'>
                          <span className='text-[14px] text-foreground'>Required</span>
                          <button
                            onClick={() =>
                              handleUpdateField(field.id, { isOptional: !field.isOptional })
                            }
                            className={`w-[36px] h-[20px] rounded-full relative transition-colors ${
                              !field.isOptional ? 'bg-[#6276be]' : 'bg-muted'
                            }`}
                            data-track-category='board_config'
                            data-track-name='toggle_required'
                          >
                            <span
                              className={`absolute top-[2px] w-[16px] h-[16px] bg-background rounded-full transition-transform ${
                                !field.isOptional ? 'left-[18px]' : 'left-[2px]'
                              }`}
                            />
                          </button>
                        </div>
                      )}
                      {/* Delete Button - Only in expanded state */}
                      {isExpanded && (
                        <Button
                          onClick={() => handleDeleteField(field.id)}
                          variant='ghost'
                          size='iconSm'
                          className='text-muted-foreground hover:text-red-500'
                          data-track-category='board_config'
                          data-track-name='delete_field'
                        >
                          <Trash2 size={18} />
                        </Button>
                      )}
                      {/* Chevron - Only in expanded state */}
                      {isExpanded && (
                        <Button
                          onClick={() => handleToggleExpand(field.id)}
                          variant='ghost'
                          size='iconSm'
                          className='flex items-center justify-center'
                          data-track-category='board_config'
                          data-track-name='toggle_field_expand'
                        >
                          <ChevronDown
                            size={16}
                            className='text-muted-foreground transition-transform rotate-180'
                          />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div className='px-[12px] pb-[12px] pt-[4px] flex flex-col gap-[2px]'>
                      {/* Field Name Input */}
                      <div className='pb-3'>
                        <input
                          ref={el => {
                            fieldInputRefs.current[field.id] = el;
                          }}
                          type='text'
                          value={field.fieldName}
                          onChange={e => handleUpdateField(field.id, { fieldName: e.target.value })}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              setExpandedFieldId(null);
                            }
                          }}
                          placeholder='Enter question'
                          className='w-full text-[14px] text-foreground bg-transparent border-0 focus:outline-none focus:ring-0 p-0'
                          data-track-category='board_config'
                          data-track-name='field_name_input'
                        />
                      </div>

                      {/* Field Type Dropdown */}
                      <div>
                        <SelectDropdown
                          value={field.fieldType}
                          onChange={value =>
                            handleUpdateField(field.id, {
                              fieldType: value as FormFieldType,
                              ...(isSelectField(value as FormFieldType) && { fieldEnum: [] }),
                            })
                          }
                          options={FIELD_TYPE_OPTIONS.map(opt => ({
                            value: opt.value,
                            label: opt.label,
                          }))}
                        />
                      </div>

                      {/* Options for Select Fields */}
                      {showOptions && (
                        <div className='flex flex-col gap-[8px] mt-2 px-[12px]'>
                          <label
                            className='text-[12px] font-semibold'
                            htmlFor={`options-${field.id}`}
                          >
                            Enter Options
                          </label>
                          <div className='flex flex-col gap-[8px]'>
                            {field.fieldEnum?.map((option, optionIndex) => (
                              <div
                                key={optionIndex}
                                className='flex items-center gap-[8px] border border-border rounded-[8px] px-[8px] h-[34px]'
                              >
                                <GripVertical size={14} className='text-muted-foreground' />
                                <input
                                  type='text'
                                  value={option}
                                  onChange={e => {
                                    const newOptions = [...(field.fieldEnum || [])];
                                    newOptions[optionIndex] = e.target.value;
                                    handleUpdateField(field.id, { fieldEnum: newOptions });
                                  }}
                                  placeholder={`Option ${optionIndex + 1}`}
                                  className='flex-1 text-[13px] text-foreground bg-transparent border-0 focus:outline-none focus:ring-0 p-0'
                                  data-track-category='board_config'
                                  data-track-name='edit_option'
                                />
                                <Button
                                  onClick={() => {
                                    const newOptions =
                                      field.fieldEnum?.filter((_, i) => i !== optionIndex) || [];
                                    handleUpdateField(
                                      field.id,
                                      newOptions.length > 0 ? { fieldEnum: newOptions } : {},
                                    );
                                  }}
                                  variant='ghost'
                                  size='iconSm'
                                  className='text-muted-foreground hover:text-red-500'
                                  data-track-category='board_config'
                                  data-track-name='delete_form_field_option'
                                >
                                  <X size={14} />
                                </Button>
                              </div>
                            ))}
                            {/* Add Option Input */}
                            <div className='flex items-center gap-[8px] px-[6px] py-[4px]'>
                              <input
                                type='text'
                                placeholder={
                                  field.fieldEnum?.length ? 'Add another option' : 'Add option'
                                }
                                className='flex-1 text-[13px] bg-transparent border-0 focus:outline-none focus:ring-0 p-0'
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    const target = e.target as HTMLInputElement;
                                    const value = target.value;
                                    if (value.trim()) {
                                      handleUpdateField(field.id, {
                                        fieldEnum: [...(field.fieldEnum || []), value.trim()],
                                      });
                                      target.value = '';
                                    }
                                  }
                                }}
                                data-track-category='board_config'
                                data-track-name='add_option'
                              />
                              <span className='text-[14px] text-muted-foreground font-medium'>
                                ⏎
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add Question Button */}
          <Button
            onClick={handleAddField}
            variant='ghost'
            size='sm'
            className='text-[#6276be] font-medium hover:bg-blue-50 w-fit'
            data-track-category='board_config'
            data-track-name='add_question'
          >
            <Plus size={16} />
            Add question
          </Button>
        </div>

        {/* Footer */}
        <div className='px-[16px] py-[14px]'>
          <Button
            onClick={handleSave}
            disabled={!isValid}
            className='w-full bg-[#6276be] hover:bg-[#5060a0] disabled:bg-[#c9cccf] disabled:cursor-not-allowed text-white rounded-[8px] py-[6px] text-[13px] font-medium'
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
};
