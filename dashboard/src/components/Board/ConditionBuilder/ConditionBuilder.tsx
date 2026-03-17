import { ReactElement, useState, useEffect, useCallback, useMemo } from 'react';
import { X, ChevronDown, Plus } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { type User } from '@xyne/shared';
import { ApproverSelector } from '../ApproverSelector/ApproverSelector';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { useUsers } from '../../../hooks/useUsers';
import { Button } from '../../ui/Button';
import type { StageCondition } from '../BoardStageConfigScreen/BoardStageConfigScreen.types';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../../ui/dropdown-menu';
import {
  type WhenFieldType,
  type ThenFieldType,
  WHEN_FIELD_OPTIONS,
  WHEN_CONDITION_OPTIONS,
  THEN_FIELD_OPTIONS,
  THEN_CONDITION_OPTIONS,
  PR_STATUS_OPTIONS,
} from '../../../utils/board';
import {
  type SelectDropdownProps,
  type ConditionBuilderProps,
  type FormDropdownProps,
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
  const selectedLabel =
    options.find(opt => opt.value === value)?.label || placeholder || 'Select...';

  // Determine text color and font based on variant - only apply variant colors when a value is selected
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type='button'
          className='w-[160px] h-auto min-h-[32px] px-[8px] py-[7px] bg-background border border-border rounded-[8px] text-[13px] text-left focus:outline-none focus:ring-0 cursor-pointer disabled:text-muted-foreground/50 disabled:cursor-not-allowed flex items-start justify-between'
        >
          <span className={`${textColorClass} ${fontClass} break-words`}>{selectedLabel}</span>
          <ChevronDown size={14} className='text-muted-foreground shrink-0 ml-1 mt-[2px]' />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className='w-[160px] max-h-[200px] overflow-y-auto'>
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

// ─── Form Dropdown Component ────────────────────────────────────────────────
const FormDropdown = ({
  value,
  onChange,
  disabled,
  onCreateFormClick,
  showStageNameInsteadOfForm,
  allStages,
  allForms,
}: FormDropdownProps): ReactElement => {
  // Get display text
  let displayText = 'Choose form';
  if (value) {
    if (showStageNameInsteadOfForm && allStages) {
      // Find the stage that has this form
      const targetStage = allStages.find(s => s.formId === value);
      displayText = targetStage?.name || value;
    } else {
      // Show form name
      const selectedForm = allForms?.find(f => f.id === value);
      displayText = selectedForm?.formName || value;
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type='button'
          className='w-[160px] h-auto min-h-[32px] px-[8px] py-[7px] bg-background border border-border rounded-[8px] text-[13px] text-left focus:outline-none focus:ring-0 cursor-pointer disabled:text-muted-foreground/50 disabled:cursor-not-allowed flex items-start justify-between'
        >
          <span
            className={`${value ? 'text-foreground' : 'text-muted-foreground/50'} break-words whitespace-normal leading-tight`}
          >
            {displayText}
          </span>
          <ChevronDown size={14} className='text-muted-foreground shrink-0 ml-1' />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className='w-[160px] max-h-[200px] overflow-y-auto'>
        {/* Create Form Option */}
        <DropdownMenuItem
          onClick={() => onCreateFormClick?.()}
          className='text-[#6276be] font-medium cursor-pointer flex items-center gap-2'
        >
          <Plus size={14} />
          Create form
        </DropdownMenuItem>

        {/* Divider */}
        {allForms && allForms.length > 0 && <DropdownMenuSeparator />}

        {/* Form Options - show stage names if in approver mode */}
        {allForms?.map(form => {
          let itemLabel = form.formName;
          if (showStageNameInsteadOfForm && allStages) {
            const targetStage = allStages.find(s => s.formId === form.id);
            itemLabel = targetStage?.name || form.formName;
          }

          return (
            <DropdownMenuItem
              key={form.id}
              onClick={() => onChange(form.id)}
              className={
                value === form.id ? 'text-[#6276be] font-medium bg-muted' : 'text-foreground'
              }
            >
              {itemLabel}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
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
  const [selectedApprovers, setSelectedApprovers] = useState<User[]>([]);

  // Fetch forms for name lookup
  const [allForms] = useCachedQuery(queries.getAllForms());
  const formMap = useMemo(() => new Map(allForms?.map(f => [f.id, f.formName]) || []), [allForms]);

  // Fetch users for approver lookup
  const allUsers = useUsers();

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

  // Reset form when modal opens/closes or condition changes
  useEffect(() => {
    if (isOpen && condition) {
      setWhenField((condition.whenField as WhenFieldType) || '');
      setWhenCondition(condition.whenCondition || '');
      setWhenValue(condition.whenValue || '');
      setThenField((condition.thenField as ThenFieldType) || '');
      setThenCondition(condition.thenCondition || '');
      setThenValue(condition.thenValue || '');

      // Load approvers if they exist
      if (condition.approverIds && condition.approverIds.length > 0 && allUsers) {
        const approvers = allUsers.filter(user => condition.approverIds?.includes(user.id));
        setSelectedApprovers(approvers);
      } else {
        setSelectedApprovers([]);
      }
    } else if (isOpen) {
      // New condition - set defaults
      setWhenField('');
      setWhenCondition('');
      setWhenValue('');
      setThenField('');
      setThenCondition('');
      setThenValue('');
      setSelectedApprovers([]);
    }
  }, [isOpen, condition, allUsers]);

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
      ...(thenField === 'approver' && { approverIds: selectedApprovers.map(u => u.id) }),
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
                <FormDropdown
                  value={thenValue}
                  onChange={setThenValue}
                  disabled={!thenCondition}
                  onCreateFormClick={onOpenCreateForm}
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

export default ConditionBuilder;
