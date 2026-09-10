import { ReactElement, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { GripVertical, Trash2, CornerDownLeft, Check, ChevronDown, Plus } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import type { TicketField } from '../BoardEditScreen/BoardEditScreen.types';
import { mapFromFormFieldType, mapToFormFieldType } from '../BoardEditScreen/BoardEditScreen.types';
import { getFieldTypeLabel } from '../BoardEditScreen/BoardEditScreen.utils';
import { type FieldType, type CustomFieldProps } from './CustomField.types';
import type { FieldEnumOption } from '@xyne/shared';
import {
  GlobalFieldNameAutocomplete,
  type GlobalFieldSuggestion,
} from '../GlobalFieldNameAutocomplete';
import {
  MAX_FIELD_OPTIONS,
  mergeFieldOptions,
  parseBulkOptions,
  createBulkOptionInputHandlers,
  resolveBulkOptions,
} from '../../../utils/board';

// Which branch-related nested editor (if any) is currently open. A branch field is added or
// edited via another CustomField instance, rendered right inside the option's own panel.
type BranchEditorState =
  | { kind: 'add'; optionId: string }
  | { kind: 'edit'; field: TicketField }
  | null;

type OptionsEditMode = 'individual' | 'bulk';

interface BulkOptionsFeedback {
  duplicatesRemoved: number;
  truncated: boolean;
}

// An unmatched bulk-edit option that has branch fields depending on it — the admin must say
// whether it was renamed (keep them) or replaced (drop them) before the edit applies.
interface PendingOptionDecision {
  oldOption: FieldEnumOption;
  dependentNames: string[];
  candidateValues: string[];
  renameTo: string | null;
  resolution: 'rename' | 'replace' | null;
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
  getDependentFieldNames,
  onPendingDecisionChange,
  getBranchFields,
  onSaveBranchField,
  onDeleteBranchField,
}: CustomFieldProps): ReactElement => {
  const [fieldName, setFieldName] = useState(field?.label || '');
  const [fieldType, setFieldType] = useState<FieldType>((field?.type as FieldType) || 'text');
  const [fieldRequired, setFieldRequired] = useState(field?.required || false);
  const [fieldOptions, setFieldOptions] = useState<FieldEnumOption[]>(field?.options || []);
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
  const [pendingDecisions, setPendingDecisions] = useState<PendingOptionDecision[] | null>(null);
  const [draggingOptionIndex, setDraggingOptionIndex] = useState<number | null>(null);
  const [fieldTypeDropdownOpen, setFieldTypeDropdownOpen] = useState(false);
  // Branch panels only ever apply to an already-saved, top-level Single Select field — a
  // brand-new field (mode='create') has no id yet for anything to branch off of, and a
  // field that's itself a branch child can't have children of its own (one level only).
  const supportsBranching = mode === 'edit' && !field?.parentOptionId && !!getBranchFields;
  // Options that already have branch fields start expanded; empty ones start collapsed.
  const [expandedOptionIds, setExpandedOptionIds] = useState<Set<string>>(() => {
    if (!supportsBranching || !getBranchFields) return new Set();
    return new Set(
      (field?.options ?? [])
        .filter(option => getBranchFields(option.id).length > 0)
        .map(option => option.id),
    );
  });
  const [branchEditor, setBranchEditor] = useState<BranchEditorState>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fieldTypeDropdownRef = useRef<HTMLDivElement>(null);
  const isSavingRef = useRef(false);
  const outsideSaveTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (mode === 'create' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [mode]);

  // Tell the parent whenever a decision is outstanding (and clear it on unmount), since the
  // board-level Save button needs to stop too, not just this field's own save.
  useEffect(() => {
    onPendingDecisionChange?.(!!pendingDecisions && pendingDecisions.length > 0);
    return () => onPendingDecisionChange?.(false);
  }, [pendingDecisions, onPendingDecisionChange]);

  // Re-derives options from the bulk textarea. Returns them if resolved cleanly, or null if
  // it paused on an ambiguous rename (see `pendingDecisions`) — callers must bail on null.
  const tryApplyBulkDraft = useCallback((): FieldEnumOption[] | null => {
    const parsed = parseBulkOptions(bulkDraft);
    const resolution = resolveBulkOptions(parsed, fieldOptions);

    const needsDecision = getDependentFieldNames
      ? resolution.renameCandidates.filter(
          candidate => getDependentFieldNames(candidate.oldOption.id).length > 0,
        )
      : [];

    if (needsDecision.length > 0) {
      setPendingDecisions(
        needsDecision.map(candidate => ({
          oldOption: candidate.oldOption,
          dependentNames: getDependentFieldNames?.(candidate.oldOption.id) ?? [],
          candidateValues: candidate.candidateValues,
          renameTo: candidate.candidateValues[0] ?? null,
          resolution: null,
        })),
      );
      return null;
    }

    setFieldOptions(resolution.options);
    setBulkDraft(resolution.options.map(option => option.value).join('\n'));
    setBulkFeedback({
      duplicatesRemoved: resolution.duplicatesRemoved,
      truncated: resolution.truncated,
    });
    setPendingDecisions(null);
    return resolution.options;
  }, [bulkDraft, fieldOptions, getDependentFieldNames]);

  const handleSave = useCallback(() => {
    if (isSavingRef.current) return;

    if (!fieldName.trim()) {
      isSavingRef.current = true;
      onCancel();
      return;
    }

    let optionsToSave = fieldOptions;
    if ((fieldType === 'select' || fieldType === 'multiselect') && optionsEditMode === 'bulk') {
      const resolved = tryApplyBulkDraft();
      if (resolved === null) return; // paused — waiting on the admin to resolve a rename/replace decision
      optionsToSave = resolved;
    }

    // Don't save select/multiselect if no options added
    if ((fieldType === 'select' || fieldType === 'multiselect') && optionsToSave.length === 0) {
      isSavingRef.current = true;
      onCancel();
      return;
    }

    isSavingRef.current = true;

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
    tryApplyBulkDraft,
  ]);

  const resolveDecision = useCallback((index: number, resolution: 'rename' | 'replace') => {
    setPendingDecisions(prev =>
      prev
        ? prev.map((decision, i) => (i === index ? { ...decision, resolution } : decision))
        : prev,
    );
  }, []);

  const setDecisionRenameTarget = useCallback((index: number, renameTo: string) => {
    setPendingDecisions(prev =>
      prev ? prev.map((decision, i) => (i === index ? { ...decision, renameTo } : decision)) : prev,
    );
  }, []);

  const finalizePendingDecisions = useCallback(() => {
    if (!pendingDecisions || pendingDecisions.some(decision => decision.resolution === null))
      return;

    const parsed = parseBulkOptions(bulkDraft);
    const resolution = resolveBulkOptions(parsed, fieldOptions);

    let finalOptions = resolution.options;
    for (const decision of pendingDecisions) {
      if (decision.resolution === 'rename' && decision.renameTo) {
        finalOptions = finalOptions.map(option =>
          option.value === decision.renameTo
            ? { id: decision.oldOption.id, value: decision.renameTo }
            : option,
        );
      }
    }

    setFieldOptions(finalOptions);
    setBulkDraft(finalOptions.map(option => option.value).join('\n'));
    setBulkFeedback({
      duplicatesRemoved: resolution.duplicatesRemoved,
      truncated: resolution.truncated,
    });
    setPendingDecisions(null);
  }, [pendingDecisions, bulkDraft, fieldOptions]);

  // Click outside to save
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        if (supportsBranching) {
          outsideSaveTimeoutRef.current = window.setTimeout(() => {
            outsideSaveTimeoutRef.current = null;
            handleSave();
          }, 0);
          return;
        }
        handleSave();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      if (outsideSaveTimeoutRef.current) {
        window.clearTimeout(outsideSaveTimeoutRef.current);
      }
    };
  }, [handleSave, supportsBranching]);

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

  const toggleOptionsEditMode = useCallback(() => {
    if (optionsEditMode === 'individual') {
      setOptionsEditMode('bulk');
      setBulkDraft(fieldOptions.map(option => option.value).join('\n'));
      setBulkFeedback(null);
      return;
    }

    // Stay in bulk mode if a rename/replace decision is now pending, so it stays visible.
    if (tryApplyBulkDraft() !== null) {
      setOptionsEditMode('individual');
    }
  }, [tryApplyBulkDraft, optionsEditMode, fieldOptions]);

  const handleRemoveOption = useCallback((optionId: string) => {
    setFieldOptions(prev => prev.filter(opt => opt.id !== optionId));
  }, []);

  const toggleBranchPanel = useCallback((optionId: string) => {
    setExpandedOptionIds(prev => {
      const next = new Set(prev);
      if (next.has(optionId)) {
        next.delete(optionId);
      } else {
        next.add(optionId);
      }
      return next;
    });
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
              <div className='absolute top-full left-0 mt-1 w-[140px] bg-background border border-input rounded-md shadow-lg z-[100] overflow-hidden max-h-[240px] overflow-y-auto'>
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
                onBlur={() => tryApplyBulkDraft()}
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
              {fieldOptions.map((option, idx) => {
                const branchFields = supportsBranching ? (getBranchFields?.(option.id) ?? []) : [];
                const isExpanded = expandedOptionIds.has(option.id);

                return (
                  <div key={option.id}>
                    <div
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
                        value={option.value}
                        onChange={e => {
                          const newValue = e.target.value;
                          setFieldOptions(prev =>
                            prev.map((opt, i) => (i === idx ? { ...opt, value: newValue } : opt)),
                          );
                        }}
                        className='flex-1 bg-transparent text-[13px] text-foreground focus:outline-none'
                        data-track-category='form'
                        data-track-name='edit-option'
                      />
                      {supportsBranching && (
                        <button
                          type='button'
                          onClick={e => {
                            e.stopPropagation();
                            toggleBranchPanel(option.id);
                          }}
                          className={`text-[11px] font-mono px-2 py-[3px] rounded-full whitespace-nowrap flex-shrink-0 ${
                            branchFields.length > 0
                              ? 'bg-[#6276be]/10 text-[#6276be] hover:bg-[#6276be] hover:text-white'
                              : 'border border-dashed border-border text-muted-foreground hover:border-[#6276be] hover:text-[#6276be] hover:bg-[#6276be]/10'
                          }`}
                          data-track-category='form'
                          data-track-name='toggle-option-branch-panel'
                        >
                          {branchFields.length > 0
                            ? `${branchFields.length} field${branchFields.length === 1 ? '' : 's'}`
                            : '+ Add fields'}
                        </button>
                      )}
                      <Button
                        onClick={() => handleRemoveOption(option.id)}
                        variant='ghost'
                        size='iconSm'
                        className='w-6 h-6 text-muted-foreground hover:text-xyne-red-500 opacity-0 group-hover:opacity-100'
                        data-track-category='form'
                        data-track-name='remove-option'
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>

                    {supportsBranching && isExpanded && (
                      <div className='ml-6 mt-1 mb-1 border border-border rounded-[8px] overflow-visible bg-background'>
                        {branchFields.map(childField =>
                          branchEditor?.kind === 'edit' &&
                          branchEditor.field.id === childField.id ? (
                            <div key={childField.id} className='relative z-10 p-2 bg-background'>
                              <CustomField
                                mode='edit'
                                field={childField}
                                projectId={projectId}
                                onSave={updatedField => {
                                  onSaveBranchField?.(option.id, updatedField, childField.id);
                                  setBranchEditor(null);
                                }}
                                onCancel={() => setBranchEditor(null)}
                              />
                            </div>
                          ) : (
                            <div
                              key={childField.id}
                              role='button'
                              tabIndex={0}
                              onClick={() => setBranchEditor({ kind: 'edit', field: childField })}
                              onKeyDown={() => {}}
                              className='group flex items-center gap-2 px-3 py-2 border-b border-border last:border-b-0 hover:bg-muted cursor-pointer text-[13px]'
                              data-track-category='form'
                              data-track-name='branch-field-row'
                            >
                              <span className='flex-1 text-foreground'>
                                {childField.label}
                                {childField.required && (
                                  <span className='text-[#ff4f4f] ml-1'>*</span>
                                )}
                              </span>
                              <span className='text-[11.5px] text-muted-foreground'>
                                {getFieldTypeLabel(childField.type)}
                              </span>

                              {/* Hover controls - space always reserved via opacity, same as the
                                  top-level field list's Required / Show in Create toggles. */}
                              <div className='flex items-center gap-1.5 opacity-0 group-hover:opacity-100'>
                                <span className='text-[11px] text-muted-foreground whitespace-nowrap'>
                                  Required
                                </span>
                                <button
                                  type='button'
                                  onClick={e => {
                                    e.stopPropagation();
                                    const { id: _id, order: _order, ...rest } = childField;
                                    const newRequired = !childField.required;
                                    onSaveBranchField?.(
                                      option.id,
                                      {
                                        ...rest,
                                        required: newRequired,
                                        visibleInCreate: newRequired
                                          ? true
                                          : childField.visibleInCreate,
                                      },
                                      childField.id,
                                    );
                                  }}
                                  className={`w-6 h-3.5 rounded-full transition-colors relative flex-shrink-0 ${
                                    childField.required ? 'bg-[#6276BE]' : 'bg-gray-600'
                                  }`}
                                  data-track-category='form'
                                  data-track-name='branch-field-required-toggle'
                                >
                                  <span
                                    className={`absolute top-[2px] left-[2px] w-[10px] h-[10px] bg-background rounded-full transition-transform ${
                                      childField.required ? 'translate-x-[8px]' : 'translate-x-0'
                                    }`}
                                  />
                                </button>
                                <span className='text-[11px] text-muted-foreground whitespace-nowrap'>
                                  Show in Create
                                </span>
                                <button
                                  type='button'
                                  onClick={e => {
                                    e.stopPropagation();
                                    const { id: _id, order: _order, ...rest } = childField;
                                    const newVisibleInCreate = !childField.visibleInCreate;
                                    onSaveBranchField?.(
                                      option.id,
                                      {
                                        ...rest,
                                        visibleInCreate: newVisibleInCreate,
                                        required: newVisibleInCreate ? childField.required : false,
                                      },
                                      childField.id,
                                    );
                                  }}
                                  className={`w-6 h-3.5 rounded-full transition-colors relative flex-shrink-0 ${
                                    childField.visibleInCreate ? 'bg-[#6276BE]' : 'bg-gray-600'
                                  }`}
                                  data-track-category='form'
                                  data-track-name='branch-field-show-in-create-toggle'
                                >
                                  <span
                                    className={`absolute top-[2px] left-[2px] w-[10px] h-[10px] bg-background rounded-full transition-transform ${
                                      childField.visibleInCreate
                                        ? 'translate-x-[8px]'
                                        : 'translate-x-0'
                                    }`}
                                  />
                                </button>
                              </div>

                              <Button
                                onClick={e => {
                                  e.stopPropagation();
                                  onDeleteBranchField?.(childField.id);
                                }}
                                variant='ghost'
                                size='iconSm'
                                className='w-6 h-6 text-muted-foreground hover:text-xyne-red-500'
                                data-track-category='form'
                                data-track-name='delete-branch-field'
                              >
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          ),
                        )}

                        {branchEditor?.kind === 'add' && branchEditor.optionId === option.id ? (
                          <div className='relative z-10 p-2 bg-background'>
                            <CustomField
                              mode='create'
                              projectId={projectId}
                              onSave={newField => {
                                onSaveBranchField?.(option.id, newField);
                                setBranchEditor(null);
                              }}
                              onCancel={() => setBranchEditor(null)}
                            />
                          </div>
                        ) : (
                          <button
                            type='button'
                            onClick={() => setBranchEditor({ kind: 'add', optionId: option.id })}
                            className='w-full flex items-center gap-1.5 px-3 py-2 text-[12px] text-[#6276be] hover:bg-[#6276be]/10'
                            data-track-category='form'
                            data-track-name='add-branch-field'
                          >
                            <Plus size={13} />
                            Add field
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
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

      {/* Rename/replace confirmation — only shown when a bulk edit dropped an option that
          has branch fields depending on it, and we can't tell from the text alone whether
          it was renamed or genuinely replaced. */}
      {pendingDecisions && pendingDecisions.length > 0 && (
        <div className='border-t border-border mt-2 pt-4'>
          <p className='text-[13px] font-semibold text-foreground mb-2'>Confirm option changes</p>
          <div className='space-y-2'>
            {pendingDecisions.map((decision, index) => (
              <div
                key={decision.oldOption.id}
                className='border border-amber-300 bg-amber-50 rounded-[8px] p-3'
              >
                <p className='text-[13px] text-foreground mb-2'>
                  <span className='font-medium'>&quot;{decision.oldOption.value}&quot;</span> is no
                  longer in your options, but{' '}
                  {decision.dependentNames.length === 1 ? 'a field depends' : 'fields depend'} on
                  it: <span className='font-medium'>{decision.dependentNames.join(', ')}</span>. Was
                  it renamed, or should those fields be removed?
                </p>
                <div className='flex items-center gap-2 flex-wrap'>
                  {decision.candidateValues.length > 0 && (
                    <>
                      <select
                        value={decision.renameTo ?? ''}
                        onChange={e => setDecisionRenameTarget(index, e.target.value)}
                        className='h-7 text-[12px] border border-input rounded-md px-2 bg-background'
                        data-track-category='form'
                        data-track-name='rename-option-select'
                      >
                        {decision.candidateValues.map(value => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                      <Button
                        onClick={() => resolveDecision(index, 'rename')}
                        variant={decision.resolution === 'rename' ? 'default' : 'secondary'}
                        size='sm'
                        data-track-category='form'
                        data-track-name='confirm-rename-option'
                      >
                        Renamed
                      </Button>
                    </>
                  )}
                  <Button
                    onClick={() => resolveDecision(index, 'replace')}
                    variant={decision.resolution === 'replace' ? 'default' : 'ghost'}
                    size='sm'
                    className={
                      decision.resolution === 'replace'
                        ? ''
                        : 'text-xyne-red-500 hover:text-xyne-red-600'
                    }
                    data-track-category='form'
                    data-track-name='confirm-replace-option'
                  >
                    {decision.candidateValues.length > 0
                      ? 'No, different option'
                      : `Remove ${decision.dependentNames.join(', ')}`}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className='flex justify-end gap-2 mt-3'>
            <Button
              onClick={() => setPendingDecisions(null)}
              variant='ghost'
              size='sm'
              data-track-category='form'
              data-track-name='cancel-option-decisions'
            >
              Cancel
            </Button>
            <Button
              onClick={finalizePendingDecisions}
              disabled={pendingDecisions.some(decision => decision.resolution === null)}
              size='sm'
              data-track-category='form'
              data-track-name='apply-option-decisions'
            >
              Apply
            </Button>
          </div>
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
