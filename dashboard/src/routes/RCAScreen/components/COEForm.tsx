import { useEffect, useMemo, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useZero } from '../../../hooks/useZero';
import { SingleSelect } from '@juspay/blend-design-system';
import { X, Plus } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { Button } from '../../../components/ui/Button';
import Textarea from '../../../components/ui/Textarea';
import { Combobox } from '../../../components/ui/Combobox/Combobox';
import { MultiSelect } from '../../../components/ui/MultiSelect';
import { cn } from '../../../utils/classNames';
import { toast } from 'sonner';
import { COEStatus, RCAStatus, LookupType } from '@xyne/shared';
import { coeSchema } from '../schemas';
import { formatDate, renderFieldError, ReadOnlyField } from '../RCAScreen.utils.tsx';
import { mutators } from '../../../zero/mutators';
import type { COEFormProps, PendingCOE, SelectOption } from '../RCAScreen.types';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';

interface PendingOwnerComboboxProps {
  index: number;
  pendingCoe: PendingCOE;
  ownerItems: SelectOption[];
  pendingQueries: Record<number, string>;
  setPendingQueries: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  updatePendingCoe: (index: number, field: keyof PendingCOE, value: string | COEStatus) => void;
  showErrors: boolean;
  errorMessage: string | null;
}

const PendingOwnerCombobox = ({
  index,
  pendingCoe,
  ownerItems,
  pendingQueries,
  setPendingQueries,
  updatePendingCoe,
  showErrors,
  errorMessage,
}: PendingOwnerComboboxProps) => {
  const selectedOwner = ownerItems.find(o => o.value === pendingCoe.ownerId) ?? null;
  const searchQuery = pendingQueries[index] ?? '';
  const displayValue = selectedOwner ? selectedOwner.label : searchQuery;

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return ownerItems;
    return ownerItems.filter(o => o.label.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [ownerItems, searchQuery]);

  return (
    <div className='space-y-1.5'>
      <Combobox
        label='Owner *'
        placeholder='Search and select owner...'
        queryString={displayValue}
        onInputValueChange={value => {
          if (value === '' && selectedOwner) return;
          setPendingQueries(prev => ({ ...prev, [index]: value }));
          if (selectedOwner && value !== selectedOwner.label) {
            updatePendingCoe(index, 'ownerId', '');
          }
        }}
        items={filteredItems}
        value={selectedOwner}
        onValueChange={value => {
          updatePendingCoe(index, 'ownerId', value ?? '');
          setPendingQueries(prev => ({ ...prev, [index]: '' }));
        }}
      />
      {renderFieldError(errorMessage, showErrors)}
    </div>
  );
};

export const COEForm = ({
  selectedRecord,
  isCoeEnabled,
  isSubmitting,
  ownerItems,
  coeActionTypeOptions,
  coeActionTypeLabelById,
  coeActionTypeValueById,
  quickFixActionTypeId,
  coeStatusOptions,
  pendingCOEs,
  selectedCoe,
  rcaOwnerId,
  setPendingCOEs,
  onPhaseChange,
  onSubmit,
  pendingRCA,
}: COEFormProps) => {
  if (!selectedRecord) {
    throw new Error('Invalid RCA');
  }
  const zero = useZero();
  const isLocked = selectedRecord.status === RCAStatus.CLOSED;
  const [pendingCoeOwnerQueries, setPendingCoeOwnerQueries] = useState<Record<number, string>>({});
  const [coeOwnerSearchQuery, setCoeOwnerSearchQuery] = useState('');
  const [showPendingErrors, setShowPendingErrors] = useState(false);
  const [showSelectedErrors, setShowSelectedErrors] = useState(false);
  const [quickFixes, setQuickFixes] = useState<string[]>([]);

  const [quickFixLookupValues] = useCachedQuery(
    queries.lookupValuesByType({ type: LookupType.QUICK_FIX_OPTION }),
  );
  const quickFixOptions = useMemo(
    () =>
      (quickFixLookupValues ?? []).map(item => ({
        label: item.value,
        value: item.id,
      })),
    [quickFixLookupValues],
  );

  const quickFixLabelByValue = useMemo(
    () => new Map(quickFixOptions.map(option => [option.value, option.label])),
    [quickFixOptions],
  );
  const quickFixValueByLabel = useMemo(
    () => new Map(quickFixOptions.map(option => [option.label, option.value])),
    [quickFixOptions],
  );

  const resolvedQuickFixActionTypeId = useMemo(() => {
    if (quickFixActionTypeId) return quickFixActionTypeId;
    return (
      Array.from(coeActionTypeValueById.entries()).find(
        ([, value]) => value === 'QUICK_FIXES_DONE',
      )?.[0] ?? ''
    );
  }, [coeActionTypeValueById, quickFixActionTypeId]);

  const quickFixCoe = useMemo(
    () =>
      selectedRecord.coes?.find(coe => coe.actionTypeId === resolvedQuickFixActionTypeId) ?? null,
    [selectedRecord.coes, resolvedQuickFixActionTypeId],
  );
  const excludedActionTypeIds = useMemo(() => {
    const excludedValues = new Set(['QUICK_FIXES_DONE', 'PREVENTION_PRINCIPLE']);
    return new Set(
      Array.from(coeActionTypeValueById.entries())
        .filter(([, value]) => excludedValues.has(value))
        .map(([id]) => id),
    );
  }, [coeActionTypeValueById]);
  const visibleCoeEntries = useMemo(
    () => (selectedRecord.coes ?? []).filter(coe => !excludedActionTypeIds.has(coe.actionTypeId)),
    [selectedRecord.coes, excludedActionTypeIds],
  );

  const filteredCoeOwnerItems: SelectOption[] = coeOwnerSearchQuery.trim()
    ? ownerItems.filter(o => o.label.toLowerCase().includes(coeOwnerSearchQuery.toLowerCase()))
    : ownerItems;
  // Filter action types based on pending RCA changes
  const effectiveActionTypeOptions = useMemo(() => {
    // If no pending changes, use all available options
    if (!pendingRCA?.bugTypeId && !pendingRCA?.categoryTypeId) {
      return coeActionTypeOptions.filter(option => !excludedActionTypeIds.has(option.value));
    }
    // Apply the same filtering logic with pending values
    return coeActionTypeOptions.filter(option => !excludedActionTypeIds.has(option.value));
  }, [
    coeActionTypeOptions,
    excludedActionTypeIds,
    pendingRCA?.bugTypeId,
    pendingRCA?.categoryTypeId,
  ]);

  const filteredActionTypeOptions = useMemo(
    () => [
      { label: 'Select action type', value: '' },
      ...effectiveActionTypeOptions.filter(option => !excludedActionTypeIds.has(option.value)),
    ],
    [effectiveActionTypeOptions, excludedActionTypeIds],
  );
  const getActionTypeLabel = (actionTypeId: string) =>
    coeActionTypeLabelById?.get(actionTypeId) ??
    coeActionTypeOptions.find(option => option.value === actionTypeId)?.label ??
    actionTypeId;

  const coeForm = useForm({
    defaultValues: {
      ownerId: selectedCoe?.ownerId ?? '',
      actionTypeId: selectedCoe?.actionTypeId ?? '',
      action: selectedCoe?.action ?? '',
      status: selectedCoe?.status ?? COEStatus.OPEN,
      dueDate: selectedCoe?.dueDate ?? null,
    },
    onSubmit: async ({ value }) => {
      if (!selectedCoe) return;

      try {
        const mutationResult = zero.mutate(
          mutators.coe.update({
            id: selectedCoe.id,
            ownerId: value.ownerId,
            actionTypeId: value.actionTypeId,
            action: value.action,
            status: value.status,
            dueDate: value.dueDate ?? undefined,
          }),
        );
        const serverResult = await mutationResult.server;
        if (serverResult.type === 'error') {
          toast.error(serverResult.error.message || 'Failed to save COE');
          return;
        }
        toast.success('COE saved');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to save COE');
      }
    },
  });
  const validActionTypeIds = useMemo(
    () => new Set(filteredActionTypeOptions.map(option => option.value)),
    [filteredActionTypeOptions],
  );

  useEffect(() => {
    if (!selectedCoe) return;
    const currentValue = coeForm.state.values.actionTypeId;
    if (currentValue && !validActionTypeIds.has(currentValue)) {
      coeForm.setFieldValue('actionTypeId', '');
    }
  }, [selectedCoe, coeForm, validActionTypeIds]);

  useEffect(() => {
    setPendingCOEs(prev => {
      const hasInvalid = prev.some(
        entry => entry.actionTypeId && !validActionTypeIds.has(entry.actionTypeId),
      );
      if (!hasInvalid) return prev;
      return prev.map(entry =>
        entry.actionTypeId && !validActionTypeIds.has(entry.actionTypeId)
          ? { ...entry, actionTypeId: '' }
          : entry,
      );
    });
  }, [setPendingCOEs, validActionTypeIds]);

  useEffect(() => {
    coeForm.reset({
      ownerId: selectedCoe?.ownerId ?? '',
      actionTypeId: selectedCoe?.actionTypeId ?? '',
      action: selectedCoe?.action ?? '',
      status: selectedCoe?.status ?? COEStatus.OPEN,
      dueDate: selectedCoe?.dueDate ?? null,
    });
    setCoeOwnerSearchQuery('');
    setShowSelectedErrors(false);
  }, [selectedRecord.updatedAt, selectedCoe?.id]);

  useEffect(() => {
    if (pendingCOEs.length === 0) {
      setShowPendingErrors(false);
    }
  }, [pendingCOEs.length]);

  useEffect(() => {
    const parseQuickFixes = (action: string | null | undefined): string[] => {
      if (!action) return [];
      const normalized = action
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => quickFixValueByLabel.get(part) ?? part);
      return normalized.length > 0 ? normalized : [];
    };

    setQuickFixes(parseQuickFixes(quickFixCoe?.action));
  }, [quickFixCoe?.id, quickFixCoe?.action, quickFixValueByLabel]);

  const upsertQuickFixes = async (): Promise<boolean> => {
    if (!resolvedQuickFixActionTypeId) {
      toast.error('Missing COE action type for Quick Fixes.');
      return false;
    }
    if (quickFixes.length === 0) {
      toast.error('Select at least one quick fix (including None).');
      return false;
    }

    const ownerId = rcaOwnerId || selectedRecord.ownerId;
    const quickFixAction =
      quickFixes.length > 0
        ? quickFixes
            .map(value => quickFixLabelByValue.get(value) ?? value)
            .filter(Boolean)
            .join(', ')
        : 'None';

    try {
      if (quickFixCoe) {
        const result = await zero.mutate(
          mutators.coe.update({
            id: quickFixCoe.id,
            ownerId,
            actionTypeId: resolvedQuickFixActionTypeId,
            action: quickFixAction,
            status: COEStatus.OPEN,
          }),
        ).server;
        if (result.type === 'error') {
          throw new Error(result.error.message || 'Failed to save Quick Fixes');
        }
      } else {
        const result = await zero.mutate(
          mutators.coe.create({
            id: uuidv4(),
            timestamp: Date.now(),
            rcaId: selectedRecord.id,
            ownerId,
            actionTypeId: resolvedQuickFixActionTypeId,
            action: quickFixAction,
            status: COEStatus.OPEN,
          }),
        ).server;
        if (result.type === 'error') {
          throw new Error(result.error.message || 'Failed to create Quick Fixes');
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save Quick Fixes');
      return false;
    }

    return true;
  };

  useEffect(() => {
    if (!isCoeEnabled || isLocked) return;
    if (selectedCoe || pendingCOEs.length > 0) return;

    const defaultActionTypeId = filteredActionTypeOptions[1]?.value;
    if (!defaultActionTypeId) return;

    setPendingCOEs([
      {
        ownerId: rcaOwnerId || selectedRecord.ownerId,
        actionTypeId: defaultActionTypeId,
        action: '',
        status: COEStatus.OPEN,
      },
    ]);
  }, [
    isCoeEnabled,
    isLocked,
    selectedCoe,
    pendingCOEs.length,
    coeActionTypeOptions,
    rcaOwnerId,
    selectedRecord.ownerId,
    setPendingCOEs,
  ]);

  const handleAddCoe = (): void => {
    const defaultActionTypeId = filteredActionTypeOptions[1]?.value;
    if (!defaultActionTypeId) {
      toast.error('No COE action types available');
      return;
    }

    setPendingCOEs(prev => [
      ...prev,
      {
        ownerId: rcaOwnerId || selectedRecord.ownerId,
        actionTypeId: defaultActionTypeId,
        action: '',
        status: COEStatus.OPEN,
      },
    ]);
  };

  const handleRemovePendingCoe = (index: number): void => {
    setPendingCOEs(prev => prev.filter((_, i) => i !== index));
    setPendingCoeOwnerQueries(prev => {
      const newQueries = { ...prev };
      delete newQueries[index];
      return newQueries;
    });
  };

  const updatePendingCoe = (
    index: number,
    field: keyof PendingCOE,
    value: string | COEStatus,
  ): void => {
    setPendingCOEs(prev => prev.map((coe, i) => (i === index ? { ...coe, [field]: value } : coe)));
  };

  const getPendingCoeErrors = (
    pendingCoe: PendingCOE,
  ): Partial<Record<keyof PendingCOE, string>> => {
    const validation = coeSchema.safeParse(pendingCoe);
    if (validation.success) return {};

    const errors: Partial<Record<keyof PendingCOE, string>> = {};
    for (const issue of validation.error.issues) {
      const key = issue.path[0];
      if (key === 'ownerId' || key === 'actionTypeId' || key === 'action') {
        errors[key] = issue.message;
      }
    }
    return errors;
  };

  const handleSubmitAllCoes = async (): Promise<void> => {
    setShowPendingErrors(true);

    const saved = await upsertQuickFixes();
    if (!saved) return;

    const hasErrors = pendingCOEs.some(pendingCoe => !coeSchema.safeParse(pendingCoe).success);
    if (hasErrors) {
      toast.error('Please complete all pending COE details');
      return;
    }

    await Promise.resolve(onSubmit());
  };

  const handleSubmitSelectedCoe = async (): Promise<void> => {
    setShowSelectedErrors(true);

    const saved = await upsertQuickFixes();
    if (!saved) return;

    const values = coeForm.store.state.values;
    const validation = coeSchema.safeParse(values);
    if (!validation.success) {
      toast.error(validation.error.issues[0]?.message ?? 'Please fill all required fields');
      return;
    }

    await coeForm.handleSubmit();
    await Promise.resolve(onSubmit());
  };

  if (!isCoeEnabled) {
    return (
      <div className='max-w-4xl mx-auto'>
        <div className='bg-background shadow-sm border border-border rounded-xl overflow-hidden p-8'>
          <div className='flex items-center gap-4 mb-4'>
            <div className='h-12 w-12 rounded-xl bg-muted flex items-center justify-center'>
              <svg
                className='h-6 w-6 text-muted-foreground'
                fill='none'
                viewBox='0 0 24 24'
                stroke='currentColor'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z'
                />
              </svg>
            </div>
            <div>
              <p className='text-lg font-semibold text-foreground'>COE Locked</p>
              <p className='text-sm text-muted-foreground'>
                Submit Impact details to unlock COE phase.
              </p>
            </div>
          </div>
          <Button variant='outline' size='sm' onClick={() => onPhaseChange('impact')}>
            Review Previous Phase
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className='h-full overflow-y-auto'>
      <div className='bg-background shadow-sm border border-border rounded-xl overflow-hidden'>
        {/* Header Section */}
        <div className='px-8 py-6 border-b border-border bg-gradient-to-r from-gray-50 to-white'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-3'>
              <div className='h-10 w-10 rounded-lg bg-purple-600 flex items-center justify-center'>
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
                    d='M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
                  />
                </svg>
              </div>
              <div>
                <h2 className='text-xl font-bold text-foreground'>COE Actions</h2>
                <p className='text-sm text-muted-foreground'>
                  Capture corrective and preventive actions
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Form Section */}
        <div className='p-8 space-y-8'>
          {!isLocked && (
            <div className='space-y-6 pb-8'>
              {!resolvedQuickFixActionTypeId && (
                <div className='rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800'>
                  Missing COE action type for Quick Fixes. Add lookup value: `QUICK_FIXES_DONE`.
                </div>
              )}

              <div className='p-1 space-y-2'>
                <p className='text-sm font-semibold text-foreground'>Quick Fixes Done</p>
                <MultiSelect
                  placeholder='Select quick fixes'
                  options={quickFixOptions}
                  selectedValues={quickFixes}
                  onChange={values => setQuickFixes(values)}
                />
              </div>
            </div>
          )}

          {isLocked
            ? visibleCoeEntries.map((coeEntry, index) => (
                <div
                  key={coeEntry.id}
                  className='space-y-6 pb-8 border-b border-border last:border-b-0 last:pb-0'
                >
                  <h4 className='text-base font-semibold text-foreground'>COE {index + 1}</h4>
                  <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                    <ReadOnlyField
                      label='Owner'
                      value={
                        ownerItems.find(option => option.value === coeEntry.ownerId)?.label ??
                        coeEntry.ownerId
                      }
                    />
                    <ReadOnlyField
                      label='Action Type'
                      value={getActionTypeLabel(coeEntry.actionTypeId)}
                    />
                  </div>
                  <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                    <ReadOnlyField
                      label='Status'
                      value={
                        coeStatusOptions.find(option => option.value === coeEntry.status)?.label ??
                        coeEntry.status
                      }
                    />
                  </div>
                  <ReadOnlyField label='Action' value={coeEntry.action ?? '-'} />
                </div>
              ))
            : selectedCoe && (
                <div className='space-y-6 pb-8 border-b border-border'>
                  <h4 className='text-base font-semibold text-foreground'>COE</h4>

                  <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                    <coeForm.Field
                      name='ownerId'
                      validators={{
                        onBlur: ({ value }) => {
                          const result = coeSchema.shape.ownerId.safeParse(value);
                          return result.success ? undefined : result.error.issues[0]?.message;
                        },
                      }}
                    >
                      {field => {
                        const selectedOwner =
                          ownerItems.find(o => o.value === field.state.value) ?? null;
                        const displayValue = selectedOwner
                          ? selectedOwner.label
                          : coeOwnerSearchQuery;
                        return (
                          <div className='space-y-1.5'>
                            <Combobox
                              label='Owner *'
                              placeholder='Search and select owner...'
                              queryString={displayValue}
                              onInputValueChange={value => {
                                if (value === '' && selectedOwner) {
                                  return;
                                }
                                setCoeOwnerSearchQuery(value);
                                if (selectedOwner && value !== selectedOwner.label) {
                                  field.handleChange('');
                                }
                              }}
                              items={filteredCoeOwnerItems}
                              value={selectedOwner}
                              onValueChange={value => {
                                field.handleChange(value ?? '');
                                setCoeOwnerSearchQuery('');
                              }}
                            />
                            {renderFieldError(
                              (showSelectedErrors && !field.state.value.trim()
                                ? 'Owner ID is required'
                                : (field.state.meta.errors[0] as string)) || null,
                              field.state.meta.isTouched || showSelectedErrors,
                            )}
                          </div>
                        );
                      }}
                    </coeForm.Field>

                    <coeForm.Field
                      name='actionTypeId'
                      validators={{
                        onBlur: ({ value }) => {
                          const result = coeSchema.shape.actionTypeId.safeParse(value);
                          return result.success ? undefined : result.error.issues[0]?.message;
                        },
                      }}
                    >
                      {field => (
                        <div className='space-y-1.5'>
                          <SingleSelect
                            label='Action Type *'
                            placeholder='Select action type'
                            items={[{ items: filteredActionTypeOptions }]}
                            selected={field.state.value}
                            onSelect={selected => field.handleChange(selected)}
                          />
                          {renderFieldError(
                            (showSelectedErrors && !field.state.value.trim()
                              ? 'Action type is required'
                              : (field.state.meta.errors[0] as string)) || null,
                            field.state.meta.isTouched || showSelectedErrors,
                          )}
                        </div>
                      )}
                    </coeForm.Field>
                  </div>

                  <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                    <coeForm.Field
                      name='status'
                      validators={{
                        onBlur: ({ value }) => {
                          const result = coeSchema.shape.status.safeParse(value);
                          return result.success ? undefined : result.error.issues[0]?.message;
                        },
                      }}
                    >
                      {field => (
                        <div className='space-y-1.5'>
                          <SingleSelect
                            label='Status *'
                            placeholder='Select status'
                            items={[{ items: coeStatusOptions }]}
                            selected={field.state.value}
                            onSelect={selected => field.handleChange(selected as COEStatus)}
                          />
                          {renderFieldError(
                            field.state.meta.errors[0] as string,
                            field.state.meta.isTouched || showSelectedErrors,
                          )}
                        </div>
                      )}
                    </coeForm.Field>
                  </div>

                  <coeForm.Field
                    name='action'
                    validators={{
                      onBlur: ({ value }) => {
                        const result = coeSchema.shape.action.safeParse(value);
                        return result.success ? undefined : result.error.issues[0]?.message;
                      },
                    }}
                  >
                    {field => (
                      <div className='space-y-1.5'>
                        <label htmlFor='coe-action' className='text-sm font-medium text-foreground'>
                          Action *
                        </label>
                        <Textarea
                          id='coe-action'
                          value={field.state.value}
                          onChange={e => field.handleChange(e.target.value)}
                          onBlur={field.handleBlur}
                          placeholder='Describe the action to address the RCA...'
                          rows={4}
                          aria-invalid={
                            (field.state.meta.errors.length > 0 && field.state.meta.isTouched) ||
                            (showSelectedErrors && !field.state.value.trim())
                          }
                          className={cn(
                            ((field.state.meta.errors.length > 0 && field.state.meta.isTouched) ||
                              (showSelectedErrors && !field.state.value.trim())) &&
                              'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
                          )}
                        />
                        {renderFieldError(
                          (showSelectedErrors && !field.state.value.trim()
                            ? 'Action is required'
                            : (field.state.meta.errors[0] as string)) || null,
                          field.state.meta.isTouched || showSelectedErrors,
                        )}
                      </div>
                    )}
                  </coeForm.Field>
                </div>
              )}

          {pendingCOEs.map((pendingCoe, index) => (
            <div
              key={index}
              className='space-y-6 pb-8 border-b border-border last:border-b-0 last:pb-0'
            >
              <div className='flex items-center justify-between'>
                <h4 className='text-sm font-semibold text-foreground'>COE</h4>
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  onClick={() => handleRemovePendingCoe(index)}
                  className='text-red-600 hover:text-red-700'
                >
                  <X className='h-4 w-4' />
                </Button>
              </div>

              <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                <PendingOwnerCombobox
                  index={index}
                  pendingCoe={pendingCoe}
                  ownerItems={ownerItems}
                  pendingQueries={pendingCoeOwnerQueries}
                  setPendingQueries={setPendingCoeOwnerQueries}
                  updatePendingCoe={updatePendingCoe}
                  showErrors={showPendingErrors}
                  errorMessage={
                    (showPendingErrors ? getPendingCoeErrors(pendingCoe).ownerId : null) ?? null
                  }
                />

                <div className='space-y-1.5'>
                  <SingleSelect
                    label='Action Type *'
                    placeholder='Select action type'
                    items={[{ items: filteredActionTypeOptions }]}
                    selected={pendingCoe.actionTypeId}
                    onSelect={selected => updatePendingCoe(index, 'actionTypeId', selected)}
                  />
                  {renderFieldError(
                    (showPendingErrors ? getPendingCoeErrors(pendingCoe).actionTypeId : null) ??
                      null,
                    showPendingErrors,
                  )}
                </div>
              </div>

              <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                <div className='space-y-1.5'>
                  <SingleSelect
                    label='Status *'
                    placeholder='Select status'
                    items={[{ items: coeStatusOptions }]}
                    selected={pendingCoe.status}
                    onSelect={selected => updatePendingCoe(index, 'status', selected as COEStatus)}
                  />
                </div>
              </div>

              <div className='space-y-1.5'>
                <label
                  htmlFor={`coe-action-${index}`}
                  className='text-sm font-medium text-foreground'
                >
                  Action *
                </label>
                <Textarea
                  id={`coe-action-${index}`}
                  value={pendingCoe.action}
                  onChange={e => updatePendingCoe(index, 'action', e.target.value)}
                  placeholder='Describe the action to address the RCA...'
                  rows={4}
                  aria-invalid={showPendingErrors && !pendingCoe.action.trim()}
                  className={cn(
                    showPendingErrors &&
                      !pendingCoe.action.trim() &&
                      'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
                  )}
                />
                {renderFieldError(
                  (showPendingErrors ? getPendingCoeErrors(pendingCoe).action : null) ?? null,
                  showPendingErrors,
                )}
              </div>
            </div>
          ))}

          {!isLocked && (
            <div className='pt-4'>
              <Button
                type='button'
                variant='outline'
                className='gap-1'
                onClick={handleAddCoe}
                disabled={isSubmitting}
              >
                <Plus className='h-3.5 w-3.5' />
                Add Another COE
              </Button>
            </div>
          )}

          {!isLocked && (
            /* Sticky Footer */
            <div className='sticky bottom-0 -mx-8 -mb-8 p-4 bg-background/95 backdrop-blur border-t border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3'>
              <div className='text-xs text-muted-foreground'>
                {pendingCOEs.length > 0
                  ? `${pendingCOEs.length} pending COE(s) to submit`
                  : selectedCoe
                    ? `Created ${formatDate(selectedCoe.createdAt)}`
                    : ''}
              </div>
              <div className='flex flex-wrap gap-2'>
                {pendingCOEs.length > 0 ? (
                  <>
                    <Button
                      type='button'
                      variant='outline'
                      onClick={() => onPhaseChange('impact')}
                      disabled={isSubmitting}
                    >
                      Go Back
                    </Button>
                    <Button
                      type='button'
                      onClick={() => void handleSubmitAllCoes()}
                      loading={isSubmitting}
                      disabled={isSubmitting}
                    >
                      Submit
                    </Button>
                  </>
                ) : selectedCoe ? (
                  <>
                    <Button
                      type='button'
                      variant='outline'
                      onClick={() => void coeForm.handleSubmit()}
                      loading={isSubmitting}
                      disabled={isSubmitting}
                    >
                      Save Draft
                    </Button>
                    <Button
                      type='button'
                      onClick={() => void handleSubmitSelectedCoe()}
                      loading={isSubmitting}
                      disabled={isSubmitting}
                    >
                      Submit COE
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
