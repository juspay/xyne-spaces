import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useForm } from '@tanstack/react-form';
import { useZero } from '../../../hooks/useZero';
import { SingleSelect } from '@juspay/blend-design-system';
import { X, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import Textarea from '../../../components/ui/Textarea';
import { cn } from '../../../utils/classNames';
import { toast } from 'sonner';
import { RCAStatus } from '@xyne/shared';
import { impactSchema } from '../schemas';
import { formatDate, renderFieldError, ReadOnlyField } from '../RCAScreen.utils.tsx';
import { mutators } from '../../../zero/mutators';
import type { ImpactFormProps, Phase, PendingImpact } from '../RCAScreen.types';
import { AttachmentPreview } from '../../../components/ui/files/AttachmentPreview';
import type { UploadedFile } from '../../../components/ui/files/Files.types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Get the appropriate error message for a form field.
 * Prioritizes explicit required check over schema validation errors.
 */
const getFieldErrorMessage = (
  value: string,
  schemaErrors: string[],
  showErrors: boolean,
  requiredMessage: string,
): string | null => {
  if (showErrors && !value.trim()) return requiredMessage;
  if (schemaErrors[0]) return schemaErrors[0];
  return null;
};

/**
 * Determine if error styling should be applied to a field.
 */
const hasFieldError = (
  schemaErrors: string[],
  isTouched: boolean,
  showErrors: boolean,
  value: string,
): boolean => {
  return (schemaErrors.length > 0 && isTouched) || (showErrors && !value.trim());
};

export const ImpactForm = ({
  selectedRecord,
  isImpactEnabled,
  isSubmitting,
  impactTypeOptions,
  impactAttachments,
  onAddImpactAttachments,
  onRemoveImpactAttachment,
  pendingImpacts,
  selectedImpact,
  impactDraftById,
  setImpactDraftById,
  draftImpactFilesById,
  setDraftImpactFilesById,
  setPendingImpacts,
  setSelectedImpactId,
  onPhaseChange,
}: ImpactFormProps) => {
  if (!selectedRecord) {
    throw new Error('Invalid RCA');
  }
  const zero = useZero();
  const isLocked = selectedRecord.status === RCAStatus.CLOSED;
  const [deletingImpactId, setDeletingImpactId] = useState<string | null>(null);
  const [showPendingErrors, setShowPendingErrors] = useState(false);
  const [showSelectedErrors, setShowSelectedErrors] = useState(false);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileInputsRef = useRef<Record<string, HTMLInputElement | null>>({});

  const impactUploadedFiles = useMemo<UploadedFile[]>(
    () =>
      (impactAttachments ?? []).map(attachment => ({
        id: attachment.id,
        originalName: attachment.originalFilename,
        fileName: attachment.originalFilename,
        fileSize: attachment.size,
        mimeType: attachment.mimetype,
        fileUrl: attachment.url,
        ...(attachment.thumbnailUrl ? { thumbnailUrl: attachment.thumbnailUrl } : {}),
        metadata: (attachment.metadata as Record<string, unknown>) ?? {},
      })),
    [impactAttachments],
  );

  const createPendingImpact = useCallback(
    (): PendingImpact => ({
      tempId: uuidv4(),
      impactTypeId: impactTypeOptions[0]?.value ?? '',
      impact: '',
      files: [],
    }),
    [impactTypeOptions],
  );

  const impactForm = useForm({
    defaultValues: {
      ticketId: selectedRecord.ticketId,
      impactTypeId: selectedImpact?.impactTypeId ?? '',
      impact: selectedImpact?.impact ?? '',
    },
    onSubmit: async ({ value }) => {
      if (!selectedImpact) return;

      try {
        const mutationResult = zero.mutate(
          mutators.impact.update({
            id: selectedImpact.id,
            impactTypeId: value.impactTypeId,
            impact: value.impact,
          }),
        );
        const serverResult = await mutationResult.server;
        if (serverResult.type === 'error') {
          toast.error(serverResult.error.message || 'Failed to save Impact');
          return;
        }
        toast.success('Impact saved');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to save Impact');
      }
    },
  });

  useEffect(() => {
    impactForm.reset({
      ticketId: selectedRecord.ticketId,
      impactTypeId: selectedImpact
        ? (impactDraftById[selectedImpact.id]?.impactTypeId ?? selectedImpact.impactTypeId ?? '')
        : '',
      impact: selectedImpact
        ? (impactDraftById[selectedImpact.id]?.impact ?? selectedImpact.impact ?? '')
        : '',
    });
    setShowSelectedErrors(false);
  }, [selectedRecord.ticketId, selectedRecord.updatedAt, selectedImpact?.id]);

  useEffect(() => {
    if (pendingImpacts.length === 0) {
      setShowPendingErrors(false);
    }
  }, [pendingImpacts.length]);

  useEffect(() => {
    if (!isImpactEnabled || isLocked) return;
    if (selectedImpact || pendingImpacts.length > 0) return;

    setPendingImpacts([createPendingImpact()]);
  }, [isImpactEnabled, isLocked, selectedImpact, pendingImpacts.length, createPendingImpact]);

  useEffect(() => {
    if (!selectedImpact) return;
    setImpactDraftById(prev => {
      if (prev[selectedImpact.id]) return prev;
      return {
        ...prev,
        [selectedImpact.id]: {
          impactTypeId: selectedImpact.impactTypeId ?? '',
          impact: selectedImpact.impact ?? '',
        },
      };
    });
  }, [selectedImpact, setImpactDraftById]);

  const handleAddImpact = (): void => {
    // Clear selected impact so all existing impacts go to view mode
    setSelectedImpactId(null);
    setPendingImpacts(prev => [...prev, createPendingImpact()]);
  };

  const handleRemovePendingImpact = (tempId: string): void => {
    setPendingImpacts(prev => prev.filter(impact => impact.tempId !== tempId));
    if (pendingFileInputsRef.current[tempId]) {
      delete pendingFileInputsRef.current[tempId];
    }
  };

  const updatePendingImpact = (tempId: string, field: keyof PendingImpact, value: string): void => {
    setPendingImpacts(prev =>
      prev.map(impact => (impact.tempId === tempId ? { ...impact, [field]: value } : impact)),
    );
  };

  const updateSelectedImpactDraft = useCallback(
    (partial: Partial<Pick<PendingImpact, 'impactTypeId' | 'impact'>>): void => {
      if (!selectedImpact) return;
      setImpactDraftById(prev => {
        const existing = prev[selectedImpact.id] ?? {
          impactTypeId: selectedImpact.impactTypeId ?? '',
          impact: selectedImpact.impact ?? '',
        };
        return {
          ...prev,
          [selectedImpact.id]: {
            impactTypeId: partial.impactTypeId ?? existing.impactTypeId,
            impact: partial.impact ?? existing.impact,
          },
        };
      });
    },
    [selectedImpact, setImpactDraftById],
  );

  const validatePendingImpact = (pendingImpact: PendingImpact) => {
    return impactSchema.safeParse({
      ticketId: selectedRecord.ticketId,
      impactTypeId: pendingImpact.impactTypeId,
      impact: pendingImpact.impact,
    });
  };

  const getPendingImpactErrors = (
    pendingImpact: PendingImpact,
  ): Partial<Record<keyof PendingImpact, string>> => {
    const validation = validatePendingImpact(pendingImpact);
    if (validation.success) return {};

    const errors: Partial<Record<keyof PendingImpact, string>> = {};
    for (const issue of validation.error.issues) {
      const key = issue.path[0];
      if (key === 'impactTypeId' || key === 'impact') {
        errors[key] = issue.message;
      }
    }
    return errors;
  };

  const handleGoBackToRca = (): void => {
    onPhaseChange('rca' as Phase);
  };

  const handleSubmitAllImpacts = (): void => {
    onPhaseChange('coe' as Phase);
  };

  const uploadDraftAttachmentsForImpact = async (impactId: string): Promise<boolean> => {
    const draftFiles = draftImpactFilesById[impactId] ?? [];
    if (draftFiles.length === 0) return true;
    setIsUploadingAttachments(true);
    try {
      await onAddImpactAttachments(draftFiles, impactId);
      setDraftImpactFilesById(prev => ({ ...prev, [impactId]: [] }));
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload attachments');
      return false;
    } finally {
      setIsUploadingAttachments(false);
    }
  };

  const handleSaveDraft = async (): Promise<void> => {
    if (!selectedImpact) return;
    await impactForm.handleSubmit();
    await uploadDraftAttachmentsForImpact(selectedImpact.id);
  };

  const handleNextToCoe = (): void => {
    onPhaseChange('coe' as Phase);
  };

  const handleDeleteImpact = async (impactId: string): Promise<void> => {
    if (deletingImpactId) return;

    setDeletingImpactId(impactId);
    try {
      const mutationResult = zero.mutate(mutators.impact.delete({ id: impactId }));
      const serverResult = await mutationResult.server;
      if (serverResult.type === 'error') {
        toast.error(serverResult.error.message || 'Failed to delete Impact');
        return;
      }

      if (selectedImpact?.id === impactId) {
        setSelectedImpactId(null);
      }
      toast.success('Impact deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete Impact');
    } finally {
      setDeletingImpactId(null);
    }
  };

  const handleAttachmentChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    if (!selectedImpact) {
      toast.error('Select an impact first.');
      return;
    }
    setDraftImpactFilesById(prev => ({
      ...prev,
      [selectedImpact.id]: [...(prev[selectedImpact.id] ?? []), ...files],
    }));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePendingAttachmentChange = (
    tempId: string,
    event: ChangeEvent<HTMLInputElement>,
  ): void => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;

    setPendingImpacts(prev =>
      prev.map(impact =>
        impact.tempId === tempId
          ? { ...impact, files: [...(impact.files ?? []), ...files] }
          : impact,
      ),
    );
    event.target.value = '';
  };

  const removeDraftImpactFile = (impactId: string, index: number): void => {
    setDraftImpactFilesById(prev => ({
      ...prev,
      [impactId]: (prev[impactId] ?? []).filter((_, i) => i !== index),
    }));
  };

  const removeDraftPendingFile = (tempId: string, index: number): void => {
    setPendingImpacts(prev =>
      prev.map(impact =>
        impact.tempId === tempId
          ? { ...impact, files: impact.files.filter((_, i) => i !== index) }
          : impact,
      ),
    );
  };

  if (!isImpactEnabled) {
    return (
      <div className='max-w-4xl mx-auto'>
        <div className='bg-white shadow-sm border border-gray-200 rounded-xl overflow-hidden p-8'>
          <div className='flex items-center gap-4 mb-4'>
            <div className='h-12 w-12 rounded-xl bg-gray-100 flex items-center justify-center'>
              <svg
                className='h-6 w-6 text-gray-500'
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
              <p className='text-lg font-semibold text-gray-900'>Impact Locked</p>
              <p className='text-sm text-gray-500'>Submit RCA details to unlock Impact phase.</p>
            </div>
          </div>
          <Button variant='outline' size='sm' onClick={() => onPhaseChange('rca' as Phase)}>
            Review Previous Phase
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className='h-full overflow-y-auto'>
      <div className='bg-white shadow-sm border border-gray-200 rounded-xl overflow-hidden'>
        {/* Header Section */}
        <div className='px-8 py-6 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-3'>
              <div className='h-10 w-10 rounded-lg bg-orange-600 flex items-center justify-center'>
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
                    d='M13 10V3L4 14h7v7l9-11h-7z'
                  />
                </svg>
              </div>
              <div>
                <h2 className='text-xl font-bold text-gray-900'>Impact Details</h2>
                <p className='text-sm text-gray-500'>Capture business and customer impact</p>
              </div>
            </div>
          </div>
        </div>

        {/* Form Section */}
        <div className='p-8 space-y-8'>
          {isLocked
            ? selectedRecord.impacts?.map((impactEntry, index) => (
                <div
                  key={impactEntry.id}
                  className='space-y-6 pb-8 border-b border-gray-200 last:border-b-0 last:pb-0'
                >
                  <h4 className='text-sm font-semibold text-gray-900'>Impact {index + 1}</h4>
                  <ReadOnlyField
                    label='Impact Type'
                    value={
                      impactTypeOptions.find(option => option.value === impactEntry.impactTypeId)
                        ?.label ?? impactEntry.impactTypeId
                    }
                  />
                  <ReadOnlyField label='Impact Summary' value={impactEntry.impact ?? '-'} />
                </div>
              ))
            : (selectedRecord.impacts?.length ?? 0) > 0 && (
                <div className='space-y-4 pb-8 border-b border-gray-200'>
                  <div className='flex items-center justify-between gap-3'>
                    <h4 className='text-sm font-semibold text-gray-900'>Existing Impacts</h4>
                    <p className='text-xs text-gray-500'>
                      {selectedRecord.impacts?.length ?? 0} total
                    </p>
                  </div>

                  <div className='space-y-4'>
                    {(selectedRecord.impacts ?? []).map((impactEntry, index) => {
                      const isActive = selectedImpact?.id === impactEntry.id;
                      const isDeletingThis = deletingImpactId === impactEntry.id;
                      const impactTypeLabel =
                        impactTypeOptions.find(option => option.value === impactEntry.impactTypeId)
                          ?.label ?? impactEntry.impactTypeId;

                      return (
                        <div
                          key={impactEntry.id}
                          className={cn(
                            'rounded-lg border p-4',
                            isActive ? 'border-gray-300 bg-gray-50' : 'border-gray-200 bg-white',
                          )}
                        >
                          <div className='flex items-center justify-between gap-3'>
                            <div className='min-w-0'>
                              <p className='text-xs font-semibold text-gray-500 uppercase tracking-wide'>
                                Impact {index + 1}
                              </p>
                              <p className='text-sm font-semibold text-gray-900 truncate'>
                                {impactTypeLabel}
                              </p>
                            </div>
                            <div className='flex items-center gap-2'>
                              {!isActive && (
                                <Button
                                  type='button'
                                  size='sm'
                                  variant='outline'
                                  onClick={() => setSelectedImpactId(impactEntry.id)}
                                  disabled={isSubmitting || deletingImpactId !== null}
                                >
                                  Edit
                                </Button>
                              )}
                              <Button
                                type='button'
                                size='iconSm'
                                variant='ghost'
                                className='text-red-600 hover:text-red-700 hover:bg-red-50'
                                onClick={() => void handleDeleteImpact(impactEntry.id)}
                                loading={isDeletingThis}
                                disabled={isSubmitting || deletingImpactId !== null}
                                aria-label={`Delete impact ${index + 1}`}
                              >
                                {!isDeletingThis && <Trash2 className='h-3.5 w-3.5' />}
                              </Button>
                            </div>
                          </div>

                          <div className='mt-4'>
                            {isActive ? (
                              <div className='space-y-6'>
                                <impactForm.Field
                                  name='impactTypeId'
                                  validators={{
                                    onBlur: ({ value }) => {
                                      const result =
                                        impactSchema.shape.impactTypeId.safeParse(value);
                                      return result.success
                                        ? undefined
                                        : result.error.issues[0]?.message;
                                    },
                                  }}
                                >
                                  {field => (
                                    <div className='space-y-1.5'>
                                      <SingleSelect
                                        label='Impact Type *'
                                        placeholder='Select impact type'
                                        items={[{ items: impactTypeOptions }]}
                                        selected={field.state.value}
                                        onSelect={selected => {
                                          field.handleChange(selected);
                                          updateSelectedImpactDraft({ impactTypeId: selected });
                                        }}
                                      />
                                      {renderFieldError(
                                        getFieldErrorMessage(
                                          field.state.value,
                                          field.state.meta.errors as string[],
                                          showSelectedErrors,
                                          'Impact type is required',
                                        ),
                                        field.state.meta.isTouched || showSelectedErrors,
                                      )}
                                    </div>
                                  )}
                                </impactForm.Field>

                                <impactForm.Field
                                  name='impact'
                                  validators={{
                                    onBlur: ({ value }) => {
                                      const result = impactSchema.shape.impact.safeParse(value);
                                      return result.success
                                        ? undefined
                                        : result.error.issues[0]?.message;
                                    },
                                  }}
                                >
                                  {field => (
                                    <div className='space-y-1.5'>
                                      <label
                                        htmlFor='impact-summary'
                                        className='text-sm font-medium text-gray-700'
                                      >
                                        Impact Summary *
                                      </label>
                                      <Textarea
                                        id='impact-summary'
                                        value={field.state.value}
                                        onChange={e => {
                                          const nextValue = e.target.value;
                                          field.handleChange(nextValue);
                                          updateSelectedImpactDraft({ impact: nextValue });
                                        }}
                                        onBlur={field.handleBlur}
                                        placeholder='Describe the impact...'
                                        rows={4}
                                        aria-invalid={hasFieldError(
                                          field.state.meta.errors as string[],
                                          field.state.meta.isTouched,
                                          showSelectedErrors,
                                          field.state.value,
                                        )}
                                        className={cn(
                                          hasFieldError(
                                            field.state.meta.errors as string[],
                                            field.state.meta.isTouched,
                                            showSelectedErrors,
                                            field.state.value,
                                          ) &&
                                            'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
                                        )}
                                      />
                                      {renderFieldError(
                                        getFieldErrorMessage(
                                          field.state.value,
                                          field.state.meta.errors as string[],
                                          showSelectedErrors,
                                          'Impact summary is required',
                                        ),
                                        field.state.meta.isTouched || showSelectedErrors,
                                      )}
                                    </div>
                                  )}
                                </impactForm.Field>

                                <div className='pt-4 border-t border-gray-200'>
                                  <div className='flex items-center justify-between gap-3'>
                                    <div>
                                      <h4 className='text-sm font-semibold text-gray-900'>
                                        Attachments
                                      </h4>
                                      <p className='text-xs text-gray-500'>
                                        Upload supporting graphs or files for this impact.
                                      </p>
                                      <p className='text-xs text-gray-400'>
                                        Files upload when you click Save Draft or submit COE.
                                      </p>
                                    </div>
                                    <div>
                                      <input
                                        ref={fileInputRef}
                                        type='file'
                                        multiple
                                        className='hidden'
                                        onChange={handleAttachmentChange}
                                        disabled={isUploadingAttachments}
                                      />
                                      <Button
                                        type='button'
                                        size='sm'
                                        variant='outline'
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={isUploadingAttachments}
                                      >
                                        Upload files
                                      </Button>
                                    </div>
                                  </div>

                                  {(impactUploadedFiles.length > 0 ||
                                    (selectedImpact &&
                                      (draftImpactFilesById[selectedImpact.id] ?? []).length >
                                        0)) && (
                                    <div className='mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'>
                                      {impactUploadedFiles.map(file => (
                                        <AttachmentPreview
                                          key={file.id}
                                          file={file}
                                          onRemove={() => void onRemoveImpactAttachment(file.id)}
                                        />
                                      ))}
                                      {(selectedImpact
                                        ? (draftImpactFilesById[selectedImpact.id] ?? [])
                                        : []
                                      ).map((file, index) => (
                                        <AttachmentPreview
                                          key={`${file.name}-${file.size}-${index}`}
                                          file={file}
                                          onRemove={() => {
                                            if (selectedImpact) {
                                              removeDraftImpactFile(selectedImpact.id, index);
                                            }
                                          }}
                                          isUploading={isUploadingAttachments}
                                        />
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className='text-sm text-gray-600 whitespace-pre-wrap break-words'>
                                {impactEntry.impact?.trim() || '-'}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

          {pendingImpacts.map(pendingImpact => (
            <div
              key={pendingImpact.tempId}
              className='space-y-6 pb-8 border-b border-gray-200 last:border-b-0 last:pb-0'
            >
              <div className='flex items-center justify-between'>
                <h4 className='text-sm font-semibold text-gray-900'>Impact</h4>
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  onClick={() => handleRemovePendingImpact(pendingImpact.tempId)}
                  className='text-red-600 hover:text-red-700'
                >
                  <X className='h-4 w-4' />
                </Button>
              </div>

              <div className='space-y-1.5'>
                <SingleSelect
                  label='Impact Type *'
                  placeholder='Select impact type'
                  items={[{ items: impactTypeOptions }]}
                  selected={pendingImpact.impactTypeId}
                  onSelect={selected =>
                    updatePendingImpact(pendingImpact.tempId, 'impactTypeId', selected)
                  }
                />
                {renderFieldError(
                  getPendingImpactErrors(pendingImpact).impactTypeId ?? null,
                  showPendingErrors,
                )}
              </div>

              <div className='space-y-1.5'>
                <label
                  htmlFor={`impact-summary-${pendingImpact.tempId}`}
                  className='text-sm font-medium text-gray-700'
                >
                  Impact Summary *
                </label>
                <Textarea
                  id={`impact-summary-${pendingImpact.tempId}`}
                  value={pendingImpact.impact}
                  onChange={e =>
                    updatePendingImpact(pendingImpact.tempId, 'impact', e.target.value)
                  }
                  placeholder='Describe the impact...'
                  rows={4}
                  aria-invalid={showPendingErrors && !pendingImpact.impact.trim()}
                  className={cn(
                    showPendingErrors &&
                      !pendingImpact.impact.trim() &&
                      'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
                  )}
                />
                {renderFieldError(
                  getPendingImpactErrors(pendingImpact).impact ?? null,
                  showPendingErrors,
                )}
              </div>

              <div className='pt-2'>
                <div className='flex items-center justify-between gap-3'>
                  <div>
                    <h4 className='text-sm font-semibold text-gray-900'>Attachments</h4>
                    <p className='text-xs text-gray-500'>
                      Upload supporting graphs or files for this impact.
                    </p>
                    <p className='text-xs text-gray-400'>
                      Files upload when you click Save Draft or submit COE.
                    </p>
                  </div>
                  <div>
                    <input
                      ref={el => {
                        pendingFileInputsRef.current[pendingImpact.tempId] = el;
                      }}
                      type='file'
                      multiple
                      className='hidden'
                      onChange={event =>
                        void handlePendingAttachmentChange(pendingImpact.tempId, event)
                      }
                      disabled={isUploadingAttachments}
                    />
                    <Button
                      type='button'
                      size='sm'
                      variant='outline'
                      onClick={() => pendingFileInputsRef.current[pendingImpact.tempId]?.click()}
                      disabled={isUploadingAttachments}
                    >
                      Upload files
                    </Button>
                  </div>
                </div>
                {(pendingImpact.files ?? []).length > 0 && (
                  <div className='mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'>
                    {(pendingImpact.files ?? []).map((file, index) => (
                      <AttachmentPreview
                        key={`${file.name}-${file.size}-${index}`}
                        file={file}
                        onRemove={() => removeDraftPendingFile(pendingImpact.tempId, index)}
                        isUploading={isUploadingAttachments}
                      />
                    ))}
                  </div>
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
                onClick={handleAddImpact}
                disabled={isSubmitting}
              >
                <Plus className='h-3.5 w-3.5' />
                Add Another Impact
              </Button>
            </div>
          )}

          {!isLocked && (
            <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-gray-200 pt-4'>
              <div className='text-xs text-gray-500'>
                {pendingImpacts.length > 0
                  ? `${pendingImpacts.length} pending impact(s) to submit`
                  : selectedImpact
                    ? `Logged ${formatDate(selectedImpact.createdAt)}`
                    : ''}
              </div>
              {/* Footer */}
              <div className='flex flex-wrap gap-2 justify-end border-t border-gray-200 pt-6'>
                {pendingImpacts.length > 0 ? (
                  <>
                    <Button
                      type='button'
                      variant='outline'
                      onClick={handleGoBackToRca}
                      disabled={isSubmitting}
                    >
                      Go Back
                    </Button>
                    <Button
                      type='button'
                      onClick={() => void handleSubmitAllImpacts()}
                      loading={isSubmitting}
                      disabled={isSubmitting}
                    >
                      Next
                    </Button>
                  </>
                ) : selectedImpact ? (
                  <>
                    <Button
                      type='button'
                      variant='outline'
                      onClick={() => void handleSaveDraft()}
                      loading={isSubmitting}
                      disabled={isSubmitting}
                    >
                      Save Draft
                    </Button>
                    <Button
                      type='button'
                      onClick={() => void handleNextToCoe()}
                      loading={isSubmitting}
                      disabled={isSubmitting}
                    >
                      Next
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
