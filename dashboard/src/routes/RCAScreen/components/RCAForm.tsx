import { useEffect, useState } from 'react';
import { useStore } from '@tanstack/react-store';
import { Button } from '../../../components/ui/Button';
import Textarea from '../../../components/ui/Textarea';
import { Combobox } from '../../../components/ui/Combobox/Combobox';
import { cn } from '../../../utils/classNames';
import { useForm } from '@tanstack/react-form';
import { useZero } from '../../../hooks/useZero';
import { toast } from 'sonner';
import { rcaSchema } from '../schemas';
import {
  formatDate,
  renderFieldError,
  ReadOnlyField,
  bugCategoryValueMap,
} from '../RCAScreen.utils.tsx';
import { mutators } from '../../../zero/mutators';
import type { RCAFormProps, RCAFormValues } from '../RCAScreen.types';

interface RCAFormComponentProps extends RCAFormProps {
  onSubmit: (values: RCAFormValues) => Promise<void>;
}

export const RCAForm = ({
  selectedRecord,
  isRcaEditable,
  isSubmitting,
  ownerItems,
  filteredOwnerItems,
  ownerSearchQuery,
  setOwnerSearchQuery,
  bugTypeOptions,
  categoryTypeOptions,
  severityOptions,
  bugTypeValueById,
  categoryValueById,
  issueCategoryOptionsByCategoryValue,
  pendingRCA,
  setPendingRCA,
  onSubmit,
}: RCAFormComponentProps) => {
  const zero = useZero();
  const toDateTimeLocal = (value?: number | null): string => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (num: number): string => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const fromDateTimeLocal = (value: string): number | null =>
    value ? new Date(value).getTime() : null;

  const rcaForm = useForm({
    defaultValues: {
      ticketId: pendingRCA?.ticketId ?? selectedRecord.ticketId,
      ownerId: pendingRCA?.ownerId ?? selectedRecord.ownerId,
      title: (pendingRCA?.title ?? selectedRecord.title) || '',
      summary: (pendingRCA?.summary ?? selectedRecord.summary) || '',
      rootCause: (pendingRCA?.rootCause ?? selectedRecord.rootCause) || '',
      severity: pendingRCA?.severity ?? selectedRecord.severity,
      bugTypeId: pendingRCA?.bugTypeId ?? selectedRecord.bugTypeId,
      categoryTypeId: pendingRCA?.categoryTypeId ?? selectedRecord.categoryTypeId,
      issueCategoryId: (pendingRCA?.issueCategoryId ?? selectedRecord.issueCategoryId) || '',
      issueStartAt: pendingRCA?.issueStartAt ?? selectedRecord.issueStartAt ?? null,
      status: pendingRCA?.status ?? selectedRecord.status,
    } as RCAFormValues,
    onSubmit: async ({ value }) => {
      const currentBugTypeValue = bugTypeValueById.get(value.bugTypeId) ?? '';
      const currentCategoryValue = categoryValueById.get(value.categoryTypeId) ?? '';
      const requiresIssueCategory =
        currentBugTypeValue === 'Reliability' &&
        ['Capacity', 'Change', 'Fault'].includes(currentCategoryValue);
      if (requiresIssueCategory && !value.issueCategoryId) {
        toast.error('Issue category is required');
        return;
      }
      const result = rcaSchema.safeParse({
        ...value,
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
        issueCategoryId: result.data.issueCategoryId ?? '',
        issueStartAt: result.data.issueStartAt ?? null,
      };
      await onSubmit(payload);
    },
  });

  const [selectedBugTypeId, setSelectedBugTypeId] = useState<string>('');
  const formValues = useStore(rcaForm.store, state => state.values);

  useEffect(() => {
    setSelectedBugTypeId(rcaForm.store.state.values.bugTypeId);
  }, [selectedRecord.id, selectedRecord.updatedAt]);

  // Save form values to pendingRCA when they change
  useEffect(() => {
    if (setPendingRCA) {
      setPendingRCA(formValues);
    }
  }, [formValues, setPendingRCA]);

  const currentBugTypeId = selectedBugTypeId ? selectedBugTypeId : formValues.bugTypeId;
  const bugTypeValue = bugTypeValueById.get(currentBugTypeId) ?? '';
  const allowedCategoryValues = bugTypeValue ? (bugCategoryValueMap[bugTypeValue] ?? []) : [];
  const uiUxCategoryId = categoryTypeOptions.find(option => option.label === 'UI/UX')?.value ?? '';
  const currentCategoryValue = categoryValueById.get(formValues.categoryTypeId);
  const filteredIssueCategoryOptions =
    issueCategoryOptionsByCategoryValue[currentCategoryValue ?? ''] ?? [];
  const showIssueCategory =
    bugTypeValue === 'Reliability' &&
    ['Capacity', 'Change', 'Fault'].includes(currentCategoryValue ?? '');

  useEffect(() => {
    if (bugTypeValue !== 'UI/UX') return;
    if (!uiUxCategoryId) return;
    if (formValues.categoryTypeId === uiUxCategoryId) return;
    rcaForm.setFieldValue('categoryTypeId', uiUxCategoryId);
  }, [bugTypeValue, uiUxCategoryId, rcaForm, formValues.categoryTypeId]);

  const getAllowedCategoryValues = (bugTypeId: string): string[] => {
    const bugValue = bugTypeValueById.get(bugTypeId);
    if (!bugValue) return [];
    return bugCategoryValueMap[bugValue] ?? [];
  };

  const handleSaveDraft = async (): Promise<void> => {
    const values = rcaForm.store.state.values;
    const result = rcaSchema.safeParse({
      ...values,
      status: selectedRecord.status,
    });
    if (!result.success) {
      toast.error(result.error.issues[0]?.message ?? 'Please fill all required fields');
      return;
    }

    try {
      const mutationResult = zero.mutate(
        mutators.rca.update({
          id: selectedRecord.id,
          ticketId: values.ticketId,
          title: values.title,
          summary: values.summary,
          rootCause: values.rootCause,
          severity: values.severity,
          bugTypeId: values.bugTypeId,
          categoryTypeId: values.categoryTypeId,
          issueCategoryId: values.issueCategoryId,
          issueStartAt: values.issueStartAt ?? null,
          status: selectedRecord.status,
          timestamp: Date.now(),
        }),
      );
      const serverResult = await mutationResult.server;
      if (serverResult.type === 'error') {
        toast.error(serverResult.error.message || 'Failed to save RCA details');
        return;
      }
      toast.success('RCA details saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save RCA details');
    }
  };

  useEffect(() => {
    if (!showIssueCategory) {
      rcaForm.setFieldValue('issueCategoryId', '');
      return;
    }
    const currentIssueCategory = formValues.issueCategoryId;
    if (!currentIssueCategory) return;
    if (!filteredIssueCategoryOptions.some(option => option.value === currentIssueCategory)) {
      rcaForm.setFieldValue('issueCategoryId', '');
    }
  }, [showIssueCategory, filteredIssueCategoryOptions, rcaForm, formValues.issueCategoryId]);

  useEffect(() => {
    // Skip reset if we have pendingRCA to preserve unsaved changes when switching tabs
    if (pendingRCA) {
      setSelectedBugTypeId(pendingRCA.bugTypeId ?? '');
      return;
    }
    rcaForm.reset({
      ticketId: selectedRecord.ticketId,
      ownerId: selectedRecord.ownerId,
      title: selectedRecord.title ?? '',
      summary: selectedRecord.summary ?? '',
      rootCause: selectedRecord.rootCause ?? '',
      severity: selectedRecord.severity,
      bugTypeId: selectedRecord.bugTypeId,
      categoryTypeId: selectedRecord.categoryTypeId,
      issueCategoryId: selectedRecord.issueCategoryId ?? '',
      issueStartAt: selectedRecord.issueStartAt ?? null,
      status: selectedRecord.status,
    });
    setOwnerSearchQuery('');
    setSelectedBugTypeId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRecord.id, selectedRecord.updatedAt, pendingRCA]);

  return (
    <div className='h-full overflow-y-auto'>
      <div className='bg-background shadow-sm border border-border rounded-xl overflow-hidden'>
        {/* Header Section */}
        <div className='px-8 py-6 border-b border-border bg-gradient-to-r from-gray-50 to-white'>
          <div className='flex items-center justify-between'>
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
        </div>

        {/* Form Section */}
        <form
          className='p-8 space-y-8'
          onSubmit={e => {
            e.preventDefault();
            void rcaForm.handleSubmit();
          }}
        >
          <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
            <rcaForm.Field
              name='ownerId'
              validators={{
                onBlur: ({ value }) => {
                  const result = rcaSchema.shape.ownerId.safeParse(value);
                  return result.success ? undefined : result.error.issues[0]?.message;
                },
              }}
            >
              {field => {
                const selectedOwner = ownerItems.find(o => o.value === field.state.value) ?? null;
                const displayValue = selectedOwner ? selectedOwner.label : ownerSearchQuery;
                return (
                  <div className='space-y-1.5'>
                    {isRcaEditable ? (
                      <div>
                        <Combobox
                          label='Owner *'
                          placeholder='Search and select owner...'
                          queryString={displayValue}
                          onInputValueChange={value => {
                            if (value === '' && selectedOwner) {
                              return;
                            }
                            setOwnerSearchQuery(value);
                            if (selectedOwner && value !== selectedOwner.label) {
                              field.handleChange('');
                            }
                          }}
                          items={filteredOwnerItems}
                          value={selectedOwner}
                          onValueChange={value => {
                            field.handleChange(value ?? '');
                            setOwnerSearchQuery('');
                          }}
                        />
                        {renderFieldError(
                          field.state.meta.errors[0] as string,
                          field.state.meta.isTouched,
                        )}
                      </div>
                    ) : (
                      <ReadOnlyField
                        label='Owner'
                        value={selectedOwner?.label ?? field.state.value}
                      />
                    )}
                  </div>
                );
              }}
            </rcaForm.Field>
          </div>

          <rcaForm.Field
            name='title'
            validators={{
              onBlur: ({ value }) => {
                const result = rcaSchema.shape.title.safeParse(value);
                return result.success ? undefined : result.error.issues[0]?.message;
              },
            }}
          >
            {field => (
              <div className='space-y-1.5'>
                <label htmlFor='rca-title' className='text-sm font-medium text-foreground'>
                  Title *
                </label>
                <input
                  id='rca-title'
                  type='text'
                  value={field.state.value}
                  onChange={e => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  data-track-category='RCA'
                  data-track-name='RcaTitleInput'
                  placeholder='Short RCA title...'
                  readOnly={!isRcaEditable}
                  className='w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500'
                />
                {renderFieldError(field.state.meta.errors[0] as string, field.state.meta.isTouched)}
              </div>
            )}
          </rcaForm.Field>

          <rcaForm.Field
            name='summary'
            validators={{
              onBlur: ({ value }) => {
                const result = rcaSchema.shape.summary.safeParse(value);
                return result.success ? undefined : result.error.issues[0]?.message;
              },
            }}
          >
            {field => (
              <div className='space-y-1.5'>
                <label htmlFor='rca-summary' className='text-sm font-medium text-foreground'>
                  Summary *
                </label>
                <Textarea
                  id='rca-summary'
                  value={field.state.value}
                  onChange={e => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  placeholder='Short RCA overview...'
                  rows={3}
                  readOnly={!isRcaEditable}
                  aria-invalid={field.state.meta.errors.length > 0 && field.state.meta.isTouched}
                  className={cn(
                    field.state.meta.errors.length > 0 &&
                      field.state.meta.isTouched &&
                      'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
                  )}
                />
                {renderFieldError(field.state.meta.errors[0] as string, field.state.meta.isTouched)}
              </div>
            )}
          </rcaForm.Field>

          <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
            <rcaForm.Field
              name='rootCause'
              validators={{
                onBlur: ({ value }) => {
                  const result = rcaSchema.shape.rootCause.safeParse(value);
                  return result.success ? undefined : result.error.issues[0]?.message;
                },
              }}
            >
              {field => (
                <div className='space-y-1.5'>
                  <label htmlFor='rca-root-cause' className='text-sm font-medium text-foreground'>
                    Root Cause *
                  </label>
                  <Textarea
                    id='rca-root-cause'
                    value={field.state.value}
                    onChange={e => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder='Describe the root cause...'
                    rows={4}
                    readOnly={!isRcaEditable}
                    aria-invalid={field.state.meta.errors.length > 0 && field.state.meta.isTouched}
                    className={cn(
                      field.state.meta.errors.length > 0 &&
                        field.state.meta.isTouched &&
                        'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
                    )}
                  />
                  {renderFieldError(
                    field.state.meta.errors[0] as string,
                    field.state.meta.isTouched,
                  )}
                </div>
              )}
            </rcaForm.Field>

            <rcaForm.Field
              name='severity'
              validators={{
                onBlur: ({ value }) => {
                  const result = rcaSchema.shape.severity.safeParse(value);
                  return result.success ? undefined : result.error.issues[0]?.message;
                },
              }}
            >
              {field => (
                <div className='space-y-1.5'>
                  <label htmlFor='rca-severity' className='text-sm font-medium text-foreground'>
                    Severity *
                  </label>
                  <select
                    id='rca-severity'
                    value={field.state.value}
                    onChange={e => field.handleChange(e.target.value as RCAFormValues['severity'])}
                    onBlur={field.handleBlur}
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
                  {renderFieldError(
                    field.state.meta.errors[0] as string,
                    field.state.meta.isTouched,
                  )}
                </div>
              )}
            </rcaForm.Field>
          </div>

          <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
            <rcaForm.Field
              name='bugTypeId'
              validators={{
                onBlur: ({ value }) => {
                  const result = rcaSchema.shape.bugTypeId.safeParse(value);
                  return result.success ? undefined : result.error.issues[0]?.message;
                },
              }}
            >
              {field => {
                const bugTypeValueForSelect = selectedBugTypeId || field.state.value;
                return (
                  <div className='space-y-1.5'>
                    <label htmlFor='rca-bug-type' className='text-sm font-medium text-foreground'>
                      Bug Type *
                    </label>
                    <select
                      id='rca-bug-type'
                      value={bugTypeValueForSelect}
                      onChange={e => {
                        const nextBugTypeId = e.target.value;
                        setSelectedBugTypeId(nextBugTypeId);
                        field.handleChange(nextBugTypeId);
                        const allowedValues = getAllowedCategoryValues(nextBugTypeId);
                        const currentCategoryId = rcaForm.store.state.values.categoryTypeId;
                        const currentCategoryValue =
                          categoryTypeOptions.find(option => option.value === currentCategoryId)
                            ?.label ?? '';
                        if (allowedValues.length === 0) {
                          rcaForm.setFieldValue('categoryTypeId', '');
                          return;
                        }
                        if (
                          currentCategoryId &&
                          (!currentCategoryValue || !allowedValues.includes(currentCategoryValue))
                        ) {
                          rcaForm.setFieldValue('categoryTypeId', '');
                        }
                      }}
                      onBlur={field.handleBlur}
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
                    {renderFieldError(
                      field.state.meta.errors[0] as string,
                      field.state.meta.isTouched,
                    )}
                  </div>
                );
              }}
            </rcaForm.Field>

            <rcaForm.Field
              name='categoryTypeId'
              validators={{
                onBlur: ({ value }) => {
                  const result = rcaSchema.shape.categoryTypeId.safeParse(value);
                  return result.success ? undefined : result.error.issues[0]?.message;
                },
              }}
            >
              {field => {
                if (!currentBugTypeId) {
                  return null;
                }

                if (!bugTypeValue) {
                  return null;
                }

                if (bugTypeValue === 'UI/UX') {
                  return null;
                }

                const filteredCategories = allowedCategoryValues.length
                  ? categoryTypeOptions.filter(option =>
                      allowedCategoryValues.includes(option.label),
                    )
                  : [];

                return (
                  <div className='space-y-1.5'>
                    <label
                      htmlFor='rca-category-type'
                      className='text-sm font-medium text-foreground'
                    >
                      Category Type *
                    </label>
                    <select
                      id='rca-category-type'
                      value={field.state.value}
                      onChange={e => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
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
                    {renderFieldError(
                      field.state.meta.errors[0] as string,
                      field.state.meta.isTouched,
                    )}
                  </div>
                );
              }}
            </rcaForm.Field>
          </div>

          {showIssueCategory && (
            <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
              <rcaForm.Field
                name='issueCategoryId'
                validators={{
                  onBlur: ({ value }) => {
                    if (!showIssueCategory) return undefined;
                    if (!value) return 'Issue category is required';
                    return undefined;
                  },
                }}
              >
                {field => (
                  <div className='space-y-1.5'>
                    <label
                      htmlFor='rca-issue-category'
                      className='text-sm font-medium text-foreground'
                    >
                      Issue Category *
                    </label>
                    <select
                      id='rca-issue-category'
                      value={field.state.value}
                      onChange={e => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
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
                      field.state.meta.errors[0] as string,
                      field.state.meta.isTouched,
                    )}
                  </div>
                )}
              </rcaForm.Field>
            </div>
          )}

          <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
            <rcaForm.Field name='issueStartAt'>
              {field => (
                <div className='space-y-1.5'>
                  <label htmlFor='rca-issue-start' className='text-sm font-medium text-foreground'>
                    Issue Start Time
                  </label>
                  <input
                    id='rca-issue-start'
                    type='datetime-local'
                    value={toDateTimeLocal(field.state.value)}
                    onChange={e => field.handleChange(fromDateTimeLocal(e.target.value))}
                    data-track-category='RCA'
                    data-track-name='RcaIssueStartInput'
                    disabled={!isRcaEditable}
                    className='w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background'
                  />
                </div>
              )}
            </rcaForm.Field>
          </div>

          {/* Footer */}
          <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-border pt-6'>
            <div className='text-xs text-muted-foreground'>
              Created {formatDate(selectedRecord.createdAt)} - Updated{' '}
              {formatDate(selectedRecord.updatedAt)}
            </div>
            <div className='flex flex-wrap gap-2'>
              <Button
                type='button'
                variant='outline'
                onClick={() => void handleSaveDraft()}
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
