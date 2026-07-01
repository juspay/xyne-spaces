import { ReactElement, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import type { SelectorOption } from '../../ui/EntitySelector/EntitySelector.types';

export interface TransitionFormPickerProps {
  allForms?: Array<{ id: string; formName: string }>;
  onCreateForm: () => void;
  onSelectForm: (formId: string) => void;
  value?: string;
  disabled?: boolean;
  triggerLabel?: string;
  variant?: 'dropdown' | 'dashed-button';
  showStageNameInsteadOfForm?: boolean;
  allStages?: Array<{ name: string; sequenceNumber: number; formId?: string }>;
  className?: string;
}

export const TransitionFormPicker = ({
  allForms,
  onCreateForm,
  onSelectForm,
  value,
  disabled = false,
  triggerLabel = 'Attach form',
  variant = 'dropdown',
  showStageNameInsteadOfForm = false,
  allStages,
  className,
}: TransitionFormPickerProps): ReactElement => {
  const entityOptions = useMemo<SelectorOption[]>(() => {
    return (allForms ?? []).map(form => {
      let label = form.formName;
      if (showStageNameInsteadOfForm && allStages) {
        const targetStage = allStages.find(s => s.formId === form.id);
        label = targetStage?.name || form.formName;
      }
      return { value: form.id, label, icon: null };
    });
  }, [allForms, allStages, showStageNameInsteadOfForm]);

  const placeholder = variant === 'dashed-button' ? triggerLabel : 'Choose form';

  const triggerInputClassName =
    variant === 'dashed-button'
      ? `w-full min-h-[36px] px-3 py-2 rounded-lg border border-dashed border-border text-[12px] hover:border-[#6276be] hover:text-[#6276be] transition-colors ${className ?? ''}`
      : `w-full min-h-[32px] h-auto px-[8px] py-[7px] rounded-[8px] text-[13px] ${value ? 'text-foreground' : 'text-muted-foreground/50'} ${className ?? ''}`;

  return (
    <div className={disabled ? 'pointer-events-none opacity-50' : undefined}>
      <EntitySelector
        options={entityOptions}
        selectedValue={value ?? null}
        onSelect={selected => {
          if (selected) onSelectForm(selected);
        }}
        placeholder={placeholder}
        searchPlaceholder='Search forms...'
        showSearch
        width='100%'
        inputClassName={triggerInputClassName}
        testId='transition_form_picker'
        headerAction={{
          label: 'Create form',
          icon: <Plus size={14} />,
          onClick: onCreateForm,
          trackCategory: 'board_stage_config',
          trackName: 'create_transition_form',
        }}
      />
    </div>
  );
};
