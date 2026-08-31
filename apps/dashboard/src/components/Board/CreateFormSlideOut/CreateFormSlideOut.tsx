import { ReactElement, useState, useEffect, useRef, useCallback } from 'react';
import { X, Plus, GripVertical, Trash2, ChevronDown } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { FormFieldType, type FieldEnumOption } from '@xyne/shared';
import { toast } from 'sonner';
import { Button } from '../../ui/Button/Button';
import {
  GlobalFieldNameAutocomplete,
  type GlobalFieldSuggestion,
} from '../GlobalFieldNameAutocomplete';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../ui/dropdown-menu';
import {
  FIELD_TYPE_OPTIONS,
  MAX_FIELD_OPTIONS,
  mergeFieldOptions,
  normalizeFieldOptions,
  parseBulkOptions,
  createBulkOptionInputHandlers,
} from '../../../utils/board';
import {
  buildFieldTypeChangeUpdates,
  getSavableFormFields,
  getStartedFormFields,
  hasDuplicateFormFieldNames,
  hasFormFieldNameCollision,
  isFormBuilderSavable,
  isSelectFormFieldType,
} from '../../../utils/board/formFieldApiMapper';
import {
  type FormField,
  type CreateFormSlideOutProps,
  type SelectDropdownProps,
} from './CreateFormSlideOut.types';

type OptionsEditMode = 'individual' | 'bulk';

interface BulkOptionsFeedback {
  duplicatesRemoved: number;
  truncated: boolean;
}

const isSelectField = (fieldType: FormFieldType): boolean => isSelectFormFieldType(fieldType);

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
            data-track-category='board_config'
            data-track-name='SELECT_FORM_OPTION'
            className={value === option.value ? 'bg-muted font-medium' : ''}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

interface FieldEditorProps {
  field: FormField;
  projectId: string | undefined;
  isExpanded: boolean;
  registerInputRef: (fieldId: string, el: HTMLInputElement | null) => void;
  registerFieldOptionsResolver: (
    fieldId: string,
    resolver: (() => FieldEnumOption[]) | null,
  ) => void;
  onExpand: (fieldId: string) => void;
  onToggleExpand: (fieldId: string) => void;
  onUpdate: (fieldId: string, updates: Partial<FormField>) => void;
  onChangeType: (fieldId: string, nextType: FormFieldType) => void;
  onDelete: (fieldId: string) => void;
  onNameChange: (fieldId: string, nextName: string) => void;
  onSelectExistingGlobalField: (fieldId: string, suggestion: GlobalFieldSuggestion) => void;
  onCreateAsNewField: (fieldId: string) => void;
  getBranchFields: (optionId: string) => FormField[];
  isOptionBranchExpanded: (optionId: string) => boolean;
  onToggleOptionBranchPanel: (optionId: string) => void;
  onAddBranchField: (optionId: string) => void;
  onOptionsRemoved: (fieldId: string, optionIds: string[]) => void;
  // A branch child's own expand/collapse state is tracked separately from its parent's (see
  // expandedBranchFieldId in CreateFormSlideOut) — these are only used when rendering children.
  expandedBranchFieldId: string | null;
  onExpandBranchField: (fieldId: string) => void;
  onToggleExpandBranchField: (fieldId: string) => void;
}

const FieldEditor = ({
  field,
  projectId,
  isExpanded,
  registerInputRef,
  registerFieldOptionsResolver,
  onExpand,
  onToggleExpand,
  onUpdate,
  onChangeType,
  onDelete,
  onNameChange,
  onSelectExistingGlobalField,
  onCreateAsNewField,
  getBranchFields,
  isOptionBranchExpanded,
  onToggleOptionBranchPanel,
  onAddBranchField,
  onOptionsRemoved,
  expandedBranchFieldId,
  onExpandBranchField,
  onToggleExpandBranchField,
}: FieldEditorProps): ReactElement => {
  const showOptions = isSelectField(field.fieldType);
  const options = field.fieldEnum ?? [];
  const supportsBranching =
    field.fieldType === FormFieldType.SINGLE_SELECT && !field.parentOptionId;
  const selectedGlobalField: GlobalFieldSuggestion | undefined = field.persistedFieldId
    ? {
        id: field.persistedFieldId,
        fieldName: field.fieldName,
        fieldType: field.fieldType,
        ...(field.fieldEnum ? { fieldEnum: field.fieldEnum } : {}),
      }
    : undefined;

  const [editMode, setEditMode] = useState<OptionsEditMode>('individual');
  const [bulkDraft, setBulkDraft] = useState('');
  const [feedback, setFeedback] = useState<BulkOptionsFeedback | null>(null);

  const setOptions = (next: FieldEnumOption[], nextFeedback?: BulkOptionsFeedback): void => {
    onUpdate(field.id, { fieldEnum: next });
    if (nextFeedback) {
      setFeedback(nextFeedback);
    }
  };

  const editOption = (index: number, value: string): void => {
    const next = [...options];
    const current = next[index];
    if (!current) return;
    next[index] = { ...current, value };
    onUpdate(field.id, { fieldEnum: next });
  };

  const removeOption = (index: number): void => {
    const removed = options[index];
    onUpdate(field.id, { fieldEnum: options.filter((_, i) => i !== index) });
    if (removed) onOptionsRemoved(field.id, [removed.id]);
  };

  // Adds one or more options at once (typed Enter or pasted list), de-duping and
  // capping at MAX_FIELD_OPTIONS via mergeFieldOptions.
  const addOptions = (incoming: string[]): void => {
    const { options: merged, duplicatesRemoved, truncated } = mergeFieldOptions(options, incoming);
    setOptions(merged, { duplicatesRemoved, truncated });
  };

  const bulkOptionInputHandlers = createBulkOptionInputHandlers(addOptions);

  useEffect(() => {
    if (!showOptions) {
      registerFieldOptionsResolver(field.id, null);
      return;
    }

    registerFieldOptionsResolver(field.id, () => {
      if (editMode === 'bulk') {
        return normalizeFieldOptions(parseBulkOptions(bulkDraft), options).options;
      }
      return options;
    });

    return () => registerFieldOptionsResolver(field.id, null);
  }, [bulkDraft, editMode, field.id, options, registerFieldOptionsResolver, showOptions]);

  const applyBulkDraft = (): void => {
    const parsed = parseBulkOptions(bulkDraft);
    const { options: next, duplicatesRemoved, truncated } = normalizeFieldOptions(parsed, options);
    const removedOptionIds = options
      .filter(option => !next.some(nextOption => nextOption.id === option.id))
      .map(option => option.id);
    setBulkDraft(next.map(option => option.value).join('\n'));
    setOptions(next, { duplicatesRemoved, truncated });
    if (removedOptionIds.length > 0) onOptionsRemoved(field.id, removedOptionIds);
  };

  const toggleEditMode = (): void => {
    if (editMode === 'individual') {
      setEditMode('bulk');
      setBulkDraft(options.map(option => option.value).join('\n'));
      setFeedback(null);
      return;
    }

    applyBulkDraft();
    setEditMode('individual');
  };

  return (
    <div
      className={`relative ${isExpanded ? 'z-20 border border-border shadow-md overflow-visible' : 'overflow-hidden'} rounded-[12px] bg-background transition-shadow`}
    >
      {/* Field Header - Always visible */}
      <div className='flex items-start justify-between px-[12px] py-[10px] gap-3'>
        {/* GripVertical - Only in expanded state for drag */}
        {isExpanded && <GripVertical size={16} className='text-muted-foreground mt-1' />}
        <button
          type='button'
          className='flex flex-col gap-2 flex-1 text-left bg-transparent border-0 p-0 cursor-pointer'
          onClick={() => {
            if (!isExpanded) onExpand(field.id);
          }}
          data-track-category='board_config'
          data-track-name='expand_field_header'
        >
          {!isExpanded && (
            <>
              <div className='flex items-center gap-2 mb-1'>
                <span
                  className={`text-[14px] font-medium ${
                    field.fieldName ? 'text-foreground' : 'italic text-muted-foreground/60'
                  }`}
                >
                  {field.fieldName || 'Untitled question'}
                  {field.fieldName && !field.isOptional && (
                    <span className='text-[#ff4f4f] ml-1'>*</span>
                  )}
                </span>
              </div>
              <div className='w-full h-[36px] px-[12px] bg-background border border-border rounded-[12px] text-[13px] flex items-center justify-between mb-1'>
                <span className='text-foreground'>
                  {FIELD_TYPE_OPTIONS.find(opt => opt.value === field.fieldType)?.label || 'Text'}
                </span>
                <ChevronDown size={14} className='text-muted-foreground' />
              </div>
              {(isSelectField(field.fieldType) || field.fieldType === FormFieldType.BOOLEAN) &&
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
                type='button'
                onClick={() => onUpdate(field.id, { isOptional: !field.isOptional })}
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
              onClick={() => onDelete(field.id)}
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
              onClick={() => onToggleExpand(field.id)}
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
          {/* Field Name Input - Only in expanded state */}
          <div className='pb-3'>
            <GlobalFieldNameAutocomplete
              value={field.fieldName}
              onChange={value => onNameChange(field.id, value)}
              projectId={projectId}
              inputRef={el => registerInputRef(field.id, el)}
              placeholder='Enter question'
              className='w-full text-[14px] text-foreground bg-transparent border-0 focus:outline-none focus:ring-0 p-0'
              data-track-category='board_config'
              data-track-name='field_name_input'
              selectedField={selectedGlobalField}
              onCreateNew={selectedGlobalField ? () => onCreateAsNewField(field.id) : undefined}
              onSelectExisting={suggestion => onSelectExistingGlobalField(field.id, suggestion)}
            />
          </div>

          {/* Field Type Dropdown */}
          <div>
            <SelectDropdown
              value={field.fieldType}
              onChange={value => onChangeType(field.id, value as FormFieldType)}
              options={FIELD_TYPE_OPTIONS.map(opt => ({
                value: opt.value,
                label: opt.label,
              }))}
            />
          </div>

          {/* Options for Select Fields */}
          {showOptions && (
            <div className='flex flex-col gap-[8px] mt-2 px-[12px]'>
              <>
                <div className='flex items-center justify-between gap-2'>
                  <label className='text-[12px] font-semibold' htmlFor={`options-${field.id}`}>
                    Enter Options
                  </label>
                  <button
                    type='button'
                    onClick={toggleEditMode}
                    className='text-[12px] text-[#6276be] font-medium hover:underline'
                    data-track-category='board_config'
                    data-track-name={
                      editMode === 'bulk'
                        ? 'switch_to_individual_options'
                        : 'switch_to_bulk_options'
                    }
                  >
                    {editMode === 'bulk' ? 'Edit one at a time' : 'Bulk add'}
                  </button>
                </div>

                {editMode === 'bulk' ? (
                  <div className='flex flex-col gap-[6px]'>
                    <textarea
                      id={`options-${field.id}`}
                      value={bulkDraft}
                      onChange={e => setBulkDraft(e.target.value)}
                      onBlur={applyBulkDraft}
                      placeholder='One option per line. Paste from a spreadsheet, comma-separated list, etc.'
                      rows={8}
                      className='w-full min-h-[120px] max-h-[240px] px-[10px] py-[8px] text-[13px] text-foreground bg-background border border-border rounded-[8px] resize-y focus:outline-none focus:ring-1 focus:ring-[#6276be]/40'
                      data-track-category='board_config'
                      data-track-name='bulk_options_textarea'
                    />
                    <div className='flex flex-col gap-[2px]'>
                      <span className='text-[11px] text-muted-foreground'>
                        {options.length > 0
                          ? `${options.length} option${options.length === 1 ? '' : 's'}`
                          : 'No options yet'}
                        {feedback?.duplicatesRemoved
                          ? ` · ${feedback.duplicatesRemoved} duplicate${
                              feedback.duplicatesRemoved === 1 ? '' : 's'
                            } removed`
                          : ''}
                      </span>
                      {feedback?.truncated && (
                        <span className='text-[11px] text-amber-600'>
                          Maximum {MAX_FIELD_OPTIONS} options. Extra entries were removed.
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className='flex flex-col gap-[8px]'>
                    {options.map((option, optionIndex) => {
                      const branchFields = supportsBranching ? getBranchFields(option.id) : [];
                      const isBranchExpanded =
                        supportsBranching && isOptionBranchExpanded(option.id);

                      return (
                        <div key={option.id}>
                          <div className='flex items-center gap-[8px] border border-border rounded-[8px] px-[8px] h-[34px]'>
                            <GripVertical size={14} className='text-muted-foreground' />
                            <input
                              type='text'
                              value={option.value}
                              onChange={e => editOption(optionIndex, e.target.value)}
                              placeholder={`Option ${optionIndex + 1}`}
                              className='flex-1 text-[13px] text-foreground bg-transparent border-0 focus:outline-none focus:ring-0 p-0'
                              data-track-category='board_config'
                              data-track-name='edit_option'
                            />
                            {supportsBranching && (
                              <button
                                type='button'
                                onClick={() => onToggleOptionBranchPanel(option.id)}
                                className={`text-[11px] font-mono px-2 py-[3px] rounded-full whitespace-nowrap flex-shrink-0 ${
                                  branchFields.length > 0
                                    ? 'bg-[#6276be]/10 text-[#6276be] hover:bg-[#6276be] hover:text-white'
                                    : 'border border-dashed border-border text-muted-foreground hover:border-[#6276be] hover:text-[#6276be] hover:bg-[#6276be]/10'
                                }`}
                                data-track-category='board_config'
                                data-track-name='toggle_option_branch_panel'
                              >
                                {branchFields.length > 0
                                  ? `${branchFields.length} field${branchFields.length === 1 ? '' : 's'}`
                                  : '+ Add fields'}
                              </button>
                            )}
                            <Button
                              onClick={() => removeOption(optionIndex)}
                              variant='ghost'
                              size='iconSm'
                              className='text-muted-foreground hover:text-red-500'
                              data-track-category='board_config'
                              data-track-name='delete_form_field_option'
                            >
                              <X size={14} />
                            </Button>
                          </div>

                          {supportsBranching && isBranchExpanded && (
                            <div className='ml-6 mt-1 mb-1 flex flex-col gap-[6px] border border-border rounded-[8px] p-[6px] bg-muted/30'>
                              {branchFields.map(childField => (
                                <FieldEditor
                                  key={childField.id}
                                  field={childField}
                                  projectId={projectId}
                                  isExpanded={expandedBranchFieldId === childField.id}
                                  registerInputRef={registerInputRef}
                                  registerFieldOptionsResolver={registerFieldOptionsResolver}
                                  onExpand={onExpandBranchField}
                                  onToggleExpand={onToggleExpandBranchField}
                                  onUpdate={onUpdate}
                                  onChangeType={onChangeType}
                                  onDelete={onDelete}
                                  onNameChange={onNameChange}
                                  onSelectExistingGlobalField={onSelectExistingGlobalField}
                                  onCreateAsNewField={onCreateAsNewField}
                                  getBranchFields={getBranchFields}
                                  isOptionBranchExpanded={isOptionBranchExpanded}
                                  onToggleOptionBranchPanel={onToggleOptionBranchPanel}
                                  onAddBranchField={onAddBranchField}
                                  onOptionsRemoved={onOptionsRemoved}
                                  expandedBranchFieldId={expandedBranchFieldId}
                                  onExpandBranchField={onExpandBranchField}
                                  onToggleExpandBranchField={onToggleExpandBranchField}
                                />
                              ))}
                              <button
                                type='button'
                                onClick={() => onAddBranchField(option.id)}
                                className='w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[12px] text-[#6276be] hover:bg-[#6276be]/10 rounded-[6px]'
                                data-track-category='board_config'
                                data-track-name='add_branch_field'
                              >
                                <Plus size={13} />
                                Add field
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {/* Add Option Input */}
                    <div className='flex flex-col gap-[4px]'>
                      <div className='flex items-center gap-[8px] px-[6px] py-[4px]'>
                        <input
                          type='text'
                          placeholder={
                            options.length
                              ? 'Add another option (paste multiple at once)'
                              : 'Add option (paste multiple at once)'
                          }
                          className='flex-1 text-[13px] bg-transparent border-0 focus:outline-none focus:ring-0 p-0'
                          onKeyDown={bulkOptionInputHandlers.onKeyDown}
                          onPaste={bulkOptionInputHandlers.onPaste}
                          data-track-category='board_config'
                          data-track-name='add_option'
                        />
                        <span className='text-[14px] text-muted-foreground font-medium'>⏎</span>
                      </div>
                      {feedback && (feedback.duplicatesRemoved > 0 || feedback.truncated) && (
                        <span className='text-[11px] text-muted-foreground px-[6px]'>
                          {feedback.duplicatesRemoved > 0 &&
                            `${feedback.duplicatesRemoved} duplicate${
                              feedback.duplicatesRemoved === 1 ? '' : 's'
                            } skipped`}
                          {feedback.duplicatesRemoved > 0 && feedback.truncated && ' · '}
                          {feedback.truncated && `Maximum ${MAX_FIELD_OPTIONS} options`}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Component ─────────────────────────────────────────────────────────────
export const CreateFormSlideOut = ({
  isOpen,
  onClose,
  onSave,
  onUpdate,
  formId,
  projectId,
  initialData,
  title = 'Create Form',
  embedded = false,
  submitLabel = 'Save',
}: CreateFormSlideOutProps): ReactElement | null => {
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [fields, setFields] = useState<FormField[]>([]);
  const [expandedFieldId, setExpandedFieldId] = useState<string | null>(null);
  // A branch child's own editor lives inside its parent's expanded content, so it needs its own
  // "which one is open" state — sharing expandedFieldId would collapse the parent (and hide the
  // child along with it) the moment a child got expanded.
  const [expandedBranchFieldId, setExpandedBranchFieldId] = useState<string | null>(null);
  const [expandedOptionIds, setExpandedOptionIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const fieldInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});
  const fieldsContainerRef = useRef<HTMLDivElement>(null);
  const fieldOptionsResolversRef = useRef<Map<string, () => FieldEnumOption[]>>(new Map());
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
    } else {
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
  }, [isOpen, initialData]);

  // Handle click outside to close expanded field(s)
  useEffect(() => {
    if (!expandedFieldId && !expandedBranchFieldId) return;

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
        if (expandedFieldId) {
          const expandedField = fields.find(f => f.id === expandedFieldId);
          if (!expandedField || expandedField.fieldName.trim()) {
            setExpandedFieldId(null);
          }
        }
        if (expandedBranchFieldId) {
          const expandedChild = fields.find(f => f.id === expandedBranchFieldId);
          if (!expandedChild || expandedChild.fieldName.trim()) {
            setExpandedBranchFieldId(null);
          }
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [expandedFieldId, expandedBranchFieldId, fields]);

  const expandField = (fieldId: string): void => {
    setExpandedFieldId(fieldId);
    setTimeout(() => {
      fieldInputRefs.current[fieldId]?.focus();
    }, 100);
  };

  const expandBranchField = (fieldId: string): void => {
    setExpandedBranchFieldId(fieldId);
    setTimeout(() => {
      fieldInputRefs.current[fieldId]?.focus();
    }, 100);
  };

  const handleToggleBranchExpand = (fieldId: string): void => {
    setExpandedBranchFieldId(prev => (prev === fieldId ? null : fieldId));
  };

  const registerInputRef = (fieldId: string, el: HTMLInputElement | null): void => {
    fieldInputRefs.current[fieldId] = el;
  };

  const registerFieldOptionsResolver = useCallback(
    (fieldId: string, resolver: (() => FieldEnumOption[]) | null): void => {
      if (resolver) {
        fieldOptionsResolversRef.current.set(fieldId, resolver);
      } else {
        fieldOptionsResolversRef.current.delete(fieldId);
      }
    },
    [],
  );

  // Add a new field
  const handleAddField = (): void => {
    const newField: FormField = {
      id: uuidv4(),
      fieldName: '',
      fieldType: FormFieldType.STRING,
      isOptional: false,
    };
    setFields(prev => [...prev, newField]);
    expandField(newField.id);
  };

  // Update field
  const handleUpdateField = (fieldId: string, updates: Partial<FormField>): void => {
    setFields(prev =>
      prev.map(field => {
        if (field.id !== fieldId) return field;
        const nextField = { ...field, ...updates };
        if (
          updates.fieldType !== undefined &&
          !isSelectFormFieldType(updates.fieldType) &&
          isSelectFormFieldType(field.fieldType)
        ) {
          const { fieldEnum: _removed, ...withoutOptions } = nextField;
          return withoutOptions;
        }
        return nextField;
      }),
    );
  };

  const handleNameChange = (fieldId: string, nextName: string): void => {
    handleUpdateField(fieldId, { fieldName: nextName });
  };

  const handleSelectExistingGlobalField = (
    fieldId: string,
    suggestion: GlobalFieldSuggestion,
  ): void => {
    if (
      hasFormFieldNameCollision(
        fields.filter(field => field.id !== fieldId),
        suggestion.fieldName,
      )
    ) {
      toast.error(`"${suggestion.fieldName}" is already used in this form`);
      return;
    }
    handleUpdateField(fieldId, {
      fieldName: suggestion.fieldName,
      fieldType: suggestion.fieldType,
      persistedFieldId: suggestion.id,
      ...(suggestion.fieldEnum ? { fieldEnum: suggestion.fieldEnum } : {}),
    });
  };

  const handleCreateAsNewField = (fieldId: string): void => {
    handleUpdateField(fieldId, { persistedFieldId: undefined });
  };

  const handleChangeFieldType = (fieldId: string, nextType: FormFieldType): void => {
    const current = fields.find(field => field.id === fieldId);
    if (!current) return;
    const updates = buildFieldTypeChangeUpdates(current.fieldType, nextType);
    const leavingSingleSelect =
      current.fieldType === FormFieldType.SINGLE_SELECT && nextType !== FormFieldType.SINGLE_SELECT;
    const oldOptionIds = leavingSingleSelect
      ? new Set((current.fieldEnum ?? []).map(option => option.id))
      : null;

    setFields(prev => {
      const next = prev.map(field => (field.id === fieldId ? { ...field, ...updates } : field));
      if (!oldOptionIds || oldOptionIds.size === 0) return next;

      const orphaned = next.filter(
        field => !!field.parentOptionId && oldOptionIds.has(field.parentOptionId),
      );
      if (orphaned.length > 0) {
        toast.error(
          `Removed field${orphaned.length === 1 ? '' : 's'} that depended on "${current.fieldName || 'this field'}": ${orphaned
            .map(field => field.fieldName || 'Untitled')
            .join(', ')}`,
        );
      }
      return next.filter(
        field => !(!!field.parentOptionId && oldOptionIds.has(field.parentOptionId)),
      );
    });
  };

  // Delete field — also removes any branch children that depend on one of its options.
  const handleDeleteField = (fieldId: string): void => {
    let removedIds = new Set<string>([fieldId]);
    setFields(prev => {
      const target = prev.find(field => field.id === fieldId);
      const optionIds = new Set((target?.fieldEnum ?? []).map(option => option.id));
      const orphaned = prev.filter(
        field =>
          field.id !== fieldId && !!field.parentOptionId && optionIds.has(field.parentOptionId),
      );
      if (orphaned.length > 0) {
        toast.error(
          `Removed field${orphaned.length === 1 ? '' : 's'} that depended on "${target?.fieldName || 'this field'}": ${orphaned
            .map(field => field.fieldName || 'Untitled')
            .join(', ')}`,
        );
      }
      removedIds = new Set([fieldId, ...orphaned.map(field => field.id)]);
      return prev.filter(field => !removedIds.has(field.id));
    });
    if (expandedFieldId && removedIds.has(expandedFieldId)) {
      setExpandedFieldId(null);
    }
    if (expandedBranchFieldId && removedIds.has(expandedBranchFieldId)) {
      setExpandedBranchFieldId(null);
    }
  };

  // Adds a branch child gated to a specific option — appears only when that option is selected.
  const handleAddBranchField = (optionId: string): void => {
    const newField: FormField = {
      id: uuidv4(),
      fieldName: '',
      fieldType: FormFieldType.STRING,
      isOptional: false,
      parentOptionId: optionId,
    };
    setFields(prev => [...prev, newField]);
    setExpandedOptionIds(prev => new Set(prev).add(optionId));
    expandBranchField(newField.id);
  };

  const handleToggleOptionBranchPanel = (optionId: string): void => {
    setExpandedOptionIds(prev => {
      const next = new Set(prev);
      if (next.has(optionId)) {
        next.delete(optionId);
      } else {
        next.add(optionId);
      }
      return next;
    });
  };

  const getBranchFields = useCallback(
    (optionId: string): FormField[] => fields.filter(field => field.parentOptionId === optionId),
    [fields],
  );

  const isOptionBranchExpanded = useCallback(
    (optionId: string): boolean => expandedOptionIds.has(optionId),
    [expandedOptionIds],
  );

  // Fired when a field's options list drops one or more ids (single remove or a bulk-edit
  // reconciliation) — any branch child gated to a removed option is now orphaned and is dropped
  // too, with a toast so the admin knows it happened rather than it silently disappearing.
  const handleOptionsRemoved = (_fieldId: string, optionIds: string[]): void => {
    setFields(prev => {
      const orphaned = prev.filter(
        field => !!field.parentOptionId && optionIds.includes(field.parentOptionId),
      );
      if (orphaned.length > 0) {
        toast.error(
          `Removed field${orphaned.length === 1 ? '' : 's'} that depended on the removed option${
            optionIds.length === 1 ? '' : 's'
          }: ${orphaned.map(field => field.fieldName || 'Untitled').join(', ')}`,
        );
      }
      return prev.filter(
        field => !(!!field.parentOptionId && optionIds.includes(field.parentOptionId)),
      );
    });
  };

  // Toggle field expansion
  const handleToggleExpand = (fieldId: string): void => {
    setExpandedFieldId(prev => (prev === fieldId ? null : fieldId));
  };

  // Handle save
  const handleSave = async (): Promise<void> => {
    if (isSubmittingRef.current || !isFormBuilderSavable(formName, fields)) return;

    const formData = {
      formName: formName.trim(),
      formDescription: formDescription.trim(),
      fields: getSavableFormFields(fields),
    };

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      // If formId is provided, we're in edit mode
      if (formId && onUpdate) {
        await onUpdate({ formId, ...formData });
      } else {
        await onSave(formData);
      }
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const invalidReason: string | null = !formName.trim()
    ? 'Add a form title'
    : getStartedFormFields(fields).length === 0
      ? 'Add at least one question'
      : hasDuplicateFormFieldNames(fields)
        ? 'Field names must be unique within this form'
        : getStartedFormFields(fields).some(f => !f.fieldName.trim())
          ? 'Enter a question in every field'
          : getStartedFormFields(fields).some(
                f =>
                  isSelectField(f.fieldType) &&
                  (f.fieldEnum ?? []).map(option => option.value.trim()).filter(Boolean).length ===
                    0,
              )
            ? 'Add at least one option to every select question'
            : null;
  const isValid = isFormBuilderSavable(formName, fields);

  if (!isOpen) return null;

  return (
    <div
      className={
        embedded
          ? 'flex w-full min-h-0 flex-col'
          : 'fixed right-[130px] top-[280px] bottom-[120px] z-50'
      }
    >
      <div
        className={
          embedded
            ? 'flex w-full min-h-0 flex-col overflow-hidden rounded-[12px] border border-border bg-background'
            : 'w-[500px] h-full bg-background rounded-[12px] shadow-[0px_0px_4px_0px_rgba(0,0,0,0.14),0px_8px_24px_0px_rgba(43,45,47,0.08)] flex flex-col overflow-hidden relative'
        }
      >
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
        <div
          className={
            embedded
              ? 'flex min-h-0 flex-col p-[12px]'
              : 'flex-1 overflow-y-auto p-[16px] flex flex-col'
          }
        >
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
            {fields
              .filter(field => !field.parentOptionId)
              .map(field => (
                <FieldEditor
                  key={field.id}
                  field={field}
                  projectId={projectId}
                  isExpanded={expandedFieldId === field.id}
                  registerInputRef={registerInputRef}
                  registerFieldOptionsResolver={registerFieldOptionsResolver}
                  onExpand={expandField}
                  onToggleExpand={handleToggleExpand}
                  onUpdate={handleUpdateField}
                  onChangeType={handleChangeFieldType}
                  onDelete={handleDeleteField}
                  onNameChange={handleNameChange}
                  onSelectExistingGlobalField={handleSelectExistingGlobalField}
                  onCreateAsNewField={handleCreateAsNewField}
                  getBranchFields={getBranchFields}
                  isOptionBranchExpanded={isOptionBranchExpanded}
                  onToggleOptionBranchPanel={handleToggleOptionBranchPanel}
                  onAddBranchField={handleAddBranchField}
                  onOptionsRemoved={handleOptionsRemoved}
                  expandedBranchFieldId={expandedBranchFieldId}
                  onExpandBranchField={expandBranchField}
                  onToggleExpandBranchField={handleToggleBranchExpand}
                />
              ))}
          </div>

          {/* Add Question Button */}
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              onClick={handleAddField}
              variant='ghost'
              size='sm'
              className='text-[#6276be] font-medium hover:bg-blue-50 w-fit'
              data-track-category='board_config'
              data-track-name='add_question'
            >
              <Plus size={16} />
              Add field
            </Button>
          </div>
        </div>

        {/* Footer */}
        <div className='px-[16px] py-[14px]'>
          {invalidReason && (
            <p className='text-[12px] text-muted-foreground mb-2 text-center'>{invalidReason}</p>
          )}
          <Button
            onClick={() => void handleSave()}
            data-track-category='board_config'
            data-track-name='SAVE_FORM'
            disabled={!isValid || isSubmitting}
            className='w-full bg-[#6276be] hover:bg-[#5060a0] disabled:bg-[#c9cccf] disabled:cursor-not-allowed text-white rounded-[8px] py-[6px] text-[13px] font-medium'
          >
            {isSubmitting ? `${submitLabel}…` : submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};
