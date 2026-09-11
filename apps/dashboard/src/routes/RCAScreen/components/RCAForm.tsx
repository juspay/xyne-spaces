import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, type Path, type PathValue } from 'react-hook-form';
import { Button } from '../../../components/ui/Button';
import Textarea from '../../../components/ui/Textarea';
import { Combobox } from '../../../components/ui/Combobox/Combobox';
import { cn } from '../../../utils/classNames';
import { useZero } from '../../../hooks/useZero';
import { usePlatform } from '../../../hooks/usePlatform';
import { toast } from 'sonner';
import { rcaSchema } from '../schemas';
import { formatDate, renderFieldError, ReadOnlyField } from '../RCAScreen.utils.tsx';
import { mutators } from '../../../zero/mutators';
import type { FormControllerRef, RCAFormProps, RCAFormValues } from '../RCAScreen.types';

interface RCAFormComponentProps extends RCAFormProps {
  onSubmit: (values: RCAFormValues) => Promise<void>;
  controllerRef?: React.MutableRefObject<FormControllerRef | null>;
}

const toDateTimeLocal = (value?: number | null): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (num: number): string => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const fromDateTimeLocal = (value: string): number | null =>
  value ? new Date(value).getTime() : null;

const getRcaDefaultValues = (selectedRecord: RCAFormProps['selectedRecord']): RCAFormValues => ({
  ticketId: selectedRecord.ticketId,
  ownerId: selectedRecord.ownerId,
  title: selectedRecord.title ?? '',
  summary: selectedRecord.summary ?? '',
  rootCause: selectedRecord.rootCause ?? '',
  severity: selectedRecord.severity,
  bugType: selectedRecord.bugTypeId,
  category: selectedRecord.categoryTypeId,
  issueCategory: selectedRecord.issueCategoryId ?? '',
  issueStartAt: selectedRecord.issueStartAt ?? null,
  status: selectedRecord.status,
});

export const RCAForm = ({
  selectedRecord,
  isRcaEditable,
  isSubmitting,
  ownerItems,
  filteredOwnerItems,
  ownerSearchQuery,
  setOwnerSearchQuery,
  bugTypeOptions,
  categoryOptions,
  categoryOptionsByBugTypeValue,
  severityOptions,
  issueCategoryOptionsByCategoryValue,
  issueCategoryRequiredByCategoryValue,
  onSubmit,
  controllerRef,
}: RCAFormComponentProps) => {
  const zero = useZero();
  const { isMobile } = usePlatform();
  const [showErrors, setShowErrors] = useState(false);
  const ownerComboboxRef = useRef<HTMLInputElement>(null);
  const form = useForm<RCAFormValues>({
    defaultValues: getRcaDefaultValues(selectedRecord),
  });
  const { watch, setValue, getValues, reset, formState } = form;
  const isDirty = formState.isDirty;
  const formValues = watch();
  const isTouched = (field: keyof RCAFormValues): boolean =>
    Boolean(formState.touchedFields[field]);

  // Reset form when selectedRecord changes
  useEffect(() => {
    reset(getRcaDefaultValues(selectedRecord));
    setShowErrors(false);
    setOwnerSearchQuery('');
  }, [reset, selectedRecord, setOwnerSearchQuery]);

  // Computed values
  const bugTypeValue = formValues.bugType;
  const filteredCategories = useMemo(
    () => categoryOptionsByBugTypeValue[bugTypeValue] ?? [],
    [bugTypeValue, categoryOptionsByBugTypeValue],
  );
  const currentCategoryValue = formValues.category;
  const filteredIssueCategoryOptions = useMemo(
    () => issueCategoryOptionsByCategoryValue[currentCategoryValue ?? ''] ?? [],
    [currentCategoryValue, issueCategoryOptionsByCategoryValue],
  );
  const showIssueCategory =
    issueCategoryRequiredByCategoryValue[currentCategoryValue ?? ''] ?? false;

  // Track previous values to avoid infinite loops
  const prevBugTypeIdRef = useRef(formValues.bugType);

  // Auto-select UI/UX category for UI/UX bug type
  useEffect(() => {
    if (bugTypeValue !== 'ui_ux') return;
    const uiUxCategoryId = categoryOptions.find(option => option.value === 'ui_ux')?.value;
    if (!uiUxCategoryId || formValues.category === uiUxCategoryId) return;
    setValue('category', uiUxCategoryId, { shouldDirty: true });
  }, [bugTypeValue, categoryOptions, formValues.category, setValue]);

  // Clear issue category when not shown or invalid
  useEffect(() => {
    if (!showIssueCategory) {
      if (formValues.issueCategory !== '') {
        setValue('issueCategory', '', { shouldDirty: true });
      }
      return;
    }
    const currentIssueCategory = formValues.issueCategory;
    if (!currentIssueCategory) return;
    if (!filteredIssueCategoryOptions.some(option => option.value === currentIssueCategory)) {
      setValue('issueCategory', '', { shouldDirty: true });
    }
  }, [showIssueCategory, filteredIssueCategoryOptions, formValues.issueCategory, setValue]);

  // Clear category when bug type changes and category is no longer valid
  useEffect(() => {
    if (!formValues.bugType) return;

    // Only run when bugType actually changes, not on every formValues update
    if (prevBugTypeIdRef.current === formValues.bugType) return;
    prevBugTypeIdRef.current = formValues.bugType;

    const currentCategoryId = formValues.category;
    const isCurrentCategoryAllowed = filteredCategories.some(
      option => option.value === currentCategoryId,
    );

    if (filteredCategories.length === 0) {
      if (formValues.category !== '') {
        setValue('category', '', { shouldDirty: true });
      }
      return;
    }
    if (currentCategoryId && !isCurrentCategoryAllowed) {
      if (formValues.category !== '') {
        setValue('category', '', { shouldDirty: true });
      }
    }
  }, [formValues.bugType, filteredCategories, formValues.category, setValue]);

  const handleFieldChange = <K extends Path<RCAFormValues>>(
    field: K,
    value: PathValue<RCAFormValues, K>,
  ) => {
    setValue(field, value, { shouldDirty: true, shouldTouch: true });
  };

  const handleFieldBlur = (field: keyof RCAFormValues) => {
    const value = getValues(field);
    setValue(field, value, { shouldTouch: true });
  };

  const validateForm = (): boolean => {
    const currentValues = getValues();
    const result = rcaSchema.safeParse({
      ...currentValues,
      status: selectedRecord.status,
    });
    if (!result.success) {
      return false;
    }
    // Additional check for issue category
    if (showIssueCategory && !currentValues.issueCategory) {
      return false;
    }
    return true;
  };

  const hasUnsavedChanges = (): boolean => isDirty;
  const discardDraft = (): void => {
    reset(getRcaDefaultValues(selectedRecord));
    setShowErrors(false);
    setOwnerSearchQuery('');
  };

  const getFieldError = (field: keyof RCAFormValues): string | null => {
    const result = rcaSchema.shape[field].safeParse(getValues(field));
    if (!result.success) {
      return result.error.issues[0]?.message ?? null;
    }
    return null;
  };

  const handleSaveDraft = async (): Promise<boolean> => {
    const currentValues = getValues();
    setShowErrors(true);
    if (!validateForm()) {
      toast.error('Please fill all required fields in the RCA Phase');
      return false;
    }

    try {
      const mutationResult = zero.mutate(
        mutators.rca.update({
          id: selectedRecord.id,
          ticketId: currentValues.ticketId,
          title: currentValues.title,
          summary: currentValues.summary,
          rootCause: currentValues.rootCause,
          severity: currentValues.severity,
          bugTypeId: currentValues.bugType,
          categoryTypeId: currentValues.category,
          issueCategoryId: currentValues.issueCategory,
          issueStartAt: currentValues.issueStartAt ?? null,
          status: selectedRecord.status,
          timestamp: Date.now(),
        }),
      );
      const serverResult = await mutationResult.server;
      if (serverResult.type === 'error') {
        toast.error(serverResult.error.message || 'Failed to save RCA details');
        return false;
      }
      reset(currentValues);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save RCA details');
      return false;
    }
  };

  const handleSaveDraftClick = async (): Promise<void> => {
    const saved = await handleSaveDraft();
    if (saved) {
      toast.success('RCA details saved');
    }
  };

  // Assign the save function to the mutable ref on every render
  // This guarantees the parent always calls the latest version
  if (controllerRef) {
    controllerRef.current = {
      save: handleSaveDraft,
      hasUnsavedChanges,
      discard: discardDraft,
    };
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setShowErrors(true);

    const currentCategoryValue = formValues.category;
    const requiresIssueCategory =
      issueCategoryRequiredByCategoryValue[currentCategoryValue] ?? false;

    if (requiresIssueCategory && !formValues.issueCategory) {
      toast.error('Issue category is required');
      return;
    }

    const result = rcaSchema.safeParse({
      ...formValues,
      status: selectedRecord.status,
    });

    if (!result.success) {
      toast.error(result.error.issues[0]?.message ?? 'Please fill all required fields');
      return;
    }

    const payload: RCAFormValues = {
      ...result.data,
      summary: result.data.summary ?? '',
      rootCause: result.data.rootCause ?? '',
      issueCategory: result.data.issueCategory ?? '',
      issueStartAt: result.data.issueStartAt ?? null,
    };
    await onSubmit(payload);
  };

  const selectedOwner = useMemo(() => {
    return ownerItems.find(o => o.value === formValues.ownerId) ?? null;
  }, [ownerItems, formValues.ownerId]);

  const ownerDisplayValue = selectedOwner ? selectedOwner.label : ownerSearchQuery;

  useEffect(() => {
    if (!isMobile && isRcaEditable) {
      const rafId = requestAnimationFrame(() => {
        ownerComboboxRef.current?.focus();
      });
      return () => cancelAnimationFrame(rafId);
    }
    return undefined;
  }, [isMobile, isRcaEditable]);

  return (
    <div className='h-full overflow-y-auto'>
      <div className='bg-background shadow-sm border border-border rounded-xl'>
        {/* Header */}
        <div className='px-8 py-6 border-b border-border bg-gradient-to-r from-muted/40 to-background'>
          <div className='flex items-center gap-3'>
            <div className='h-10 w-10 rounded-lg bg-blue-600 flex items-center justify-center'>
              <svg
                className='h-5 w-5 text-white'
                fill='none'
                viewBox='0 0 24 24'
                stroke='currentColor'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01'
                />
              </svg>
            </div>
            <div>
              <h2 className='text-xl font-bold text-foreground'>RCA Details</h2>
              <p className='text-sm text-muted-foreground'>Document the incident root cause</p>
            </div>
          </div>
        </div>

        {/* Form Section */}
        <form
          className='p-8 space-y-8'
          onSubmit={e => {
            void handleSubmit(e);
          }}
        >
          {/* Owner */}
          <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
            <div className='space-y-1.5'>
              {isRcaEditable ? (
                <>
                  <Combobox
                    ref={ownerComboboxRef}
                    label='Owner *'
                    placeholder='Search and select owner...'
                    queryString={ownerDisplayValue}
                    onInputValueChange={value => {
                      if (value === '' && selectedOwner) return;
                      setOwnerSearchQuery(value);
                      if (selectedOwner && value !== selectedOwner.label) {
                        handleFieldChange('ownerId', '');
                      }
                    }}
                    items={filteredOwnerItems}
                    value={selectedOwner}
                    onValueChange={value => {
                      handleFieldChange('ownerId', value ?? '');
                      setOwnerSearchQuery('');
                    }}
                  />
                  {renderFieldError(getFieldError('ownerId'), showErrors || isTouched('ownerId'))}
                </>
              ) : (
                <ReadOnlyField label='Owner' value={selectedOwner?.label ?? formValues.ownerId} />
              )}
            </div>
          </div>

          {/* Title */}
          <div className='space-y-1.5'>
            <label htmlFor='rca-title' className='text-sm font-medium text-foreground'>
              Title *
            </label>
            <input
              id='rca-title'
              type='text'
              value={formValues.title}
              onChange={e => handleFieldChange('title', e.target.value)}
              onBlur={() => handleFieldBlur('title')}
              data-track-category='RCA'
              data-track-name='RcaTitleInput'
              placeholder='Short RCA title...'
              readOnly={!isRcaEditable}
              className='w-full px-3 py-2 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500'
            />
            {renderFieldError(getFieldError('title'), showErrors || isTouched('title'))}
          </div>

          {/* Summary */}
          <div className='space-y-1.5'>
            <label htmlFor='rca-summary' className='text-sm font-medium text-foreground'>
              Summary *
            </label>
            <Textarea
              id='rca-summary'
              value={formValues.summary}
              onChange={e => handleFieldChange('summary', e.target.value)}
              onBlur={() => handleFieldBlur('summary')}
              placeholder='Short RCA overview...'
              rows={3}
              readOnly={!isRcaEditable}
              aria-invalid={showErrors && !!getFieldError('summary')}
              className={cn(
                showErrors &&
                  !!getFieldError('summary') &&
                  'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
              )}
            />
            {renderFieldError(getFieldError('summary'), showErrors || isTouched('summary'))}
          </div>

          {/* Root Cause & Severity */}
          <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
            <div className='space-y-1.5'>
              <label htmlFor='rca-root-cause' className='text-sm font-medium text-foreground'>
                Root Cause *
              </label>
              <Textarea
                id='rca-root-cause'
                value={formValues.rootCause}
                onChange={e => handleFieldChange('rootCause', e.target.value)}
                onBlur={() => handleFieldBlur('rootCause')}
                placeholder='Describe the root cause...'
                rows={4}
                readOnly={!isRcaEditable}
                aria-invalid={showErrors && !!getFieldError('rootCause')}
                className={cn(
                  showErrors &&
                    !!getFieldError('rootCause') &&
                    'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
                )}
              />
              {renderFieldError(getFieldError('rootCause'), showErrors || isTouched('rootCause'))}
            </div>

            <div className='space-y-1.5'>
              <label htmlFor='rca-severity' className='text-sm font-medium text-foreground'>
                Severity *
              </label>
              <select
                id='rca-severity'
                value={formValues.severity}
                onChange={e =>
                  handleFieldChange('severity', e.target.value as RCAFormValues['severity'])
                }
                onBlur={() => handleFieldBlur('severity')}
                data-track-category='RCA'
                data-track-name='RcaSeveritySelect'
                disabled={!isRcaEditable}
                className='w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background'
              >
                {severityOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {renderFieldError(getFieldError('severity'), showErrors || isTouched('severity'))}
            </div>
          </div>

          {/* Bug Type & Category */}
          <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
            <div className='space-y-1.5'>
              <label htmlFor='rca-bug-type' className='text-sm font-medium text-foreground'>
                Bug Type *
              </label>
              <select
                id='rca-bug-type'
                value={formValues.bugType}
                onChange={e => handleFieldChange('bugType', e.target.value)}
                onBlur={() => handleFieldBlur('bugType')}
                data-track-category='RCA'
                data-track-name='RcaBugTypeSelect'
                disabled={!isRcaEditable}
                className='w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background'
              >
                <option value=''>Select bug type</option>
                {bugTypeOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {renderFieldError(getFieldError('bugType'), showErrors || isTouched('bugType'))}
            </div>

            {formValues.bugType && bugTypeValue !== 'ui_ux' && (
              <div className='space-y-1.5'>
                <label htmlFor='rca-category-type' className='text-sm font-medium text-foreground'>
                  Category Type *
                </label>
                <select
                  id='rca-category-type'
                  value={formValues.category}
                  onChange={e => handleFieldChange('category', e.target.value)}
                  onBlur={() => handleFieldBlur('category')}
                  data-track-category='RCA'
                  data-track-name='RcaCategoryTypeSelect'
                  disabled={!isRcaEditable}
                  className='w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background'
                >
                  <option value=''>Select category</option>
                  {filteredCategories.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {renderFieldError(getFieldError('category'), showErrors || isTouched('category'))}
              </div>
            )}
          </div>

          {/* Issue Category */}
          {showIssueCategory && (
            <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
              <div className='space-y-1.5'>
                <label htmlFor='rca-issue-category' className='text-sm font-medium text-foreground'>
                  Issue Category *
                </label>
                <select
                  id='rca-issue-category'
                  value={formValues.issueCategory}
                  onChange={e => handleFieldChange('issueCategory', e.target.value)}
                  onBlur={() => handleFieldBlur('issueCategory')}
                  data-track-category='RCA'
                  data-track-name='RcaIssueCategorySelect'
                  disabled={!isRcaEditable}
                  className='w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background'
                >
                  <option value=''>Select issue category</option>
                  {filteredIssueCategoryOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {renderFieldError(
                  showIssueCategory && !formValues.issueCategory
                    ? 'Issue category is required'
                    : null,
                  showErrors || isTouched('issueCategory'),
                )}
              </div>
            </div>
          )}

          {/* Issue Start Time */}
          <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
            <div className='space-y-1.5'>
              <label htmlFor='rca-issue-start' className='text-sm font-medium text-foreground'>
                Issue Start Time *
              </label>
              <input
                id='rca-issue-start'
                type='datetime-local'
                value={toDateTimeLocal(formValues.issueStartAt)}
                onChange={e => handleFieldChange('issueStartAt', fromDateTimeLocal(e.target.value))}
                data-track-category='RCA'
                data-track-name='RcaIssueStartInput'
                disabled={!isRcaEditable}
                className='w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background'
              />
            </div>
          </div>

          {/* Footer */}
          <div className='sticky bottom-0 -mx-8 -mb-8 p-4 bg-background/95 backdrop-blur border-t border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3'>
            <div className='text-xs text-muted-foreground'>
              Created {formatDate(selectedRecord.createdAt)} - Updated{' '}
              {formatDate(selectedRecord.updatedAt)}
            </div>
            <div className='flex flex-wrap gap-2'>
              <Button
                type='button'
                variant='outline'
                onClick={() => void handleSaveDraftClick()}
                data-track-category='RCA'
                data-track-name='SAVE_RCA_DRAFT'
                loading={isSubmitting}
                disabled={isSubmitting}
              >
                Save Draft
              </Button>
              <Button type='submit' loading={isSubmitting} disabled={isSubmitting}>
                Next
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
