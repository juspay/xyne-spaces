import type { ReactElement } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { FormFieldType } from '@xyne/shared';
import { Button } from '../../ui/Button/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import {
  GlobalFieldNameAutocomplete,
  type GlobalFieldSuggestion,
} from '../../Board/GlobalFieldNameAutocomplete';
import { FIELD_TYPE_OPTIONS } from '../../../utils/board';
import { getFieldTypeLabel } from '../../../utils/board/formFieldApiMapper';
import { isSelectFieldType, type FieldIssue } from '../../../utils/form/formBuilderValidation';
import { cn } from '../../../utils/classNames';
import type { BuilderField, BuilderFieldOption } from './FormBuilder.types';
import { FormFieldOptionsEditor } from './FormFieldOptionsEditor';

const getTypeLabel = (fieldType: FormFieldType): string =>
  FIELD_TYPE_OPTIONS.find(option => option.value === fieldType)?.label ??
  getFieldTypeLabel(fieldType);

/** Everything a field card needs from the builder, shared by top-level and branch cards. */
export interface FormFieldEditorContext {
  projectId: string | undefined;
  readOnly: boolean;
  disabled: boolean;
  trackingCategory: string;
  expandedRowId: string | null;
  expandedBranchRowId: string | null;
  getIssues: (rowId: string) => readonly FieldIssue[];
  getBranchFields: (optionId: string) => BuilderField[];
  isOptionPanelOpen: (optionId: string) => boolean;
  registerInputRef: (rowId: string, el: HTMLInputElement | null) => void;
  onExpand: (field: BuilderField) => void;
  onCollapse: (field: BuilderField) => void;
  onRename: (rowId: string, fieldName: string) => void;
  onToggleRequired: (rowId: string) => void;
  onChangeType: (rowId: string, fieldType: FormFieldType) => void;
  onChangeOptions: (rowId: string, options: BuilderFieldOption[]) => void;
  onDelete: (rowId: string) => void;
  onSelectExistingGlobalField: (rowId: string, suggestion: GlobalFieldSuggestion) => void;
  onCreateAsNewField: (rowId: string) => void;
  onToggleOptionPanel: (optionId: string) => void;
  onAddBranchField: (optionId: string) => void;
}

interface FormFieldEditorProps {
  field: BuilderField;
  /** Rendered inside an option's branch panel (as opposed to the top-level list). */
  nested: boolean;
  ctx: FormFieldEditorContext;
}

const NAME_CODES = new Set(['name-required', 'duplicate-name']);
const BRANCH_CODES = new Set(['branch-unresolved', 'branch-not-single-select', 'branch-nested']);

const FieldTypeDropdown = ({
  value,
  disabled,
  trackingCategory,
  onChange,
}: {
  value: FormFieldType;
  disabled: boolean;
  trackingCategory: string;
  onChange: (value: FormFieldType) => void;
}): ReactElement => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild disabled={disabled}>
      <button
        type='button'
        className='w-full h-[32px] px-[8px] py-[7px] bg-background border border-border rounded-[8px] text-[13px] text-left focus:outline-none focus:ring-0 cursor-pointer disabled:text-muted-foreground/50 disabled:cursor-not-allowed flex items-center justify-between'
      >
        <span className='text-foreground'>{getTypeLabel(value)}</span>
        <ChevronDown size={14} className='text-muted-foreground shrink-0 ml-1' />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent className='w-full max-h-[280px] overflow-y-auto'>
      {FIELD_TYPE_OPTIONS.map(option => (
        <DropdownMenuItem
          key={option.value}
          onClick={() => onChange(option.value)}
          data-track-category={trackingCategory}
          data-track-name='SELECT_FORM_OPTION'
          className={value === option.value ? 'bg-muted font-medium' : ''}
        >
          {option.label}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

/**
 * One field card. A SINGLE_SELECT top-level field also hosts a panel per option holding the
 * fields that only apply when that option is chosen; those child cards cannot branch again
 * (`supportsBranching` requires a top-level card), which caps nesting at one level.
 */
export const FormFieldEditor = ({ field, nested, ctx }: FormFieldEditorProps): ReactElement => {
  const isExpanded =
    !ctx.readOnly && (nested ? ctx.expandedBranchRowId : ctx.expandedRowId) === field.rowId;
  const showOptions = isSelectFieldType(field.fieldType);
  const options = field.fieldEnum ?? [];
  const supportsBranching =
    field.fieldType === FormFieldType.SINGLE_SELECT && !nested && !field.parentOptionId;
  const track = ctx.trackingCategory;

  const issues = ctx.getIssues(field.rowId);
  const nameError = issues.find(issue => NAME_CODES.has(issue.code))?.message;
  const typeError = issues.find(issue => issue.code === 'unsupported-type')?.message;
  const optionsError = issues.find(issue => issue.code === 'select-missing-option')?.message;
  const branchError = issues.find(issue => BRANCH_CODES.has(issue.code))?.message;
  const optionErrors = new Map(
    issues.flatMap(issue => (issue.optionId ? [[issue.optionId, issue.message] as const] : [])),
  );
  const hasError = issues.length > 0;

  const selectedGlobalField: GlobalFieldSuggestion | undefined = field.definitionId
    ? {
        id: field.definitionId,
        fieldName: field.fieldName,
        fieldType: field.fieldType,
        ...(field.fieldEnum ? { fieldEnum: field.fieldEnum } : {}),
      }
    : undefined;

  const renderBranchPanel = (option: BuilderFieldOption): ReactElement | null => {
    const branchFields = ctx.getBranchFields(option.id);
    if (ctx.readOnly ? branchFields.length === 0 : !ctx.isOptionPanelOpen(option.id)) return null;
    return (
      <div className='ml-6 mt-1 mb-1 flex flex-col gap-[6px] border border-border rounded-[8px] p-[6px] bg-muted/30'>
        <p className='px-[6px] text-[11px] text-muted-foreground'>
          Shown when &quot;{option.value || 'this option'}&quot; is selected
        </p>
        {branchFields.map(child => (
          <FormFieldEditor key={child.rowId} field={child} nested ctx={ctx} />
        ))}
        {!ctx.readOnly && (
          <button
            type='button'
            onClick={() => ctx.onAddBranchField(option.id)}
            disabled={ctx.disabled}
            className='w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[12px] text-[#6276be] hover:bg-[#6276be]/10 rounded-[6px] disabled:cursor-not-allowed disabled:opacity-50'
            data-track-category={track}
            data-track-name='add_branch_field'
          >
            <Plus size={13} />
            Add field
          </button>
        )}
      </div>
    );
  };

  if (ctx.readOnly) {
    return (
      <div className='rounded-[12px] border border-border bg-background px-[12px] py-[10px] flex flex-col gap-[8px]'>
        <div className='flex items-baseline justify-between gap-3'>
          <span className='text-[14px] font-medium text-foreground'>
            {field.fieldName || <span className='italic text-muted-foreground/60'>Untitled</span>}
            {field.fieldName && !field.isOptional && <span className='text-[#ff4f4f] ml-1'>*</span>}
          </span>
          <span className='shrink-0 text-[12px] text-muted-foreground'>
            {getTypeLabel(field.fieldType)}
            {field.isOptional ? ' · Optional' : ''}
          </span>
        </div>
        {showOptions &&
          (options.length > 0 ? (
            <div className='flex flex-col gap-[6px]'>
              {options.map(option => (
                <div key={option.id}>
                  <div className='flex h-[32px] items-center rounded-[8px] border border-border bg-muted/20 px-[8px] text-[13px] text-foreground'>
                    {option.value || '(empty)'}
                  </div>
                  {supportsBranching && renderBranchPanel(option)}
                </div>
              ))}
            </div>
          ) : (
            <p className='text-[12px] text-muted-foreground italic'>No options</p>
          ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative rounded-[12px] bg-background transition-shadow border',
        isExpanded ? 'z-20 shadow-md overflow-visible' : 'overflow-hidden',
        hasError ? 'border-destructive/60' : isExpanded ? 'border-border' : 'border-transparent',
      )}
    >
      <div className='flex items-start justify-between px-[12px] py-[10px] gap-3'>
        {isExpanded ? (
          <div className='flex-1' />
        ) : (
          <button
            type='button'
            className='flex flex-col gap-2 flex-1 text-left bg-transparent border-0 p-0 cursor-pointer disabled:cursor-not-allowed'
            onClick={() => ctx.onExpand(field)}
            disabled={ctx.disabled}
            data-track-category={track}
            data-track-name='expand_field_header'
          >
            <span
              className={cn(
                'text-[14px] font-medium',
                field.fieldName ? 'text-foreground' : 'italic text-muted-foreground/60',
              )}
            >
              {field.fieldName || 'Untitled question'}
              {field.fieldName && !field.isOptional && (
                <span className='text-[#ff4f4f] ml-1'>*</span>
              )}
            </span>
            <span className='w-full h-[36px] px-[12px] bg-background border border-border rounded-[12px] text-[13px] flex items-center justify-between'>
              <span className='text-foreground'>{getTypeLabel(field.fieldType)}</span>
              <ChevronDown size={14} className='text-muted-foreground' />
            </span>
            {showOptions && options.length > 0 && (
              <span className='text-[12px] text-muted-foreground'>
                {options.length} option{options.length > 1 ? 's' : ''}
              </span>
            )}
            {hasError && <span className='text-[12px] text-destructive'>{issues[0]?.message}</span>}
          </button>
        )}
        {isExpanded && (
          <div className='flex items-center gap-[12px]'>
            <div className='flex items-center gap-[10px]'>
              <span className='text-[14px] text-foreground'>Required</span>
              <button
                type='button'
                role='switch'
                aria-checked={!field.isOptional}
                aria-label='Required'
                onClick={() => ctx.onToggleRequired(field.rowId)}
                disabled={ctx.disabled}
                className={cn(
                  'w-[36px] h-[20px] rounded-full relative transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  !field.isOptional ? 'bg-[#6276be]' : 'bg-muted',
                )}
                data-track-category={track}
                data-track-name='toggle_required'
              >
                <span
                  className={cn(
                    'absolute top-[2px] w-[16px] h-[16px] bg-background rounded-full transition-transform',
                    !field.isOptional ? 'left-[18px]' : 'left-[2px]',
                  )}
                />
              </button>
            </div>
            <Button
              onClick={() => ctx.onDelete(field.rowId)}
              disabled={ctx.disabled}
              variant='ghost'
              size='iconSm'
              aria-label='Delete field'
              className='text-muted-foreground hover:text-red-500'
              data-track-category={track}
              data-track-name='delete_field'
            >
              <Trash2 size={18} />
            </Button>
            <Button
              onClick={() => ctx.onCollapse(field)}
              variant='ghost'
              size='iconSm'
              aria-label='Collapse field'
              className='flex items-center justify-center'
              data-track-category={track}
              data-track-name='toggle_field_expand'
            >
              <ChevronDown size={16} className='text-muted-foreground rotate-180' />
            </Button>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className='px-[12px] pb-[12px] pt-[4px] flex flex-col gap-[2px]'>
          <div className='pb-3'>
            <GlobalFieldNameAutocomplete
              value={field.fieldName}
              onChange={value => ctx.onRename(field.rowId, value)}
              projectId={ctx.projectId}
              inputRef={el => ctx.registerInputRef(field.rowId, el)}
              placeholder='Enter question'
              disabled={ctx.disabled}
              className='w-full text-[14px] text-foreground bg-transparent border-0 focus:outline-none focus:ring-0 p-0'
              selectedField={selectedGlobalField}
              onCreateNew={
                selectedGlobalField ? () => ctx.onCreateAsNewField(field.rowId) : undefined
              }
              onSelectExisting={suggestion =>
                ctx.onSelectExistingGlobalField(field.rowId, suggestion)
              }
            />
            {nameError && <p className='mt-1 text-[11px] text-destructive'>{nameError}</p>}
            {branchError && <p className='mt-1 text-[11px] text-destructive'>{branchError}</p>}
          </div>

          <FieldTypeDropdown
            value={field.fieldType}
            disabled={ctx.disabled}
            trackingCategory={track}
            onChange={value => ctx.onChangeType(field.rowId, value)}
          />
          {typeError && <p className='mt-1 text-[11px] text-destructive'>{typeError}</p>}

          {showOptions && (
            <FormFieldOptionsEditor
              rowId={field.rowId}
              options={options}
              disabled={ctx.disabled}
              error={optionsError}
              optionErrors={optionErrors}
              onChange={next => ctx.onChangeOptions(field.rowId, next)}
              trackingCategory={track}
              renderOptionChip={
                supportsBranching
                  ? option => {
                      const count = ctx.getBranchFields(option.id).length;
                      return (
                        <button
                          type='button'
                          onClick={() => ctx.onToggleOptionPanel(option.id)}
                          aria-expanded={ctx.isOptionPanelOpen(option.id)}
                          className={cn(
                            'text-[11px] font-mono px-2 py-[3px] rounded-full whitespace-nowrap flex-shrink-0',
                            count > 0
                              ? 'bg-[#6276be]/10 text-[#6276be] hover:bg-[#6276be] hover:text-white'
                              : 'border border-dashed border-border text-muted-foreground hover:border-[#6276be] hover:text-[#6276be] hover:bg-[#6276be]/10',
                          )}
                          data-track-category={track}
                          data-track-name='toggle_option_branch_panel'
                        >
                          {count > 0 ? `${count} field${count === 1 ? '' : 's'}` : '+ Add fields'}
                        </button>
                      );
                    }
                  : undefined
              }
              renderOptionPanel={supportsBranching ? renderBranchPanel : undefined}
            />
          )}
        </div>
      )}
    </div>
  );
};
