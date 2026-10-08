import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Plus } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { FormFieldType, parseFieldOptions } from '@xyne/shared';
import { toast } from 'sonner';
import { Button } from '../../ui/Button/Button';
import type { GlobalFieldSuggestion } from '../../Board/GlobalFieldNameAutocomplete';
import { getApiErrorMessage } from '../../../utils/apiError';
import { cn } from '../../../utils/classNames';
import { useConfirmDialog } from '../../../hooks/useConfirmDialog';
import {
  getEditedSharedFields,
  snapshotFieldDefinition,
  snapshotSharedFields,
} from '../../../utils/form/sharedFieldChanges';
import {
  FORM_NAME_MAX_LENGTH,
  isSelectFieldType,
  isFieldStarted,
  validateFormBuilder,
  type FieldIssue,
} from '../../../utils/form/formBuilderValidation';
import type {
  BuilderField,
  BuilderFieldOption,
  FormBuilderData,
  FormBuilderProps,
} from './FormBuilder.types';
import { FormFieldEditor, type FormFieldEditorContext } from './FormFieldEditor';
import { LockedBanner } from './LockedBanner';

const NO_ISSUES: readonly FieldIssue[] = [];

const createBlankField = (parentOptionId?: string): BuilderField => ({
  rowId: uuidv4(),
  fieldName: '',
  fieldType: FormFieldType.STRING,
  isOptional: false,
  ...(parentOptionId ? { parentOptionId } : {}),
});

const describeFields = (fields: BuilderField[]): string =>
  fields.map(field => field.fieldName || 'Untitled').join(', ');

/**
 * The one form-definition editor, hosted by the Forms page dialog and the board/flow form
 * panels. Fields live in a single flat array (branch children included); validation is
 * recomputed on every change and blocks the save inline — a field is never dropped silently.
 */
export const FormBuilder = ({
  mode,
  formId,
  initialData,
  projectId,
  persistence,
  onSubmit,
  onSaved,
  requestContext,
  submitLabel,
  readOnly: readOnlyProp = false,
  locked = false,
  lockedReason,
  allowRename = true,
  disabled = false,
  headerSlot,
  fieldsSlot,
  onCancel,
  trackingCategory = 'board_config',
  className,
  contentClassName,
  footerClassName,
}: FormBuilderProps): ReactElement => {
  const readOnly = readOnlyProp || locked;

  const [initialBlankField] = useState(() => createBlankField());
  const [formName, setFormName] = useState(initialData?.formName ?? '');
  const [formDescription, setFormDescription] = useState(initialData?.formDescription ?? '');
  const [fields, setFields] = useState<BuilderField[]>(
    () => initialData?.fields ?? [initialBlankField],
  );
  const [expandedRowId, setExpandedRowId] = useState<string | null>(
    initialData ? null : initialBlankField.rowId,
  );
  // A branch child's editor lives inside its parent's expanded card, so it needs its own
  // "which one is open" state — sharing expandedRowId would collapse the parent (and hide
  // the child with it) the moment the child opened.
  const [expandedBranchRowId, setExpandedBranchRowId] = useState<string | null>(null);
  // Branch panels start closed; the chip on each option opens its dependent fields.
  const [openOptionIds, setOpenOptionIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submittingRef = useRef(false);
  const isDirtyRef = useRef(false);
  const seededDataRef = useRef(initialData);
  // What each shared field definition looked like when it entered the builder, so a save
  // that changes one can be confirmed first — other forms may use the same field.
  const sharedBaselineRef = useRef(snapshotSharedFields(initialData?.fields ?? []));
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const fieldInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const fieldsContainerRef = useRef<HTMLDivElement>(null);

  // Reseed when the host hands over new data (e.g. Zero rows arriving), but never over the
  // user's own edits.
  useEffect(() => {
    if (!initialData || initialData === seededDataRef.current || isDirtyRef.current) return;
    seededDataRef.current = initialData;
    sharedBaselineRef.current = snapshotSharedFields(initialData.fields);
    setFormName(initialData.formName);
    setFormDescription(initialData.formDescription);
    setFields(initialData.fields);
    setOpenOptionIds(new Set());
  }, [initialData]);

  // A new form opens with its first blank field ready to type into.
  useEffect(() => {
    if (initialData || readOnlyProp || locked) return;
    const timer = setTimeout(() => fieldInputRefs.current[initialBlankField.rowId]?.focus(), 100);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validation = useMemo(() => validateFormBuilder(formName, fields), [formName, fields]);

  const issuesByRowId = useMemo(() => {
    const map = new Map<string, FieldIssue[]>();
    for (const issue of validation.fieldIssues) {
      map.set(issue.rowId, [...(map.get(issue.rowId) ?? []), issue]);
    }
    return map;
  }, [validation.fieldIssues]);

  const branchFieldsByOptionId = useMemo(() => {
    const map = new Map<string, BuilderField[]>();
    for (const field of fields) {
      if (!field.parentOptionId) continue;
      map.set(field.parentOptionId, [...(map.get(field.parentOptionId) ?? []), field]);
    }
    return map;
  }, [fields]);

  // Options that can anchor a branch: those of a top-level SINGLE_SELECT field. A child whose
  // anchor is anything else (bad stored data) is listed at the top level, flagged by
  // validation, rather than disappearing.
  const anchorOptionIds = useMemo(
    () =>
      new Set(
        fields
          .filter(field => !field.parentOptionId && field.fieldType === FormFieldType.SINGLE_SELECT)
          .flatMap(field => (field.fieldEnum ?? []).map(option => option.id)),
      ),
    [fields],
  );
  const isNestedField = (field: BuilderField): boolean =>
    Boolean(field.parentOptionId) && anchorOptionIds.has(field.parentOptionId as string);
  const topLevelFields = fields.filter(field => !isNestedField(field));

  const usedDefinitionIds = useMemo(
    () => new Set(fields.flatMap(field => (field.definitionId ? [field.definitionId] : []))),
    [fields],
  );
  const markDirty = (): void => {
    isDirtyRef.current = true;
    setSubmitError(null);
  };

  const focusFieldInput = (rowId: string): void => {
    setTimeout(() => {
      const input = fieldInputRefs.current[rowId];
      input?.focus();
      input?.scrollIntoView({ block: 'nearest' });
    }, 100);
  };

  const expandField = (field: BuilderField): void => {
    if (isNestedField(field)) {
      setExpandedBranchRowId(field.rowId);
    } else {
      setExpandedRowId(field.rowId);
      setExpandedBranchRowId(null);
    }
    focusFieldInput(field.rowId);
  };

  const collapseField = (field: BuilderField): void => {
    if (isNestedField(field)) {
      setExpandedBranchRowId(null);
    } else {
      setExpandedRowId(null);
      setExpandedBranchRowId(null);
    }
  };

  // Click outside the fields list collapses the open card(s) — unless the click landed in a
  // portaled menu, or the open card still has no name.
  useEffect(() => {
    if (!expandedRowId && !expandedBranchRowId) return;

    const handleClickOutside = (event: MouseEvent): void => {
      const target = event.target as Element;
      const container = fieldsContainerRef.current;
      const isPortalClick = target.closest(
        '[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]',
      );
      if (!container || container.contains(target) || isPortalClick) return;

      // Collapsing unmounts the open card before the browser moves focus, so a pending
      // blur-to-commit edit (the bulk options textarea) would be lost. Blur it first.
      const active = document.activeElement;
      if (active instanceof HTMLElement && container.contains(active)) active.blur();

      const isNamed = (rowId: string | null): boolean => {
        const field = fields.find(candidate => candidate.rowId === rowId);
        return !field || field.fieldName.trim().length > 0;
      };
      if (expandedRowId && isNamed(expandedRowId)) setExpandedRowId(null);
      if (expandedBranchRowId && isNamed(expandedBranchRowId)) setExpandedBranchRowId(null);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [expandedRowId, expandedBranchRowId, fields]);

  /**
   * Single write path for a field change. Any option of the field that stops being a valid
   * branch anchor (removed, or the field is no longer SINGLE_SELECT) takes its dependent
   * fields with it — announced by a toast naming them, never silently.
   */
  const replaceField = (
    rowId: string,
    build: (current: BuilderField) => BuilderField | null,
    reason: (current: BuilderField) => string,
  ): void => {
    const current = fields.find(field => field.rowId === rowId);
    if (!current) return;
    const next = build(current);

    const keptOptionIds = new Set(
      next?.fieldType === FormFieldType.SINGLE_SELECT
        ? (next.fieldEnum ?? []).map(option => option.id)
        : [],
    );
    const lostOptionIds = new Set(
      (current.fieldEnum ?? []).map(option => option.id).filter(id => !keptOptionIds.has(id)),
    );
    const orphaned = fields.filter(
      field => field.parentOptionId && lostOptionIds.has(field.parentOptionId),
    );
    if (orphaned.length > 0) {
      toast.error(
        `Removed field${orphaned.length === 1 ? '' : 's'} that depended on ${reason(current)}: ${describeFields(orphaned)}`,
      );
    }

    const removedRowIds = new Set(orphaned.map(field => field.rowId));
    if (!next) removedRowIds.add(rowId);

    setFields(prev =>
      prev
        .filter(field => !removedRowIds.has(field.rowId))
        .map(field => (field.rowId === rowId && next ? next : field)),
    );
    if (expandedRowId && removedRowIds.has(expandedRowId)) setExpandedRowId(null);
    if (expandedBranchRowId && removedRowIds.has(expandedBranchRowId)) {
      setExpandedBranchRowId(null);
    }
    markDirty();
  };

  const fieldLabel = (field: BuilderField): string => `"${field.fieldName || 'this field'}"`;

  const handleAddField = (): void => {
    const field = createBlankField();
    setFields(prev => [...prev, field]);
    markDirty();
    expandField(field);
  };

  const handleAddBranchField = (optionId: string): void => {
    const field = createBlankField(optionId);
    setFields(prev => [...prev, field]);
    setOpenOptionIds(prev => new Set(prev).add(optionId));
    markDirty();
    setExpandedBranchRowId(field.rowId);
    focusFieldInput(field.rowId);
  };

  const handleChangeType = (rowId: string, fieldType: FormFieldType): void => {
    replaceField(
      rowId,
      current => {
        const { fieldEnum, ...rest } = current;
        if (!isSelectFieldType(fieldType)) return { ...rest, fieldType };
        return {
          ...rest,
          fieldType,
          fieldEnum: isSelectFieldType(current.fieldType)
            ? (fieldEnum ?? [])
            : [{ id: uuidv4(), value: '' }],
        };
      },
      fieldLabel,
    );
  };

  const handleChangeOptions = (rowId: string, options: BuilderFieldOption[]): void => {
    replaceField(
      rowId,
      current => ({ ...current, fieldEnum: options }),
      () => 'a removed option',
    );
  };

  const applyGlobalField = (
    current: BuilderField,
    suggestion: GlobalFieldSuggestion,
  ): BuilderField => {
    // A different definition means a new membership row; the old one is reconciled away.
    const { fieldEnum: _options, membershipId: _membership, ...rest } = current;
    const options = parseFieldOptions(suggestion.fieldEnum);
    const linked: BuilderField = {
      ...rest,
      definitionId: suggestion.id,
      fieldName: suggestion.fieldName,
      fieldType: suggestion.fieldType,
      ...(options.length > 0 ? { fieldEnum: options } : {}),
    };
    if (!sharedBaselineRef.current.has(suggestion.id)) {
      sharedBaselineRef.current.set(suggestion.id, snapshotFieldDefinition(linked));
    }
    return linked;
  };

  const hasNameCollision = (name: string, exceptRowId?: string): boolean => {
    const normalized = name.trim().toLowerCase();
    return fields.some(
      field => field.rowId !== exceptRowId && field.fieldName.trim().toLowerCase() === normalized,
    );
  };

  const handleSelectExistingGlobalField = (
    rowId: string,
    suggestion: GlobalFieldSuggestion,
  ): void => {
    const isAlreadyLinked =
      fields.find(field => field.rowId === rowId)?.definitionId === suggestion.id;
    if (
      !isAlreadyLinked &&
      (hasNameCollision(suggestion.fieldName, rowId) || usedDefinitionIds.has(suggestion.id))
    ) {
      toast.error(`"${suggestion.fieldName}" is already used in this form`);
      return;
    }
    replaceField(rowId, current => applyGlobalField(current, suggestion), fieldLabel);
  };

  const handleCreateAsNewField = (rowId: string): void => {
    replaceField(
      rowId,
      current => {
        const { definitionId: _definition, membershipId: _membership, ...rest } = current;
        return rest;
      },
      fieldLabel,
    );
  };

  const focusFirstIssue = (): void => {
    const first = validation.fieldIssues[0];
    const field = first && fields.find(candidate => candidate.rowId === first.rowId);
    if (!field) return;
    if (isNestedField(field)) {
      const parent = fields.find(candidate =>
        candidate.fieldEnum?.some(option => option.id === field.parentOptionId),
      );
      if (parent) setExpandedRowId(parent.rowId);
      setOpenOptionIds(prev => new Set(prev).add(field.parentOptionId as string));
      setExpandedBranchRowId(field.rowId);
    } else {
      setExpandedRowId(field.rowId);
      setExpandedBranchRowId(null);
    }
    focusFieldInput(field.rowId);
  };

  const handleSubmit = async (): Promise<void> => {
    if (submittingRef.current || readOnly || disabled || disabledReason) return;
    if (!validation.valid) {
      focusFirstIssue();
      return;
    }

    const editedShared = getEditedSharedFields(sharedBaselineRef.current, fields);
    if (editedShared.length > 0) {
      const names = editedShared
        .map(({ field, originalName }) =>
          field.fieldName.trim() === originalName
            ? `"${originalName}"`
            : `"${originalName}" (renamed to "${field.fieldName.trim()}")`,
        )
        .join(', ');
      const many = editedShared.length > 1;
      const confirmed = await confirm({
        title: many ? 'Update shared fields?' : 'Update shared field?',
        description: `You changed ${many ? 'existing fields' : 'an existing field'}: ${names}. ${
          many ? 'These fields' : 'This field'
        } may be used in other forms, and your changes will apply everywhere ${
          many ? 'they are' : 'it is'
        } used.`,
        confirmLabel: 'Save changes',
        cancelLabel: 'Go back',
      });
      if (!confirmed) return;
    }

    const data: FormBuilderData = {
      formName: formName.trim(),
      formDescription: formDescription.trim(),
      fields,
    };

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    let savedFormId: string | undefined;
    let saved = false;
    try {
      if (persistence) {
        if (!requestContext) throw new Error('Form context is missing');
        if (mode === 'edit') {
          if (!formId) throw new Error('Form id is missing');
          await persistence.update(formId, data, requestContext);
          savedFormId = formId;
        } else {
          savedFormId = (await persistence.create(data, requestContext)).formId;
        }
      } else {
        await onSubmit?.(data);
      }
      saved = true;
    } catch (error) {
      setSubmitError(getApiErrorMessage(error, 'Could not save the form. Please try again.'));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
    // Outside the try: a host callback that throws must not make a completed save look failed.
    if (saved && savedFormId) onSaved?.(savedFormId);
  };

  const inputsDisabled = disabled || submitting;

  const editorContext: FormFieldEditorContext = {
    projectId,
    readOnly,
    disabled: inputsDisabled,
    trackingCategory,
    expandedRowId,
    expandedBranchRowId,
    getIssues: rowId => issuesByRowId.get(rowId) ?? NO_ISSUES,
    getBranchFields: optionId => branchFieldsByOptionId.get(optionId) ?? [],
    isOptionPanelOpen: optionId => openOptionIds.has(optionId),
    registerInputRef: (rowId, el) => {
      fieldInputRefs.current[rowId] = el;
    },
    onExpand: expandField,
    onCollapse: collapseField,
    onRename: (rowId, fieldName) =>
      replaceField(rowId, current => ({ ...current, fieldName }), fieldLabel),
    onToggleRequired: rowId =>
      replaceField(rowId, current => ({ ...current, isOptional: !current.isOptional }), fieldLabel),
    onChangeType: handleChangeType,
    onChangeOptions: handleChangeOptions,
    onDelete: rowId => replaceField(rowId, () => null, fieldLabel),
    onSelectExistingGlobalField: handleSelectExistingGlobalField,
    onCreateAsNewField: handleCreateAsNewField,
    onToggleOptionPanel: optionId =>
      setOpenOptionIds(prev => {
        const next = new Set(prev);
        if (next.has(optionId)) {
          next.delete(optionId);
        } else {
          next.add(optionId);
        }
        return next;
      }),
    onAddBranchField: handleAddBranchField,
  };

  const needsProject =
    !projectId && fields.some(field => isFieldStarted(field) && !field.definitionId);
  const disabledReason = needsProject ? 'Select a project for the new fields' : null;

  const formNameIssue = validation.formIssues.find(
    issue => issue.code === 'form-name-too-long',
  )?.message;
  const blockingReason =
    disabledReason ??
    validation.formIssues[0]?.message ??
    validation.fieldIssues[0]?.message ??
    null;
  const canJumpToIssue = !disabledReason && validation.formIssues.length === 0 && !validation.valid;
  const resolvedSubmitLabel = submitLabel ?? (mode === 'edit' ? 'Update Form' : 'Save');

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <ConfirmDialog />
      <div className={cn('flex min-h-0 flex-col gap-[12px]', contentClassName)}>
        {locked && <LockedBanner reason={lockedReason} />}
        {headerSlot}

        <div>
          {readOnly ? (
            <>
              <p className='text-[17px] font-semibold text-foreground'>{formName || '-'}</p>
              {formDescription && (
                <p className='mt-1 whitespace-pre-wrap text-[14px] text-foreground'>
                  {formDescription}
                </p>
              )}
            </>
          ) : (
            <>
              <input
                type='text'
                value={formName}
                onChange={e => {
                  setFormName(e.target.value);
                  markDirty();
                }}
                placeholder='Form Title'
                aria-label='Form title'
                maxLength={Math.max(FORM_NAME_MAX_LENGTH, formName.length)}
                disabled={inputsDisabled || !allowRename}
                className='w-full text-[17px] font-semibold text-foreground bg-transparent border-0 focus:outline-none focus:ring-0 p-0 placeholder:text-muted-foreground/50 disabled:cursor-not-allowed'
                data-track-category={trackingCategory}
                data-track-name='form_title_input'
              />
              {formNameIssue && <p className='text-[11px] text-destructive'>{formNameIssue}</p>}
              <textarea
                value={formDescription}
                onChange={e => {
                  setFormDescription(e.target.value);
                  markDirty();
                }}
                placeholder='Add description'
                aria-label='Form description'
                rows={2}
                disabled={inputsDisabled}
                className='w-full text-[14px] text-foreground bg-transparent border-0 focus:outline-none focus:ring-0 p-0 mt-1 resize-none placeholder:text-muted-foreground/50'
                data-track-category={trackingCategory}
                data-track-name='form_description_input'
              />
            </>
          )}
        </div>

        {fieldsSlot}

        <div className='flex flex-col gap-[8px]' ref={fieldsContainerRef}>
          {topLevelFields.map(field => (
            <FormFieldEditor key={field.rowId} field={field} nested={false} ctx={editorContext} />
          ))}
          {readOnly && topLevelFields.length === 0 && (
            <p className='rounded-[12px] border border-dashed border-border py-6 text-center text-[13px] text-muted-foreground'>
              No fields added yet.
            </p>
          )}
        </div>

        {!readOnly && (
          <Button
            onClick={handleAddField}
            disabled={inputsDisabled}
            variant='ghost'
            size='sm'
            className='text-[#6276be] font-medium hover:bg-blue-50 w-fit'
            data-track-category={trackingCategory}
            data-track-name='add_question'
          >
            <Plus size={16} />
            Add field
          </Button>
        )}
      </div>

      {!readOnly && (
        <div className={cn('px-[16px] py-[14px]', footerClassName)}>
          {submitError && (
            <p role='alert' className='text-[12px] text-destructive mb-2 text-center'>
              {submitError}
            </p>
          )}
          {!submitError && blockingReason && (
            <p className='text-[12px] text-muted-foreground mb-2 text-center'>
              {blockingReason}
              {canJumpToIssue && (
                <>
                  {' · '}
                  <button
                    type='button'
                    onClick={focusFirstIssue}
                    className='text-[#6276be] font-medium hover:underline'
                    data-track-category={trackingCategory}
                    data-track-name='show_form_issue'
                  >
                    Show
                  </button>
                </>
              )}
            </p>
          )}
          <div className='flex gap-2'>
            {onCancel && (
              <Button
                type='button'
                variant='outline'
                onClick={onCancel}
                disabled={submitting}
                className='flex-1 rounded-[8px] py-[6px] text-[13px] font-medium'
                data-track-category={trackingCategory}
                data-track-name='cancel_form'
              >
                Cancel
              </Button>
            )}
            <Button
              type='button'
              trackId={mode === 'edit' ? 'update_form' : 'save_form'}
              trackAction={handleSubmit}
              data-track-category={trackingCategory}
              data-track-name='SAVE_FORM'
              disabled={!validation.valid || inputsDisabled || Boolean(disabledReason)}
              className='flex-1 bg-[#6276be] hover:bg-[#5060a0] disabled:bg-[#c9cccf] disabled:cursor-not-allowed text-white rounded-[8px] py-[6px] text-[13px] font-medium'
            >
              {submitting ? `${resolvedSubmitLabel}…` : resolvedSubmitLabel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
