import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { useZero } from '../../../hooks/useZero';
import { X, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import Textarea from '../../../components/ui/Textarea';
import { cn } from '../../../utils/classNames';
import { toast } from 'sonner';
import { RCAStatus } from '@xyne/shared';
import { impactSchema } from '../schemas';
import { renderFieldError, ReadOnlyField } from '../RCAScreen.utils.tsx';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import type { ImpactFormProps, PendingImpact, ImpactAttachment } from '../RCAScreen.types';
import { AttachmentPreview } from '../../../components/ui/files/AttachmentPreview';
import { MediaViewer } from '../../../components/ui/files';
import type { UploadedFile } from '../../../components/ui/files/Files.types';
import { fetchFile } from '../../../services/clients/fileFetchService';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { v4 as uuidv4 } from 'uuid';
import { apiInstance } from '../../../services/clients/apiClient';
import { usePlatform } from '../../../hooks/usePlatform';

interface ExistingImpactRow {
  id: string;
  impactType: string;
  impact: string;
  files: File[];
}

interface ImpactFormValues {
  existingImpacts: ExistingImpactRow[];
  pendingImpacts: PendingImpact[];
}

const toUploadedFile = (attachment: ImpactAttachment): UploadedFile => ({
  id: attachment.id,
  originalName: attachment.originalFilename,
  fileName: attachment.originalFilename,
  fileSize: attachment.size,
  mimeType: attachment.mimetype,
  fileUrl: attachment.url,
  ...(attachment.thumbnailUrl ? { thumbnailUrl: attachment.thumbnailUrl } : {}),
  metadata: (attachment.metadata as Record<string, unknown>) ?? {},
});

const ImpactAttachments = ({
  impactId,
  draftFiles,
  isUploading,
  onAddFiles,
  onRemoveDraft,
  onRemoveUploaded,
  onPreview,
}: {
  impactId: string;
  draftFiles: File[];
  isUploading: boolean;
  onAddFiles: (files: File[]) => void;
  onRemoveDraft: (index: number) => void;
  onRemoveUploaded: (attachmentId: string) => void;
  onPreview: (file: File | UploadedFile) => void;
}) => {
  const [attachmentsData] = useCachedQuery(queries.attachmentsByImpact({ impactId }), {
    enabled: !!impactId,
  });

  const uploadedFiles = useMemo<UploadedFile[]>(
    () => (attachmentsData ?? []).map(toUploadedFile),
    [attachmentsData],
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    onAddFiles(files);
    e.target.value = '';
  };

  return (
    <div className='pt-4 border-t border-border'>
      <div className='flex items-center justify-between gap-3'>
        <div>
          <h4 className='text-sm font-semibold text-foreground'>Attachments</h4>
          <p className='text-xs text-muted-foreground'>Upload supporting graphs or files.</p>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type='file'
            multiple
            className='hidden'
            onChange={handleFileChange}
            disabled={isUploading}
          />
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={() => fileInputRef.current?.click()}
            data-track-category='RCA'
            data-track-name='UPLOAD_IMPACT_ATTACHMENT'
            disabled={isUploading}
          >
            Upload files
          </Button>
        </div>
      </div>

      {(uploadedFiles.length > 0 || draftFiles.length > 0) && (
        <div className='mt-3 flex flex-wrap items-start gap-2'>
          {uploadedFiles.map(file => (
            <AttachmentPreview
              key={file.id}
              file={file}
              onRemove={() => onRemoveUploaded(file.id)}
              onPreview={() => onPreview(file)}
            />
          ))}
          {draftFiles.map((file, idx) => (
            <AttachmentPreview
              key={`${file.name}-${file.size}-${idx}`}
              file={file}
              onRemove={() => onRemoveDraft(idx)}
              onPreview={() => onPreview(file)}
              isUploading={isUploading}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const ImpactForm = ({
  selectedRecord,
  isImpactEnabled,
  isSubmitting,
  impactTypeOptions,
  onPhaseChange,
  controllerRef,
}: ImpactFormProps) => {
  if (!selectedRecord) {
    throw new Error('Invalid RCA');
  }

  const zero = useZero();
  const isLocked =
    selectedRecord.status !== RCAStatus.DRAFT && selectedRecord.status !== RCAStatus.CLOSED;
  const [deletingImpactId, setDeletingImpactId] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const pendingFileInputsRef = useRef<Record<string, HTMLInputElement | null>>({});
  const previousRecordIdRef = useRef<string | null>(null);
  const primaryImpactRef = useRef<HTMLTextAreaElement>(null);
  const { isMobile } = usePlatform();

  const form = useForm<ImpactFormValues>({
    defaultValues: {
      existingImpacts: [],
      pendingImpacts: [],
    },
  });
  const { control, getValues, reset, watch, formState } = form;
  const isDirty = formState.isDirty;

  const {
    fields: existingImpactFields,
    remove: removeExistingImpact,
    update: updateExistingImpact,
  } = useFieldArray({
    control,
    name: 'existingImpacts',
  });

  const {
    fields: pendingImpactFields,
    append: appendPendingImpact,
    replace: replacePendingImpacts,
    remove: removePendingImpact,
    update: updatePendingImpact,
  } = useFieldArray({
    control,
    name: 'pendingImpacts',
  });

  const existingImpactValues = watch('existingImpacts');
  const pendingImpactValues = watch('pendingImpacts');
  const hasAnyImpactRows =
    (existingImpactValues?.length ?? 0) > 0 || (pendingImpactValues?.length ?? 0) > 0;

  useEffect(() => {
    if (!isMobile && isImpactEnabled && !isLocked && hasAnyImpactRows) {
      const rafId = requestAnimationFrame(() => {
        primaryImpactRef.current?.focus();
      });
      return () => cancelAnimationFrame(rafId);
    }
    return;
  }, [isMobile, isImpactEnabled, isLocked, hasAnyImpactRows]);

  const updateExistingRow = (
    index: number,
    updater: (row: ExistingImpactRow) => ExistingImpactRow,
  ) => {
    const current = getValues(`existingImpacts.${index}`);
    if (!current) return;
    updateExistingImpact(index, updater(current));
  };

  const updatePendingRow = (index: number, updater: (row: PendingImpact) => PendingImpact) => {
    const current = getValues(`pendingImpacts.${index}`);
    if (!current) return;
    updatePendingImpact(index, updater(current));
  };

  useEffect(() => {
    const isRecordChanged = previousRecordIdRef.current !== selectedRecord.id;
    previousRecordIdRef.current = selectedRecord.id;
    const initialExisting: ExistingImpactRow[] = (selectedRecord.impacts ?? []).map(impact => ({
      id: impact.id,
      impactType: impact.impactTypeId ?? '',
      impact: impact.impact ?? '',
      files: [],
    }));

    reset({
      existingImpacts: initialExisting,
      pendingImpacts: isRecordChanged ? [] : getValues('pendingImpacts'),
    });
    setShowErrors(false);
  }, [getValues, reset, selectedRecord.id, selectedRecord.impacts]);

  useEffect(() => {
    if (!isImpactEnabled || isLocked) return;
    if ((pendingImpactValues?.length ?? 0) > 0 || (selectedRecord.impacts?.length ?? 0) > 0) {
      return;
    }

    const defaultImpactTypeId = impactTypeOptions[0]?.value;
    if (!defaultImpactTypeId) return;

    appendPendingImpact({
      tempId: uuidv4(),
      impactType: defaultImpactTypeId,
      impact: '',
      files: [],
    });
  }, [
    appendPendingImpact,
    impactTypeOptions,
    isImpactEnabled,
    isLocked,
    pendingImpactValues?.length,
    selectedRecord.impacts?.length,
  ]);

  const validateImpact = (impact: { impactType: string; impact: string }) =>
    impactSchema.safeParse({
      ticketId: selectedRecord.ticketId,
      impactType: impact.impactType,
      impact: impact.impact,
    });

  const getErrors = (impact: { impactType: string; impact: string }) => {
    const validation = validateImpact(impact);
    if (validation.success) return {};

    const errors: Partial<Record<'impactType' | 'impact', string>> = {};
    for (const issue of validation.error.issues) {
      const key = issue.path[0];
      if (key === 'impactType' || key === 'impact') {
        errors[key] = issue.message;
      }
    }
    return errors;
  };

  const uploadAttachments = async (files: File[], impactId: string): Promise<void> => {
    if (files.length === 0) return;
    setIsUploadingAttachments(true);
    try {
      const formData = new FormData();
      files.forEach(file => formData.append('files', file));
      const metadata = files.map((file, index) => ({
        originalName: file.name,
        size: file.size,
        mimetype: file.type,
        fileIndex: index,
        hasThumbnail: false,
        width: undefined,
        height: undefined,
      }));
      formData.append('fileMetadata', JSON.stringify(metadata));
      formData.append('entityId', impactId);
      formData.append('entityType', 'IMPACT');

      await apiInstance.post('/attachments/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload attachments');
    } finally {
      setIsUploadingAttachments(false);
    }
  };

  const saveExistingImpacts = async (): Promise<{ savedCount: number; hasErrors: boolean }> => {
    const existingImpacts = getValues('existingImpacts');
    let hasErrors = false;
    let savedCount = 0;

    for (const [index, impact] of existingImpacts.entries()) {
      if (!impact) continue;
      const validation = validateImpact(impact);
      if (!validation.success) {
        hasErrors = true;
        continue;
      }

      try {
        const result = await zero.mutate(
          mutators.impact.update({
            id: impact.id,
            impactTypeId: impact.impactType,
            impact: impact.impact,
          }),
        ).server;

        if (result.type === 'error') {
          toast.error(result.error.message || `Failed to save Impact ${impact.id}`);
          hasErrors = true;
        } else {
          savedCount++;
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Failed to save Impact ${impact.id}`);
        hasErrors = true;
      }

      if ((impact.files ?? []).length > 0) {
        await uploadAttachments(impact.files, impact.id);
        updateExistingRow(index, row => ({ ...row, files: [] }));
      }
    }

    if (hasErrors) {
      setShowErrors(true);
    }

    return { savedCount, hasErrors };
  };

  const savePendingImpacts = async (): Promise<{ savedCount: number; hasErrors: boolean }> => {
    const currentPending = getValues('pendingImpacts');
    if (currentPending.length === 0) {
      return { savedCount: 0, hasErrors: false };
    }

    const pendingErrors = currentPending.some(impact => !validateImpact(impact).success);
    if (pendingErrors) {
      setShowErrors(true);
      toast.error('Please complete all pending impact details');
      return { savedCount: 0, hasErrors: true };
    }

    const impactIdByTempId = new Map<string, string>();
    const createMutations = currentPending.map(impact => {
      const impactId = uuidv4();
      impactIdByTempId.set(impact.tempId, impactId);
      return zero.mutate(
        mutators.impact.create({
          id: impactId,
          ticketId: selectedRecord.ticketId,
          impactTypeId: impact.impactType,
          impact: impact.impact,
          rcaId: selectedRecord.id,
          timestamp: Date.now(),
        }),
      );
    });

    try {
      const createResults = await Promise.all(createMutations.map(m => m.server));
      const failedCreate = createResults.find(r => r.type === 'error');
      if (failedCreate) {
        toast.error(
          failedCreate.type === 'error' ? failedCreate.error.message : 'Failed to create Impact',
        );
        return { savedCount: 0, hasErrors: true };
      }

      for (const impact of currentPending) {
        const files = impact.files ?? [];
        if (files.length === 0) continue;
        const impactId = impactIdByTempId.get(impact.tempId);
        if (!impactId) continue;
        await uploadAttachments(files, impactId);
      }

      replacePendingImpacts([]);
      return { savedCount: currentPending.length, hasErrors: false };
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save pending Impact drafts');
      return { savedCount: 0, hasErrors: true };
    }
  };

  const handleSaveDraft = async (): Promise<boolean> => {
    const existingResult = await saveExistingImpacts();
    const pendingResult = await savePendingImpacts();
    const hasErrors = existingResult.hasErrors || pendingResult.hasErrors;

    if (hasErrors) {
      toast.error('Some Impacts failed to save');
      return false;
    }

    reset({
      existingImpacts: getValues('existingImpacts'),
      pendingImpacts: getValues('pendingImpacts'),
    });

    return true;
  };

  const handleSaveDraftClick = async (): Promise<void> => {
    const saved = await handleSaveDraft();
    if (saved) {
      toast.success('Impact details saved');
    }
  };

  const hasUnsavedChanges = (): boolean => isDirty;
  const discardDraft = (): void => {
    const initialExisting: ExistingImpactRow[] = (selectedRecord.impacts ?? []).map(impact => ({
      id: impact.id,
      impactType: impact.impactTypeId ?? '',
      impact: impact.impact ?? '',
      files: [],
    }));
    reset({
      existingImpacts: initialExisting,
      pendingImpacts: [],
    });
    setShowErrors(false);
  };

  const handleDeleteImpact = async (id: string, index: number) => {
    if (deletingImpactId) return;
    setDeletingImpactId(id);
    try {
      const result = await zero.mutate(mutators.impact.delete({ id })).server;
      if (result.type === 'error') {
        toast.error(result.error.message || 'Failed to delete Impact');
        return;
      }
      removeExistingImpact(index);
      toast.success('Impact deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete Impact');
    } finally {
      setDeletingImpactId(null);
    }
  };

  if (controllerRef) {
    controllerRef.current = {
      save: handleSaveDraft,
      hasUnsavedChanges,
      discard: discardDraft,
    };
  }

  const handleSaveAll = async () => {
    setShowErrors(true);
    const saved = await handleSaveDraft();
    if (!saved) return;
    toast.success('Impact details saved');
    onPhaseChange('coe');
  };

  const handlePreviewFile = async (file: File | UploadedFile) => {
    try {
      if (file instanceof File) {
        setPreviewFile(file);
        setIsPreviewOpen(true);
        return;
      }
      const fetchedFile = await fetchFile(file.id, file.originalName, file.mimeType);
      setPreviewFile(fetchedFile);
      setIsPreviewOpen(true);
    } catch {
      toast.error('Failed to load attachment preview');
    }
  };

  const renderImpactForm = (
    type: 'existing' | 'pending',
    id: string,
    data: ExistingImpactRow | PendingImpact,
    index: number,
  ) => {
    const isExisting = type === 'existing';
    const impactSummaryFieldId = `impact-summary-${id}`;
    const impactTypeFieldId = `impact-type-${id}`;
    const errors = showErrors ? getErrors(data) : {};
    const isDeleting = isExisting && deletingImpactId === id;

    return (
      <div key={id} className='space-y-6 pb-8 border-b border-border last:border-b-0 last:pb-0'>
        <div className='flex items-center justify-between'>
          <h4 className='text-sm font-semibold text-foreground'>
            {isExisting ? `Impact ${index + 1}` : 'Impact'}
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
                ? void handleDeleteImpact(id, index)
                : (() => {
                    removePendingImpact(index);
                    if (pendingFileInputsRef.current[id]) {
                      delete pendingFileInputsRef.current[id];
                    }
                  })()
            }
            data-track-category='RCA'
            data-track-name='DELETE_IMPACT'
            loading={isDeleting}
            disabled={isSubmitting || deletingImpactId !== null}
            aria-label={isExisting ? `Delete Impact ${index + 1}` : 'Remove Impact'}
          >
            {isExisting ? (
              !isDeleting && <Trash2 className='h-3.5 w-3.5' />
            ) : (
              <X className='h-4 w-4' />
            )}
          </Button>
        </div>

        <div className='space-y-4'>
          <div className='space-y-1.5'>
            <label htmlFor={impactTypeFieldId} className='text-sm font-medium text-foreground'>
              Impact Type *
            </label>
            <select
              id={impactTypeFieldId}
              value={data.impactType}
              onChange={e => {
                if (isExisting) {
                  updateExistingRow(index, row => ({ ...row, impactType: e.target.value }));
                  return;
                }
                updatePendingRow(index, row => ({ ...row, impactType: e.target.value }));
              }}
              data-track-category='RCA'
              data-track-name='ImpactTypeSelect'
              className='w-full px-3 py-2 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-background text-foreground'
            >
              <option value=''>Select impact type</option>
              {impactTypeOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {renderFieldError(errors.impactType ?? null, showErrors)}
          </div>

          <div className='space-y-1.5'>
            <label htmlFor={impactSummaryFieldId} className='text-sm font-medium text-foreground'>
              Impact Summary *
            </label>
            <Textarea
              ref={index === 0 ? primaryImpactRef : undefined}
              id={impactSummaryFieldId}
              value={data.impact}
              onChange={e => {
                if (isExisting) {
                  updateExistingRow(index, row => ({ ...row, impact: e.target.value }));
                  return;
                }
                updatePendingRow(index, row => ({ ...row, impact: e.target.value }));
              }}
              placeholder='Describe the impact...'
              rows={4}
              aria-invalid={showErrors && !data.impact.trim()}
              className={cn(
                showErrors &&
                  !data.impact.trim() &&
                  'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
              )}
            />
            {renderFieldError(errors.impact ?? null, showErrors)}
          </div>

          {isExisting ? (
            <ImpactAttachments
              impactId={id}
              draftFiles={(data as ExistingImpactRow).files ?? []}
              isUploading={isUploadingAttachments}
              onAddFiles={files => {
                updateExistingRow(index, row => ({
                  ...row,
                  files: [...(row.files ?? []), ...files],
                }));
              }}
              onRemoveDraft={idx => {
                updateExistingRow(index, row => ({
                  ...row,
                  files: (row.files ?? []).filter((_, i) => i !== idx),
                }));
              }}
              onRemoveUploaded={attachmentId => {
                zero.mutate(mutators.messageAttachment.delete({ attachmentId }));
              }}
              onPreview={file => {
                void handlePreviewFile(file);
              }}
            />
          ) : (
            <div className='pt-4 border-t border-border'>
              <div className='flex items-center justify-between gap-3'>
                <div>
                  <h4 className='text-sm font-semibold text-foreground'>Attachments</h4>
                  <p className='text-xs text-muted-foreground'>Upload supporting files.</p>
                </div>
                <div>
                  <input
                    ref={el => {
                      pendingFileInputsRef.current[id] = el;
                    }}
                    type='file'
                    multiple
                    className='hidden'
                    onChange={e => {
                      const files = Array.from(e.target.files ?? []);
                      if (!files.length) return;
                      updatePendingRow(index, row => ({
                        ...row,
                        files: [...(row.files ?? []), ...files],
                      }));
                      e.target.value = '';
                    }}
                    disabled={isUploadingAttachments}
                  />
                  <Button
                    type='button'
                    size='sm'
                    variant='outline'
                    onClick={() => pendingFileInputsRef.current[id]?.click()}
                    data-track-category='RCA'
                    data-track-name='UPLOAD_PENDING_IMPACT_ATTACHMENT'
                    disabled={isUploadingAttachments}
                  >
                    Upload files
                  </Button>
                </div>
              </div>
              {(data.files ?? []).length > 0 && (
                <div className='mt-3 flex flex-wrap items-start gap-2'>
                  {(data.files ?? []).map((file, idx) => (
                    <AttachmentPreview
                      key={`${file.name}-${file.size}-${idx}`}
                      file={file}
                      onRemove={() => {
                        updatePendingRow(index, row => ({
                          ...row,
                          files: row.files.filter((_, i) => i !== idx),
                        }));
                      }}
                      onPreview={() => {
                        void handlePreviewFile(file);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  if (!isImpactEnabled) {
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
              <p className='text-lg font-semibold text-foreground'>Impact Locked</p>
              <p className='text-sm text-muted-foreground'>
                Impact editing is available only when RCA status is DRAFT or CLOSED.
              </p>
            </div>
          </div>
          <Button
            variant='outline'
            size='sm'
            onClick={() => onPhaseChange('rca')}
            data-track-category='RCA'
            data-track-name='GO_TO_RCA_PHASE'
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
              <h2 className='text-xl font-bold text-foreground'>Impact Details</h2>
              <p className='text-sm text-muted-foreground'>Capture business and customer impact</p>
            </div>
          </div>
        </div>

        <div className='p-8 space-y-8'>
          {isLocked
            ? selectedRecord.impacts?.map((impact, index) => (
                <div
                  key={impact.id}
                  className='space-y-6 pb-8 border-b border-border last:border-b-0 last:pb-0'
                >
                  <h4 className='text-base font-semibold text-foreground'>Impact {index + 1}</h4>
                  <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                    <ReadOnlyField
                      label='Impact Type'
                      value={
                        impactTypeOptions.find(o => o.value === impact.impactTypeId)?.label ??
                        impact.impactTypeId
                      }
                    />
                  </div>
                  <ReadOnlyField label='Impact Summary' value={impact.impact ?? '-'} />
                </div>
              ))
            : existingImpactFields.map((field, index) =>
                renderImpactForm(
                  'existing',
                  existingImpactValues?.[index]?.id ?? field.id,
                  existingImpactValues?.[index] ?? field,
                  index,
                ),
              )}

          {!isLocked &&
            pendingImpactFields.map((field, index) =>
              renderImpactForm(
                'pending',
                pendingImpactValues?.[index]?.tempId ?? field.id,
                pendingImpactValues?.[index] ?? field,
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
                  const defaultImpactTypeId = impactTypeOptions[0]?.value;
                  if (!defaultImpactTypeId) {
                    toast.error('No impact types available');
                    return;
                  }
                  appendPendingImpact({
                    tempId: uuidv4(),
                    impactType: defaultImpactTypeId,
                    impact: '',
                    files: [],
                  });
                }}
                data-track-category='RCA'
                data-track-name='ADD_IMPACT'
                disabled={isSubmitting}
              >
                <Plus className='h-3.5 w-3.5' />
                Add Another Impact
              </Button>
            </div>
          )}

          {!isLocked && (
            <div className='sticky bottom-0 -mx-8 -mb-8 p-4 bg-background/95 backdrop-blur border-t border-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3'>
              <div className='text-xs text-muted-foreground'>
                {(pendingImpactValues?.length ?? 0) > 0
                  ? `${pendingImpactValues?.length ?? 0} pending impact(s)`
                  : (existingImpactValues?.length ?? 0) > 0
                    ? `${existingImpactValues?.length ?? 0} Impact(s)`
                    : ''}
              </div>
              <div className='flex flex-wrap gap-2'>
                {((existingImpactValues?.length ?? 0) > 0 ||
                  (pendingImpactValues?.length ?? 0) > 0) && (
                  <Button
                    type='button'
                    variant='outline'
                    onClick={() => void handleSaveDraftClick()}
                    data-track-category='RCA'
                    data-track-name='SAVE_IMPACT_DRAFT'
                    loading={isSubmitting}
                    disabled={isSubmitting}
                  >
                    Save Draft
                  </Button>
                )}
                <Button
                  type='button'
                  onClick={() => void handleSaveAll()}
                  data-track-category='RCA'
                  data-track-name='SAVE_ALL_IMPACTS'
                  loading={isSubmitting}
                  disabled={isSubmitting}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {previewFile && (
        <MediaViewer
          file={previewFile}
          isOpen={isPreviewOpen}
          onClose={() => {
            setIsPreviewOpen(false);
            setPreviewFile(null);
          }}
        />
      )}
    </div>
  );
};
