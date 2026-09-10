import { ReactElement, useState, useEffect, useCallback, useMemo } from 'react';
import { X, ChevronDown } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { FormContextType } from '@xyne/shared';
import { ApproverSelector } from '../ApproverSelector/ApproverSelector';
import type { ApproverEntry } from '../ApproverSelector/ApproverSelector.types';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { Button } from '../../ui/Button';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';
import type { StageCondition } from '../BoardStageConfigScreen/BoardStageConfigScreen.types';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from '../../ui/dropdown-menu';
import {
  type WhenFieldType,
  type ThenFieldType,
  WHEN_FIELD_OPTIONS,
  WHEN_CONDITION_OPTIONS,
  THEN_FIELD_OPTIONS,
  THEN_CONDITION_OPTIONS,
  PR_STATUS_OPTIONS,
} from '../../../utils/board';
import { TransitionFormPicker } from '../TransitionFormPicker/TransitionFormPicker';
import {
  type SelectDropdownProps,
  type ConditionBuilderProps,
  type ApproverDropdownProps,
} from './ConditionBuilder.types';

const SelectDropdown = ({
  value,
  onChange,
  options,
  disabled,
  placeholder,
  variant,
}: SelectDropdownProps): ReactElement => {
  const entityOptions = useMemo<SelectorOption[]>(
    () =>
      options
        .filter(opt => opt.value !== '')
        .map(opt => ({
          value: opt.value,
          label: opt.label,
          icon: null,
        })),
    [options],
  );

  const hasValue = !!value;
  const textColorClass =
    hasValue && variant === 'when'
      ? 'text-[#2b7fff]'
      : hasValue && variant === 'then'
        ? 'text-[#e87619]'
        : hasValue
          ? 'text-foreground'
          : 'text-muted-foreground/50';
  const fontClass = hasValue && variant ? 'font-mono' : '';

  return (
    <div className={disabled ? 'pointer-events-none opacity-50' : undefined}>
      <EntitySelector
        options={entityOptions}
        selectedValue={value || null}
        onSelect={selected => onChange(selected ?? '')}
        placeholder={placeholder || 'Select...'}
        searchPlaceholder='Search...'
        showSearch
        width='100%'
        inputClassName={`w-full min-h-[32px] h-auto px-[8px] py-[7px] rounded-[8px] text-[13px] ${textColorClass} ${fontClass}`}
        testId='condition_select'
      />
    </div>
  );
};

// ─── Approver Dropdown Component ────────────────────────────────────────────
const ApproverDropdown = ({
  selectedApprovers,
  onApproversChange,
  disabled,
}: ApproverDropdownProps): ReactElement => {
  const displayText =
    selectedApprovers.length > 0
      ? `${selectedApprovers.length} Approver${selectedApprovers.length > 1 ? 's' : ''}`
      : 'Select approvers';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type='button'
          className='w-[160px] h-auto min-h-[32px] px-[8px] py-[7px] bg-background border border-border rounded-[8px] text-[13px] text-left focus:outline-none focus:ring-0 cursor-pointer disabled:text-muted-foreground/50 disabled:cursor-not-allowed flex items-start justify-between'
        >
          <span
            className={
              selectedApprovers.length > 0 ? 'text-foreground' : 'text-muted-foreground/50'
            }
          >
            {displayText}
          </span>
          <ChevronDown size={14} className='text-muted-foreground shrink-0 ml-1' />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className='w-[320px] p-0' align='start'>
        <div className='p-4'>
          <ApproverSelector
            selectedApprovers={selectedApprovers}
            onApproversChange={onApproversChange}
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

// ─── Component ─────────────────────────────────────────────────────────────
export const ConditionBuilder = ({
  isOpen,
  onClose,
  onSave,
  onDelete,
  condition,
  onOpenCreateForm,
  nextStageName,
  allStages = [],
}: ConditionBuilderProps): ReactElement | null => {
  // Form state
  const [whenField, setWhenField] = useState<WhenFieldType | ''>('');
  const [whenCondition, setWhenCondition] = useState('');
  const [whenValue, setWhenValue] = useState('');
  const [thenField, setThenField] = useState<ThenFieldType | ''>('');
  const [thenCondition, setThenCondition] = useState('');
  const [thenValue, setThenValue] = useState('');
  const [selectedApprovers, setSelectedApprovers] = useState<ApproverEntry[]>([]);
  const [requestApprovalOnEntry, setRequestApprovalOnEntry] = useState(false);

  // Fetch forms for name lookup - only STAGE context forms
  const [allForms] = useCachedQuery(
    queries.getFormsByContextType({ contextType: FormContextType.STAGE }),
  );
  const formMap = useMemo(() => new Map(allForms?.map(f => [f.id, f.formName]) || []), [allForms]);

  // Generate condition name based on selected values
  const generateConditionName = useCallback((): string => {
    // For Approver conditions: "Approvers on ${NextStageName}"
    if (thenField === 'approver' && whenField === 'form' && whenValue) {
      // whenValue now contains the stage name directly
      const targetStage = allStages.find(s => s.name === whenValue);
      const stageName = targetStage?.name || whenValue;

      return `Approvers on ${stageName}`;
    }
    // For PR Status conditions: "PR Status - ${prStatus}"
    if (whenField === 'pr_status' && whenValue) {
      return `PR Status - ${whenValue}`;
    }
    // For Form conditions: "${formName}"
    if (thenField === 'form' && thenValue) {
      return `Form - ${formMap.get(thenValue) || 'Form'}`;
    }
    // For Status conditions
    if (whenField === 'status' && whenValue) {
      return `Status ${whenCondition} ${whenValue}`;
    }
    return 'Condition';
  }, [whenField, whenValue, whenCondition, thenField, thenValue, formMap, allStages]);

  // Reset form on open / condition change. allUsers is deliberately excluded —
  // it re-emits on any users-table sync and would wipe in-progress edits.
  useEffect(() => {
    if (isOpen && condition) {
      setWhenField((condition.whenField as WhenFieldType) || '');
      setWhenCondition(condition.whenCondition || '');
      setWhenValue(condition.whenValue || '');
      setThenField((condition.thenField as ThenFieldType) || '');
      setThenCondition(condition.thenCondition || '');
      setThenValue(condition.thenValue || '');
      setSelectedApprovers([]);
      setRequestApprovalOnEntry(condition.requestApprovalOnEntry ?? false);
    } else if (isOpen) {
      // New condition - set defaults
      setWhenField('');
      setWhenCondition('');
      setWhenValue('');
      setThenField('');
      setThenCondition('');
      setThenValue('');
      setSelectedApprovers([]);
      setRequestApprovalOnEntry(false);
    }
  }, [isOpen, condition]);

  // Reset dependent fields when whenField changes
  const handleWhenFieldChange = (value: WhenFieldType | ''): void => {
    setWhenField(value);
    setWhenCondition('');
    setWhenValue('');
    setThenField('');
    setThenCondition('');
    setThenValue('');
  };

  // Reset dependent fields when thenField changes
  const handleThenFieldChange = (value: ThenFieldType | ''): void => {
    setThenField(value);
    setThenCondition('');
    setThenValue('');
  };

  // Get filtered when condition options based on selected when field
  const getWhenConditionOptions = (): { value: string; label: string }[] => {
    if (!whenField) return [{ value: '', label: 'Choose condition' }];

    const filtered = WHEN_CONDITION_OPTIONS.filter(
      opt => opt.whenField === whenField || opt.value === '',
    );
    return filtered;
  };

  // Get filtered then field options based on selected when field
  const getThenFieldOptions = (): { value: string; label: string }[] => {
    if (!whenField) return [{ value: '', label: 'Choose field' }];

    const filtered = THEN_FIELD_OPTIONS.filter(
      opt => opt.whenField === whenField || opt.value === '',
    );
    return filtered;
  };

  // Get filtered then condition options based on selected then field
  const getThenConditionOptions = (): { value: string; label: string }[] => {
    if (!thenField) return [{ value: '', label: 'Choose condition' }];

    const filtered = THEN_CONDITION_OPTIONS.filter(
      opt => opt.thenField === thenField || opt.value === '',
    );
    return filtered;
  };

  // Get value options based on field type
  const getWhenValueOptions = (): { value: string; label: string }[] => {
    if (whenField === 'status') {
      // Use next stage name for form mapping case - show as dropdown with single option
      if (!nextStageName) {
        return [{ value: '', label: 'Choose value' }];
      }
      // Include empty option so dropdown is interactive, but only show next stage
      return [
        { value: '', label: 'Choose value' },
        { value: nextStageName, label: nextStageName },
      ];
    }
    if (whenField === 'pr_status') {
      return PR_STATUS_OPTIONS;
    }
    if (whenField === 'form') {
      // Use next stage name - show as dropdown with single option
      if (!nextStageName) {
        return [{ value: '', label: 'Choose stage' }];
      }
      // Include empty option so dropdown is interactive, but only show next stage
      return [
        { value: '', label: 'Choose stage' },
        { value: nextStageName, label: nextStageName },
      ];
    }
    return [{ value: '', label: 'Choose value' }];
  };

  // Get then value options based on then field type
  const getThenValueOptions = (): { value: string; label: string }[] => {
    if (thenField === 'status') {
      // Use stage names for PR Status → Stage mapping
      return [
        { value: '', label: 'Choose stage' },
        ...allStages.map(stage => ({
          value: stage.name,
          label: stage.name,
        })),
      ];
    }
    if (thenField === 'form') {
      return [
        { value: '', label: 'Choose form' },
        ...(allForms?.map(form => ({
          value: form.id,
          label: form.formName,
        })) ?? []),
      ];
    }
    return [{ value: '', label: 'Choose value' }];
  };

  // Handle save
  const handleSave = useCallback(() => {
    // Convert stage name to formId when saving form-based condition
    let finalWhenValue = whenValue;
    if (whenField === 'form') {
      const targetStage = allStages.find(s => s.name === whenValue);
      finalWhenValue = targetStage?.formId || whenValue;
    }

    const newCondition: StageCondition = {
      id: condition?.id || uuidv4(),
      name: generateConditionName(),
      whenField,
      whenCondition,
      whenValue: finalWhenValue,
      thenField,
      thenCondition,
      thenValue,
      ...(thenField === 'approver' && {
        approvers: selectedApprovers,
        // Only meaningful with approvers configured, and never for a
        // form-chained approver condition (the form must be filled manually).
        requestApprovalOnEntry:
          whenField !== 'form' && selectedApprovers.length > 0 && requestApprovalOnEntry,
      }),
    };
    onSave(newCondition);
    onClose();
  }, [
    condition,
    generateConditionName,
    whenField,
    whenCondition,
    whenValue,
    thenField,
    thenCondition,
    thenValue,
    selectedApprovers,
    requestApprovalOnEntry,
    onSave,
    onClose,
    allStages,
  ]);

  // Handle delete
  const handleDelete = useCallback(() => {
    if (condition?.id && onDelete) {
      onDelete(condition.id);
      onClose();
    }
  }, [condition, onDelete, onClose]);

  if (!isOpen) return null;

  const whenConditionOptions = getWhenConditionOptions();
  const thenFieldOptions = getThenFieldOptions();
  const thenConditionOptions = getThenConditionOptions();
  const whenValueOptions = getWhenValueOptions();
  const thenValueOptions = getThenValueOptions();

  return (
    <div className='bg-background rounded-[12px] border border-border shadow-[0px_184px_51px_0px_rgba(0,0,0,0),0px_117px_47px_0px_rgba(0,0,0,0.01),0px_66px_40px_0px_rgba(0,0,0,0.02),0px_29px_29px_0px_rgba(0,0,0,0.03),0px_7px_16px_0px_rgba(0,0,0,0.04)] w-[550px] -ml-[45px] mt-[300px]'>
      {/* Modal Header */}
      <div className='flex items-center gap-[6px] px-[12px] py-[12px] border-b border-border'>
        <span className='flex-1 text-[14px] font-medium text-foreground'>
          {condition ? 'Edit Condition' : 'Add Condition'}
        </span>
        <Button
          onClick={onClose}
          variant='ghost'
          size='iconSm'
          className='text-muted-foreground hover:text-foreground'
          data-track-category='board_config'
          data-track-name='close_condition_builder'
        >
          <X size={13} />
        </Button>
      </div>

      {/* Modal Body */}
      <div className='px-[12px] py-[16px] flex flex-col gap-[16px]'>
        {/* WHEN Section */}
        <div className='flex flex-col gap-[6px]'>
          <div className='flex items-center gap-[3px] px-[4px] py-[2px] rounded-[4px] w-fit'>
            <span className='text-[12px] font-semibold text-muted-foreground uppercase tracking-[0.72px]'>
              when
            </span>
            <ChevronDown size={12} className='text-muted-foreground' />
          </div>
          <div className='flex gap-[6px] pl-[16px]'>
            {/* When Field Dropdown */}
            <div className='flex-1'>
              <SelectDropdown
                value={whenField}
                onChange={value => handleWhenFieldChange(value as WhenFieldType | '')}
                options={WHEN_FIELD_OPTIONS}
                placeholder='Choose field'
              />
            </div>

            {/* When Condition Dropdown */}
            <div className='flex-1'>
              <SelectDropdown
                value={whenCondition}
                onChange={setWhenCondition}
                options={whenConditionOptions}
                disabled={!whenField}
                placeholder='Choose condition'
                variant='when'
              />
            </div>

            {/* When Value - Always use SelectDropdown, show stage names for form */}
            <div className='flex-1'>
              <SelectDropdown
                value={whenValue}
                onChange={setWhenValue}
                options={whenValueOptions}
                disabled={!whenCondition}
                placeholder='Choose value'
              />
            </div>
          </div>
        </div>

        {/* THEN Section */}
        <div className='flex flex-col gap-[6px]'>
          <div className='flex items-center gap-[3px] px-[4px] py-[2px] rounded-[4px] w-fit'>
            <span className='text-[12px] font-semibold text-muted-foreground uppercase tracking-[0.72px]'>
              Then
            </span>
            <ChevronDown size={12} className='text-muted-foreground' />
          </div>
          <div className='flex gap-[6px] pl-[16px]'>
            {/* Then Field Dropdown */}
            <div className='flex-1'>
              <SelectDropdown
                value={thenField}
                onChange={value => handleThenFieldChange(value as ThenFieldType | '')}
                options={thenFieldOptions}
                disabled={!whenValue}
                placeholder='Choose field'
              />
            </div>

            {/* Then Condition Dropdown */}
            <div className='flex-1'>
              <SelectDropdown
                value={thenCondition}
                onChange={setThenCondition}
                options={thenConditionOptions}
                disabled={!thenField}
                placeholder='Choose condition'
                variant='then'
              />
            </div>

            {/* Then Value - Different components based on field type */}
            {thenField === 'form' ? (
              <div className='flex-1'>
                <TransitionFormPicker
                  value={thenValue}
                  onSelectForm={setThenValue}
                  disabled={!thenCondition}
                  onCreateForm={() => onOpenCreateForm?.()}
                  allForms={allForms}
                />
              </div>
            ) : thenField === 'approver' ? (
              <div className='flex-1'>
                <ApproverDropdown
                  selectedApprovers={selectedApprovers}
                  onApproversChange={setSelectedApprovers}
                  disabled={!thenCondition}
                />
              </div>
            ) : (
              <div className='flex-1'>
                <SelectDropdown
                  value={thenValue}
                  onChange={setThenValue}
                  options={thenValueOptions}
                  disabled={!thenCondition}
                  placeholder='Choose value'
                />
              </div>
            )}
          </div>

          {/* Request approval on stage entry — approver conditions only. Hidden
              for form-chained approver conditions (whenField === 'form'), since
              those are definitionally gated behind a form that must be filled
              manually. */}
          {thenField === 'approver' &&
            whenField !== 'form' &&
            (() => {
              const targetStage = allStages.find(s => s.name === whenValue);
              const formAttached = !!targetStage?.formId;
              const entryOn =
                !formAttached && selectedApprovers.length > 0 && requestApprovalOnEntry;
              const disabled = formAttached || selectedApprovers.length === 0;
              return (
                <div className='flex items-start gap-2.5 select-none pl-[16px] mt-1'>
                  <button
                    type='button'
                    role='switch'
                    aria-checked={entryOn}
                    disabled={disabled}
                    onClick={() => setRequestApprovalOnEntry(prev => !prev)}
                    data-track-category='board_config'
                    data-track-name='toggle_request_approval_on_entry'
                    title={
                      formAttached
                        ? 'Not available when a form is attached — the form must be filled manually.'
                        : selectedApprovers.length === 0
                          ? 'Select at least one approver first.'
                          : undefined
                    }
                    className={`relative w-8 h-4 rounded-full transition-colors border-none p-0 shrink-0 mt-0.5 ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'} ${entryOn ? 'bg-[#6276be]' : 'bg-muted-foreground/30'}`}
                  >
                    <div
                      className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${entryOn ? 'translate-x-4' : 'translate-x-0.5'}`}
                    />
                  </button>
                  <div>
                    <span
                      className={`text-[12px] ${disabled ? 'text-muted-foreground' : 'text-foreground'}`}
                    >
                      Request approval on stage entry
                    </span>
                    <p className='text-[10px] text-muted-foreground mt-0.5 leading-snug'>
                      {formAttached
                        ? 'Unavailable while a form is attached — the form must be filled manually.'
                        : 'Notify the approver as soon as a ticket enters the previous stage.'}
                    </p>
                  </div>
                </div>
              );
            })()}
        </div>
      </div>

      {/* Modal Footer */}
      <div className='flex items-center justify-between px-[12px] py-[12px] border-t border-border'>
        <div>
          {condition?.id && onDelete && (
            <button
              onClick={handleDelete}
              className='px-3 py-1.5 text-[13px] font-medium text-red-500 hover:text-red-600 transition-colors'
              data-track-category='board_config'
              data-track-name='delete_condition'
            >
              Delete
            </button>
          )}
        </div>
        <div className='flex items-center gap-2'>
          <button
            onClick={onClose}
            className='px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors'
            data-track-category='board_config'
            data-track-name='cancel_condition'
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={
              !whenField ||
              !whenCondition ||
              !whenValue ||
              !thenField ||
              !thenCondition ||
              (thenField === 'approver' ? selectedApprovers.length === 0 : !thenValue)
            }
            className='px-3 py-1.5 text-[13px] font-medium text-white bg-[#6276be] hover:bg-[#5060a0] disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed rounded-[6px] transition-colors'
            data-track-category='board_config'
            data-track-name='save_condition'
          >
            Save Condition
          </button>
        </div>
      </div>
    </div>
  );
};
