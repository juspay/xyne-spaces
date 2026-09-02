import { useEffect, useMemo, useRef, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { useZero } from '../../../hooks/useZero';
import { X, Plus, Trash2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { Button } from '../../../components/ui/Button';
import Textarea from '../../../components/ui/Textarea';
import { Combobox } from '../../../components/ui/Combobox/Combobox';
import { cn } from '../../../utils/classNames';
import { toast } from 'sonner';
import { COEStatus, RCAStatus } from '@xyne/shared';
import { coeSchema } from '../schemas';
import { renderFieldError, ReadOnlyField } from '../RCAScreen.utils.tsx';
import { mutators } from '../../../zero/mutators';
import type { COEFormProps, PendingCOE, SelectOption } from '../RCAScreen.types';
import { MultiSelect } from '../../../components/ui/MultiSelect';
import { usePlatform } from '../../../hooks/usePlatform';

interface ExistingCoeRow {
  id: string;
  ownerId: string;
  actionType: string;
  action: string;
  status: COEStatus;
}

interface CoeFormValues {
  existingCoes: ExistingCoeRow[];
  pendingCOEs: PendingCOE[];
  quickFixes: string[];
}

interface OwnerComboboxProps {
  value: string;
  ownerItems: SelectOption[];
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onChange: (value: string) => void;
  showErrors: boolean;
  errorMessage: string | null;
  inputRef?: React.RefObject<HTMLInputElement | null> | undefined;
}

const OwnerCombobox = ({
  value,
  ownerItems,
  searchQuery,
  setSearchQuery,
  onChange,
  showErrors,
  errorMessage,
  inputRef,
}: OwnerComboboxProps) => {
  const selectedOwner = ownerItems.find(o => o.value === value) ?? null;
  const displayValue = selectedOwner ? selectedOwner.label : searchQuery;

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return ownerItems;
    return ownerItems.filter(o => o.label.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [ownerItems, searchQuery]);

  return (
    <div className='space-y-1.5'>
      <Combobox
        ref={inputRef}
        label='Owner *'
        placeholder='Search and select owner...'
        queryString={displayValue}
        onInputValueChange={val => {
          if (val === '' && selectedOwner) return;
          setSearchQuery(val);
          if (selectedOwner && val !== selectedOwner.label) {
            onChange('');
          }
        }}
        items={filteredItems}
        value={selectedOwner}
        onValueChange={val => {
          onChange(val ?? '');
          setSearchQuery('');
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
  coeActionLabelByValue,
  quickFixOptions,
  quickFixActionValue,
  hiddenCoeActionValues = [],
  coeStatusOptions,
  rcaOwnerId,
  onPhaseChange,
  onSubmit,
  controllerRef,
}: COEFormProps) => {
  if (!selectedRecord) {
    throw new Error('Invalid RCA');
  }

  const zero = useZero();
  const { isMobile } = usePlatform();
  const isLocked = selectedRecord.status === RCAStatus.CLOSED && !isCoeEnabled;
  const [ownerSearchQueries, setOwnerSearchQueries] = useState<Record<string, string>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [deletingCoeId, setDeletingCoeId] = useState<string | null>(null);
  const previousRecordIdRef = useRef<string | null>(null);
  const primaryOwnerRef = useRef<HTMLInputElement>(null);

  const form = useForm<CoeFormValues>({
    defaultValues: {
      existingCoes: [],
      pendingCOEs: [],
      quickFixes: [],
    },
  });
  const { control, getValues, setValue, reset, watch, formState } = form;
  const isDirty = formState.isDirty;

  useEffect(() => {
    if (!isMobile && !isLocked && isCoeEnabled) {
      const rafId = requestAnimationFrame(() => {
        primaryOwnerRef.current?.focus();
      });
      return () => cancelAnimationFrame(rafId);
    }

    return undefined;
  }, [isMobile, isLocked, isCoeEnabled]);

  const {
    fields: existingCoeFields,
    remove: removeExistingCoe,
    update: updateExistingCoe,
  } = useFieldArray({
    control,
    name: 'existingCoes',
  });

  const {
    fields: pendingCoeFields,
    append: appendPendingCoe,
    remove: removePendingCoe,
    replace: replacePendingCoes,
    update: updatePendingCoe,
  } = useFieldArray({
    control,
    name: 'pendingCOEs',
  });

  const existingCoeValues = watch('existingCoes');
  const pendingCoeValues = watch('pendingCOEs');
  const quickFixes = watch('quickFixes') ?? [];

  const updateExistingRow = (index: number, updater: (row: ExistingCoeRow) => ExistingCoeRow) => {
    const current = getValues(`existingCoes.${index}`);
    if (!current) return;
    updateExistingCoe(index, updater(current));
  };

  const updatePendingRow = (index: number, updater: (row: PendingCOE) => PendingCOE) => {
    const current = getValues(`pendingCOEs.${index}`);
    if (!current) return;
    updatePendingCoe(index, updater(current));
  };

  const resolvedQuickFixActionTypeId = useMemo(() => {
    if (quickFixActionValue) return quickFixActionValue;
    return '';
  }, [quickFixActionValue]);

  const quickFixCoe = useMemo(
    () =>
      selectedRecord.coes?.find(coe => coe.actionTypeId === resolvedQuickFixActionTypeId) ?? null,
    [selectedRecord.coes, resolvedQuickFixActionTypeId],
  );

  const excludedActionTypeIds = useMemo(() => {
    return new Set(hiddenCoeActionValues);
  }, [hiddenCoeActionValues]);

  const visibleCoeEntries = useMemo(
    () => (selectedRecord.coes ?? []).filter(coe => !excludedActionTypeIds.has(coe.actionTypeId)),
    [selectedRecord.coes, excludedActionTypeIds],
  );

  const filteredActionTypeOptions = useMemo(
    () => [
      { label: 'Select action type', value: '' },
      ...coeActionTypeOptions.filter(option => !excludedActionTypeIds.has(option.value)),
    ],
    [coeActionTypeOptions, excludedActionTypeIds],
  );

  const getActionTypeLabel = (actionType: string) =>
    coeActionLabelByValue?.get(actionType) ??
    coeActionTypeOptions.find(option => option.value === actionType)?.label ??
    actionType;

  useEffect(() => {
    const isRecordChanged = previousRecordIdRef.current !== selectedRecord.id;
    previousRecordIdRef.current = selectedRecord.id;
    const parseQuickFixes = (action: string | null | undefined): string[] => {
      if (!action) return [];
      const normalized = action
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => part);
      return normalized.length > 0 ? normalized : [];
    };

    const initialExisting: ExistingCoeRow[] = visibleCoeEntries.map(coe => ({
      id: coe.id,
      ownerId: coe.ownerId,
      actionType: coe.actionTypeId,
      action: coe.action,
      status: coe.status,
    }));

    reset({
      existingCoes: initialExisting,
      pendingCOEs: isRecordChanged ? [] : getValues('pendingCOEs'),
      quickFixes: parseQuickFixes(quickFixCoe?.action),
    });
    setOwnerSearchQueries({});
    setShowErrors(false);
  }, [getValues, quickFixCoe?.action, reset, selectedRecord.id, visibleCoeEntries]);

  useEffect(() => {
    if (!isCoeEnabled || isLocked) return;
    if (selectedRecord.status === RCAStatus.CLOSED) return;
    if (visibleCoeEntries.length > 0) return;
    if ((existingCoeValues?.length ?? 0) > 0 || (pendingCoeValues?.length ?? 0) > 0) return;

    const defaultActionTypeId = filteredActionTypeOptions[1]?.value;
    if (!defaultActionTypeId) return;

    appendPendingCoe({
      ownerId: rcaOwnerId || selectedRecord.ownerId,
      actionType: defaultActionTypeId,
      action: '',
      status: COEStatus.OPEN,
    });
  }, [
    appendPendingCoe,
    existingCoeValues?.length,
    filteredActionTypeOptions,
    isCoeEnabled,
    isLocked,
    pendingCoeValues?.length,
    rcaOwnerId,
    selectedRecord.status,
    selectedRecord.ownerId,
    visibleCoeEntries.length,
  ]);

  const validateCoe = (coe: { ownerId: string; actionType: string; action: string }) =>
    coeSchema.safeParse(coe);

  const getErrors = (coe: { ownerId: string; actionType: string; action: string }) => {
    const validation = validateCoe(coe);
    if (validation.success) return {};

    const errors: Partial<Record<'ownerId' | 'actionType' | 'action', string>> = {};
    for (const issue of validation.error.issues) {
      const key = issue.path[0];
      if (key === 'ownerId' || key === 'actionType' || key === 'action') {
        errors[key] = issue.message;
      }
    }
    return errors;
  };

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
    const quickFixAction = quickFixes.filter(Boolean).join(', ');

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
        if (result.type === 'error') throw new Error(result.error.message);
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
        if (result.type === 'error') throw new Error(result.error.message);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save Quick Fixes');
      return false;
    }

    return true;
  };

  const saveExistingCoes = async (): Promise<{ savedCount: number; hasErrors: boolean }> => {
    const existingCoes = getValues('existingCoes');
    let hasErrors = false;
    let savedCount = 0;

    for (const coe of existingCoes) {
      const validation = validateCoe(coe);
      if (!validation.success) {
        hasErrors = true;
        continue;
      }

      try {
        const result = await zero.mutate(
          mutators.coe.update({
            id: coe.id,
            ownerId: coe.ownerId,
            actionTypeId: coe.actionType,
            action: coe.action,
            status: coe.status,
          }),
        ).server;

        if (result.type === 'error') {
          toast.error(result.error.message || `Failed to save COE ${coe.id}`);
          hasErrors = true;
        } else {
          savedCount++;
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Failed to save COE ${coe.id}`);
        hasErrors = true;
      }
    }

    return { savedCount, hasErrors };
  };

  const savePendingCoes = async (): Promise<{ savedCount: number; hasErrors: boolean }> => {
    const currentPending = getValues('pendingCOEs');
    if (currentPending.length === 0) {
      return { savedCount: 0, hasErrors: false };
    }

    const pendingErrors = currentPending.some(coe => !validateCoe(coe).success);
    if (pendingErrors) {
      setShowErrors(true);
      toast.error('Please complete all pending COE details');
      return { savedCount: 0, hasErrors: true };
    }

    const createMutations = currentPending.map(coe =>
      zero.mutate(
        mutators.coe.create({
          id: uuidv4(),
          timestamp: Date.now(),
          rcaId: selectedRecord.id,
          ownerId: coe.ownerId,
          actionTypeId: coe.actionType,
          action: coe.action,
          status: coe.status,
        }),
      ),
    );

    try {
      const createResults = await Promise.all(createMutations.map(m => m.server));
      const failedCreate = createResults.find(r => r.type === 'error');
      if (failedCreate) {
        toast.error(
          failedCreate.type === 'error' ? failedCreate.error.message : 'Failed to create COE',
        );
        return { savedCount: 0, hasErrors: true };
      }

      replacePendingCoes([]);
      return { savedCount: currentPending.length, hasErrors: false };
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save pending COE drafts');
      return { savedCount: 0, hasErrors: true };
    }
  };

  const handleDeleteCoe = async (id: string, index: number) => {
    if (deletingCoeId) return;
    setDeletingCoeId(id);
    try {
      const result = await zero.mutate(mutators.coe.delete({ id })).server;
      if (result.type === 'error') {
        toast.error(result.error.message || 'Failed to delete COE');
        return;
      }
      removeExistingCoe(index);
      setOwnerSearchQueries(prev => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      toast.success('COE deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete COE');
    } finally {
      setDeletingCoeId(null);
    }
  };

  const handleSaveDraft = async (): Promise<boolean> => {
    setShowErrors(true);

    const savedQuickFixes = await upsertQuickFixes();
    if (!savedQuickFixes) return false;

    const existingResult = await saveExistingCoes();
    const pendingResult = await savePendingCoes();
    const hasErrors = existingResult.hasErrors || pendingResult.hasErrors;

    if (hasErrors) {
      toast.error('Some COEs failed to save');
      return false;
    }

    reset({
      existingCoes: getValues('existingCoes'),
      pendingCOEs: getValues('pendingCOEs'),
      quickFixes: getValues('quickFixes'),
    });

    return true;
  };

  if (controllerRef) {
    controllerRef.current = {
      save: handleSaveDraft,
      hasUnsavedChanges: () => isDirty,
    };
  }

  const handleSaveAll = async () => {
    const saved = await handleSaveDraft();
    if (!saved) return;
    await Promise.resolve(onSubmit());
  };

  const renderCoeForm = (
    type: 'existing' | 'pending',
    id: string,
    data: ExistingCoeRow | PendingCOE,
    index: number,
  ) => {
    const isExisting = type === 'existing';
    const actionFieldId = `coe-action-${id}`;
    const actionTypeFieldId = `coe-action-type-${id}`;
    const statusFieldId = `coe-status-${id}`;
    const errors = showErrors ? getErrors(data) : {};
    const isDeleting = isExisting && deletingCoeId === id;
    const queryKey = isExisting ? id : `pending-${index}`;

    return (
      <div key={id} className='space-y-6 pb-8 border-b border-border last:border-b-0 last:pb-0'>
        <div className='flex items-center justify-between'>
          <h4 className='text-sm font-semibold text-foreground'>
            {isExisting ? `COE ${index + 1}` : 'COE'}
          </h4>
          <Button
            type='button'
            size={isExisting ? 'iconSm' : 'sm'}
            variant='ghost'
            className={
              isExisting
                ? 'text-destructive hover:text-destructive hover:bg-destructive/10'
                : 'text-destructive hover:text-destructive'
            }
            onClick={() =>
              isExisting
                ? void handleDeleteCoe(id, index)
                : (() => {
                    removePendingCoe(index);
                    setOwnerSearchQueries(prev => {
                      const next = { ...prev };
                      delete next[`pending-${index}`];
                      return next;
                    });
                  })()
            }
            data-track-category='RCA'
            data-track-name='DELETE_COE'
            loading={isDeleting}
            disabled={isSubmitting || deletingCoeId !== null}
            aria-label={isExisting ? `Delete COE ${index + 1}` : 'Remove COE'}
          >
            {isExisting ? (
              !isDeleting && <Trash2 className='h-3.5 w-3.5' />
            ) : (
              <X className='h-4 w-4' />
            )}
          </Button>
        </div>

        <div className='space-y-4'>
          <OwnerCombobox
            value={data.ownerId}
            ownerItems={ownerItems}
            searchQuery={ownerSearchQueries[queryKey] ?? ''}
            setSearchQuery={query =>
              setOwnerSearchQueries(prev => ({ ...prev, [queryKey]: query }))
            }
            onChange={val => {
              if (isExisting) {
                updateExistingRow(index, row => ({ ...row, ownerId: val }));
                return;
              }
              updatePendingRow(index, row => ({ ...row, ownerId: val }));
            }}
            showErrors={showErrors}
            errorMessage={errors.ownerId ?? null}
            inputRef={index === 0 ? primaryOwnerRef : undefined}
          />

          <div className='space-y-1.5'>
            <label htmlFor={actionTypeFieldId} className='text-sm font-medium text-foreground'>
              Action Type *
            </label>
            <select
              id={actionTypeFieldId}
              value={
                filteredActionTypeOptions.some(opt => opt.value && opt.value === data.actionType)
                  ? data.actionType
                  : ''
              }
              onChange={e => {
                if (isExisting) {
                  updateExistingRow(index, row => ({ ...row, actionType: e.target.value }));
                  return;
                }
                updatePendingRow(index, row => ({ ...row, actionType: e.target.value }));
              }}
              data-track-category='RCA'
              data-track-name='CoeActionTypeSelect'
              className='w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background text-foreground'
            >
              {filteredActionTypeOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {renderFieldError(errors.actionType ?? null, showErrors)}
          </div>

          <div className='space-y-1.5'>
            <label htmlFor={statusFieldId} className='text-sm font-medium text-foreground'>
              Status *
            </label>
            <select
              id={statusFieldId}
              value={data.status}
              onChange={e => {
                if (isExisting) {
                  updateExistingRow(index, row => ({
                    ...row,
                    status: e.target.value as COEStatus,
                  }));
                  return;
                }
                updatePendingRow(index, row => ({
                  ...row,
                  status: e.target.value as COEStatus,
                }));
              }}
              data-track-category='RCA'
              data-track-name='CoeStatusSelect'
              className='w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background text-foreground'
            >
              {coeStatusOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className='space-y-1.5'>
            <label htmlFor={actionFieldId} className='text-sm font-medium text-foreground'>
              Action *
            </label>
            <Textarea
              id={actionFieldId}
              value={data.action}
              onChange={e => {
                if (isExisting) {
                  updateExistingRow(index, row => ({ ...row, action: e.target.value }));
                  return;
                }
                updatePendingRow(index, row => ({ ...row, action: e.target.value }));
              }}
              placeholder='Describe the action to address the RCA...'
              rows={4}
              aria-invalid={showErrors && !data.action.trim()}
              className={cn(
                showErrors &&
                  !data.action.trim() &&
                  'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
              )}
            />
            {renderFieldError(errors.action ?? null, showErrors)}
          </div>
        </div>
      </div>
    );
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
          <Button
            variant='outline'
            size='sm'
            onClick={() => onPhaseChange('impact')}
            data-track-category='RCA'
            data-track-name='GO_TO_IMPACT_PHASE'
          >
            Review Previous Phase
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className='h-full overflow-y-auto'>
      <div className='bg-background shadow-sm border border-border rounded-xl'>
        <div className='px-8 py-6 border-b border-border bg-gradient-to-r from-muted/40 to-background'>
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

        <div className='p-8 space-y-8'>
          {!isLocked && (
            <div className='space-y-6 pb-8'>
              {!resolvedQuickFixActionTypeId && (
                <div className='rounded-lg border border-amber-300/60 bg-amber-100/60 dark:border-amber-500/40 dark:bg-amber-900/30 p-3 text-sm text-amber-900 dark:text-amber-100'>
                  Missing COE action type for Quick Fixes. Add CAC value: `quick_fixes_done`.
                </div>
              )}

              <div className='p-1 space-y-2'>
                <p className='text-sm font-semibold text-foreground'>Quick Fixes Done</p>
                <MultiSelect
                  placeholder='Select quick fixes'
                  options={quickFixOptions}
                  selectedValues={quickFixes}
                  onChange={values => setValue('quickFixes', values, { shouldDirty: true })}
                />
              </div>
            </div>
          )}

          {isLocked
            ? visibleCoeEntries.map((coe, index) => (
                <div
                  key={coe.id}
                  className='space-y-6 pb-8 border-b border-border last:border-b-0 last:pb-0'
                >
                  <h4 className='text-base font-semibold text-foreground'>COE {index + 1}</h4>
                  <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                    <ReadOnlyField
                      label='Owner'
                      value={ownerItems.find(o => o.value === coe.ownerId)?.label ?? coe.ownerId}
                    />
                    <ReadOnlyField
                      label='Action Type'
                      value={getActionTypeLabel(coe.actionTypeId)}
                    />
                  </div>
                  <ReadOnlyField
                    label='Status'
                    value={coeStatusOptions.find(o => o.value === coe.status)?.label ?? coe.status}
                  />
                  <ReadOnlyField label='Action' value={coe.action ?? '-'} />
                </div>
              ))
            : existingCoeFields.map((field, index) =>
                renderCoeForm(
                  'existing',
                  existingCoeValues?.[index]?.id ?? field.id,
                  existingCoeValues?.[index] ?? field,
                  index,
                ),
              )}

          {!isLocked &&
            pendingCoeFields.map((field, index) =>
              renderCoeForm(
                'pending',
                `pending-${index}`,
                pendingCoeValues?.[index] ?? field,
                index,
              ),
            )}

          {!isLocked && (
            <div className='pt-4'>
              <Button
                type='button'
                variant='outline'
                className='gap-1'
                onClick={() => {
                  const defaultActionTypeId = filteredActionTypeOptions[1]?.value;
                  if (!defaultActionTypeId) {
                    toast.error('No COE action types available');
                    return;
                  }
                  appendPendingCoe({
                    ownerId: rcaOwnerId || selectedRecord.ownerId,
                    actionType: defaultActionTypeId,
                    action: '',
                    status: COEStatus.OPEN,
                  });
                }}
                data-track-category='RCA'
                data-track-name='ADD_COE_ACTION'
                disabled={isSubmitting}
              >
                <Plus className='h-3.5 w-3.5' />
                Add Another COE
              </Button>
            </div>
          )}

          {!isLocked && (
            <div className='sticky bottom-0 -mx-8 -mb-8 p-4 bg-background/95 backdrop-blur border-t border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3'>
              <div className='text-xs text-muted-foreground'>
                {(pendingCoeValues?.length ?? 0) > 0
                  ? `${pendingCoeValues?.length ?? 0} pending COE(s)`
                  : (existingCoeValues?.length ?? 0) > 0
                    ? `${existingCoeValues?.length ?? 0} COE(s)`
                    : ''}
              </div>
              <div className='flex flex-wrap gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => onPhaseChange('impact')}
                  data-track-category='RCA'
                  data-track-name='BACK_TO_IMPACT_PHASE'
                  disabled={isSubmitting}
                >
                  Go Back
                </Button>
                <Button
                  type='button'
                  onClick={() => void handleSaveAll()}
                  data-track-category='RCA'
                  data-track-name='SAVE_ALL_COES'
                  loading={isSubmitting}
                  disabled={isSubmitting}
                >
                  Submit
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
