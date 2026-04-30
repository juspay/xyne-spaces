import { type ReactElement, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Monitor,
  Mic,
  MicOff,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import Textarea from '../ui/Textarea';
import { AttachmentPreview } from '../ui/files/AttachmentPreview';
import { getFileCategory, getFilesDimensions, validateFile } from '../ui/utils/files';
import { usePlatform } from '../../hooks/usePlatform';
import { useZero } from '../../hooks/useZero';
import { useAuth } from '../../hooks/useAuth';
import { useCacConfig } from '../../hooks/useCacConfig';
import { useNavigate } from 'react-router-dom';
import { mutators } from '../../zero/mutators';
import {
  createErrorReportLogFile,
  type ErrorReportContext,
} from '../../utils/errorReportLogCollector';
import { apiInstance } from '../../services/clients/apiClient';
import {
  MAX_ERROR_REPORT_ATTACHMENTS,
  MAX_ATTACHMENT_SIZE_BYTES,
  getTicketsPath,
} from './ErrorReportModal.utils';
import type { ErrorReportModalProps } from './ErrorReportModal.types';
import { MACOS_PRIVACY_URLS } from '../../constants/permissions';
import type { ScreenSource } from '../../types/electron';

type ErrorReportCacConfig = {
  channelId: string;
  boardId?: string;
};

const saveFileToDisk = async (file: File, sourcePath?: string | null): Promise<void> => {
  if (window.electronAPI?.saveErrorReportFile) {
    if (sourcePath) {
      // Recording is already on disk — pass the path so main process can copy it directly,
      // avoiding a full memory round-trip for what could be a large file
      await window.electronAPI.saveErrorReportFile(file.name, null, sourcePath);
    } else {
      const buffer = await file.arrayBuffer();
      await window.electronAPI.saveErrorReportFile(file.name, buffer, null);
    }
    return;
  }
  // Web fallback: trigger a browser download
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

const formatContextValue = (value: string | null): string => {
  return value && value.trim() ? value : 'unavailable';
};

const buildTicketDescription = (description: string, context: ErrorReportContext): string => {
  return `${description.trim()}\n\n---\nError report context\nPlatform: ${context.platform}\nRoute: ${context.route}\nApp version: ${context.appVersion}\nBundle version: ${formatContextValue(context.bundleVersion)}\nClient session ID: ${formatContextValue(context.clientSessionId)}\nZero client ID: ${formatContextValue(context.zeroClientId)}\nZero client group ID: ${formatContextValue(context.zeroClientGroupId)}\nTimestamp: ${context.timestamp}\nNative logs: ${context.nativeLogFiles.length > 0 ? context.nativeLogFiles.join(', ') : 'none'}`;
};

export const ErrorReportModal = ({
  isOpen,
  onClose,
  pendingRecording,
  pendingRecordingFilePath,
  onSourceSelected,
  onSubmitSuccess,
  onDiscard,
}: ErrorReportModalProps): ReactElement => {
  const { isElectron } = usePlatform();
  const zero = useZero();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { config: cacConfig } = useCacConfig<ErrorReportCacConfig>({
    key: 'error_report_channel_config',
    fallbackConfig: { channelId: '' },
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  // Source picker state (lives here — recording state lives in AppRoot)
  const [isPicking, setIsPicking] = useState(false);
  const [screenSources, setScreenSources] = useState<ScreenSource[]>([]);
  const [micEnabled, setMicEnabled] = useState(false);

  // Reset picker state when modal closes.
  // Title, description, and attachments are intentionally preserved so they survive
  // the close that happens when the user starts a screen recording.
  useEffect(() => {
    if (!isOpen) {
      setIsPicking(false);
      setScreenSources([]);
      setIsSubmitted(false);
    }
  }, [isOpen]);

  const pendingAttachedRef = useRef<File | null>(null);

  // Auto-attach a pending recording when the modal opens, but only once per recording
  useEffect(() => {
    if (isOpen && pendingRecording && pendingRecording !== pendingAttachedRef.current) {
      pendingAttachedRef.current = pendingRecording;
      if (pendingRecording.size > MAX_ATTACHMENT_SIZE_BYTES) {
        toast.error('Recording too large', {
          description:
            'The recording exceeds 1 GB and cannot be attached. You can still save it to disk.',
        });
        return;
      }
      setAttachments(prev => {
        const remaining = MAX_ERROR_REPORT_ATTACHMENTS - prev.length;
        if (remaining <= 0) return prev;
        return [...prev, pendingRecording];
      });
    }
  }, [isOpen, pendingRecording]);

  const handleStartRecordingPicker = async (): Promise<void> => {
    const api = window.electronAPI;
    if (!api?.getErrorReportScreenSources) {
      toast.error('Screen recording is not available', {
        description: 'Please restart the app to enable this feature.',
      });
      return;
    }

    let result: { sources: ScreenSource[]; permissionError: 'denied' | null };
    try {
      result = await api.getErrorReportScreenSources();
    } catch (err) {
      toast.error('Failed to load screen sources', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
      return;
    }

    if (result.permissionError === 'denied') {
      toast.error('Screen recording permission denied', {
        description: 'Allow access in System Settings → Privacy & Security → Screen Recording.',
        action: {
          label: 'Open Settings',
          onClick: () => void api.openExternal?.(MACOS_PRIVACY_URLS['screen'] ?? ''),
        },
      });
      return;
    }

    setScreenSources(result.sources);
    setIsPicking(true);
  };

  const handleSourceSelect = (source: ScreenSource): void => {
    setIsPicking(false);
    onSourceSelected?.(source, micEnabled);
    onClose();
  };

  const resetForm = (): void => {
    setTitle('');
    setDescription('');
    setAttachments([]);
    setIsPicking(false);
    setScreenSources([]);
    setIsSubmitted(false);
    pendingAttachedRef.current = null;
  };

  const cleanupPendingRecording = (): void => {
    if (pendingRecordingFilePath && window.electronAPI?.cleanupErrorReportRecording) {
      void window.electronAPI
        .cleanupErrorReportRecording(pendingRecordingFilePath)
        .catch(() => undefined);
    }
  };

  const handleDiscard = (): void => {
    if (isSubmitting) return;

    cleanupPendingRecording();
    resetForm();
    onDiscard?.();
    onClose();
  };

  const addFiles = (newFiles: File[]): void => {
    const valid = newFiles.filter(
      f => validateFile(f, { maxSize: MAX_ATTACHMENT_SIZE_BYTES }).isValid,
    );
    const rejectedCount = newFiles.length - valid.length;

    if (rejectedCount > 0) {
      toast.error(`${rejectedCount} file${rejectedCount > 1 ? 's' : ''} too large`, {
        description: 'Files must be 1 GB or smaller.',
      });
    }

    const remainingSlots = MAX_ERROR_REPORT_ATTACHMENTS - attachments.length;
    if (valid.length > remainingSlots) {
      toast.error('Too many attachments', {
        description: `You can attach up to ${MAX_ERROR_REPORT_ATTACHMENTS} files. The log file is added automatically.`,
      });
    }

    if (remainingSlots > 0) {
      setAttachments(prev => [...prev, ...valid.slice(0, remainingSlots)]);
    }
  };

  const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>): void => {
    addFiles(Array.from(event.target.files || []));
    event.target.value = '';
  };

  const handleDragEnter = (event: React.DragEvent): void => {
    event.preventDefault();
    dragCounterRef.current += 1;
    if (dragCounterRef.current === 1) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (event: React.DragEvent): void => {
    event.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (event: React.DragEvent): void => {
    event.preventDefault();
  };

  const handleDrop = (event: React.DragEvent): void => {
    event.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  };

  const handleRemoveAttachment = (index: number): void => {
    setAttachments(prev => prev.filter((_, currentIndex) => currentIndex !== index));
  };

  const handleSubmit = async (): Promise<void> => {
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }

    setIsSubmitting(true);

    try {
      const { file: logFile, context } = await createErrorReportLogFile();
      const filesToUpload = [...attachments, logFile];
      const dimensionsMap = await getFilesDimensions(filesToUpload);

      const formData = new FormData();
      formData.append('title', title.trim());
      formData.append('description', buildTicketDescription(description, context));
      filesToUpload.forEach(file => formData.append('files', file));
      formData.append(
        'fileMetadata',
        JSON.stringify(
          filesToUpload.map((file, fileIndex) => {
            const dimensions = dimensionsMap.get(file);
            return {
              fileIndex,
              hasThumbnail: false,
              ...(dimensions && { width: dimensions.width, height: dimensions.height }),
            };
          }),
        ),
      );

      const headers: Record<string, string> = {};
      headers['x-support-ticket'] = 'true';

      await apiInstance.post('/tickets', formData, {
        headers,
      });

      const channelId = cacConfig.channelId;

      if (channelId) {
        zero
          .mutate(
            mutators.channel.joinChannel({
              channelId,
              channelParticipantId: uuidv4(),
              channelUserStatusId: uuidv4(),
              timestamp: Date.now(),
            }),
          )
          .client.catch(() => {
            // Already a member, channel not public, or join not applicable — safe to ignore
          });
      }

      // Best-effort cleanup; ticket creation already succeeded.
      cleanupPendingRecording();
      onSubmitSuccess?.();

      resetForm();
      setIsSubmitted(true);
    } catch (error) {
      toast.error('Failed to report issue', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open && !isSubmitting) {
          if (isSubmitted) {
            setIsSubmitted(false);
          }
          handleDiscard();
        }
      }}
      title='Report Issue'
      className='max-w-2xl w-[92vw] rounded-2xl'
    >
      <div className='flex flex-col max-h-[85vh] overflow-hidden rounded-2xl bg-background text-foreground'>
        <div className='flex items-center justify-between px-6 py-4 border-b border-border bg-background'>
          <div className='flex items-center gap-3'>
            <div>
              <h2 className='text-lg font-semibold text-foreground'>Report Issue</h2>
              {!isSubmitted && (
                <p className='text-sm text-muted-foreground'>
                  Sorry you hit a snag! Share what happened and we&apos;ll look into it right away.
                </p>
              )}
            </div>
          </div>
          <button
            type='button'
            onClick={handleDiscard}
            className='p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
            aria-label='Close'
            data-track-category='ERROR_REPORT'
            data-track-name='CloseModal'
          >
            <X className='size-5' />
          </button>
        </div>

        {isSubmitted ? (
          <div className='flex-1 flex flex-col items-center justify-center px-6 py-12 gap-4'>
            <div className='rounded-full bg-action-primary/10 p-3'>
              <CheckCircle2 className='size-8 text-action-primary' />
            </div>
            <div className='text-center flex flex-col gap-1'>
              <h3 className='text-lg font-semibold text-foreground'>Report submitted</h3>
              <p className='text-sm text-muted-foreground'>We&apos;ll look into this right away.</p>
            </div>
            {cacConfig.channelId && (
              <button
                type='button'
                onClick={() => {
                  onClose();
                  void navigate(getTicketsPath(cacConfig.channelId, cacConfig.boardId, user?.id));
                }}
                className='inline-flex items-center gap-1.5 text-sm font-medium text-action-primary hover:text-action-primary/80 transition-colors'
                data-track-category='ERROR_REPORT'
                data-track-name='ViewMyTickets'
              >
                View my tickets
                <ExternalLink className='size-4' />
              </button>
            )}
          </div>
        ) : (
          <>
            <div className='flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5'>
              <div className='flex flex-col gap-2'>
                <label htmlFor='error-report-title' className='text-sm font-medium text-foreground'>
                  Title
                </label>
                <Textarea
                  ref={titleRef}
                  id='error-report-title'
                  value={title}
                  rows={1}
                  onChange={event => {
                    setTitle(event.target.value);
                    const el = titleRef.current;
                    if (el) {
                      el.style.height = 'auto';
                      el.style.height = `${el.scrollHeight}px`;
                    }
                  }}
                  placeholder='Give it a short title so we know where to look'
                  maxLength={140}
                  className='min-h-0 py-2 overflow-hidden'
                  data-track-category='ERROR_REPORT'
                  data-track-name='TitleChanged'
                />
              </div>

              <div className='flex flex-col gap-2'>
                <label
                  htmlFor='error-report-description'
                  className='text-sm font-medium text-foreground'
                >
                  Description
                </label>
                <Textarea
                  id='error-report-description'
                  value={description}
                  onChange={event => setDescription(event.target.value)}
                  placeholder='Tell us what happened, what you expected to see, and any steps that led here. Every detail helps!'
                  className='min-h-[140px]'
                  data-track-category='ERROR_REPORT'
                  data-track-name='DescriptionChanged'
                />
              </div>

              <div className='flex flex-col gap-3'>
                <div>
                  <h3 className='text-sm font-medium text-foreground'>Attachments</h3>
                  <p className='text-xs text-muted-foreground'>
                    A screenshot or recording can go a long way — attach up to{' '}
                    {MAX_ERROR_REPORT_ATTACHMENTS} files. We&apos;ll also include a log file
                    automatically.
                  </p>
                </div>

                <input
                  ref={fileInputRef}
                  type='file'
                  multiple
                  accept='image/*,video/*,text/plain,.log,.txt,.pdf,.zip'
                  className='hidden'
                  onChange={handleFileSelection}
                />

                {/* Source picker — shown after clicking "Record screen" */}
                {isPicking && (
                  <div className='rounded-lg border border-border bg-muted/30 p-3 flex flex-col gap-3'>
                    <div className='flex items-center justify-between'>
                      <p className='text-sm font-medium text-foreground'>
                        Select a screen to record
                      </p>
                      <div className='flex items-center gap-2'>
                        <button
                          type='button'
                          onClick={() => setMicEnabled(prev => !prev)}
                          className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
                            micEnabled
                              ? 'border-action-primary bg-action-primary/10 text-action-primary'
                              : 'border-border bg-background text-muted-foreground hover:text-foreground'
                          }`}
                          aria-label={micEnabled ? 'Disable microphone' : 'Enable microphone'}
                          title={micEnabled ? 'Microphone on' : 'Microphone off'}
                          data-track-category='ERROR_REPORT'
                          data-track-name={micEnabled ? 'MicOff' : 'MicOn'}
                        >
                          {micEnabled ? (
                            <Mic className='size-3.5' />
                          ) : (
                            <MicOff className='size-3.5' />
                          )}
                          <span>{micEnabled ? 'Mic on' : 'Mic off'}</span>
                        </button>
                        <button
                          type='button'
                          onClick={() => setIsPicking(false)}
                          className='text-muted-foreground hover:text-foreground'
                          aria-label='Cancel picker'
                          data-track-category='ERROR_REPORT'
                          data-track-name='CancelPicker'
                        >
                          <X className='size-4' />
                        </button>
                      </div>
                    </div>
                    <div className='grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto'>
                      {screenSources.map(source => (
                        <button
                          key={source.id}
                          type='button'
                          onClick={() => handleSourceSelect(source)}
                          className='flex flex-col items-center gap-1.5 rounded-lg border border-border bg-background hover:border-action-primary hover:bg-action-primary/5 p-2 transition-colors text-left'
                          data-track-category='ERROR_REPORT'
                          data-track-name='SelectSource'
                        >
                          <img
                            src={source.thumbnail}
                            alt={source.name}
                            className='w-full rounded aspect-video object-cover bg-muted'
                          />
                          <span className='text-xs text-foreground truncate w-full text-center'>
                            {source.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {!isPicking && (
                  <div className='flex gap-2'>
                    <button
                      type='button'
                      onClick={() => fileInputRef.current?.click()}
                      onDragEnter={handleDragEnter}
                      onDragLeave={handleDragLeave}
                      onDragOver={handleDragOver}
                      data-track-category='ERROR_REPORT'
                      data-track-name='DragDropArea'
                      onDrop={handleDrop}
                      className={`flex-1 rounded-lg border border-dashed border-action-primary transition-all flex flex-col items-center justify-center gap-2 px-4 py-8 text-sm cursor-pointer text-action-primary ${
                        isDragging
                          ? 'bg-action-primary/10'
                          : 'bg-action-primary/5 hover:bg-action-primary/10'
                      }`}
                    >
                      <Upload className='size-6' />
                      <span className={isDragging ? 'font-medium' : ''}>
                        {isDragging
                          ? 'Drop files here'
                          : 'Drag & drop files here, or click to browse'}
                      </span>
                    </button>

                    {isElectron &&
                      onSourceSelected &&
                      !!window.electronAPI?.getErrorReportScreenSources && (
                        <button
                          type='button'
                          onClick={() => void handleStartRecordingPicker()}
                          data-track-category='ERROR_REPORT'
                          data-track-name='StartRecording'
                          className='rounded-lg border border-dashed border-muted-foreground/40 flex flex-col items-center justify-center gap-2 px-5 py-8 text-sm cursor-pointer text-muted-foreground hover:text-foreground hover:border-muted-foreground hover:bg-muted/30 transition-all'
                        >
                          <Monitor className='size-6' />
                          <span>Record screen</span>
                        </button>
                      )}
                  </div>
                )}

                {attachments.length > 0 && (
                  <div className='flex flex-wrap gap-3'>
                    {attachments.map((file, index) => (
                      <div
                        key={`${file.name}-${file.size}-${index}`}
                        className='flex flex-col items-center gap-1'
                      >
                        <AttachmentPreview
                          file={file}
                          onRemove={() => handleRemoveAttachment(index)}
                          onPreview={() => {
                            const url = URL.createObjectURL(file);
                            window.open(url, '_blank');
                            setTimeout(() => URL.revokeObjectURL(url), 30_000);
                          }}
                        />
                        {getFileCategory(file) === 'video' && (
                          <button
                            type='button'
                            onClick={() =>
                              void saveFileToDisk(
                                file,
                                file === pendingAttachedRef.current
                                  ? pendingRecordingFilePath
                                  : null,
                              )
                            }
                            className='flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors'
                            data-track-category='ERROR_REPORT'
                            data-track-name='SaveVideoToDisk'
                            title='Save to desktop'
                          >
                            <Download className='size-3' />
                            <span>Save</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className='flex items-center justify-between gap-3 px-6 py-4 border-t border-border bg-background'>
              <p className='text-xs text-muted-foreground'>
                We appreciate you taking the time to report this.
              </p>
              <div className='flex items-center gap-2'>
                <Button
                  type='button'
                  variant='ghost'
                  onClick={handleDiscard}
                  disabled={isSubmitting}
                  data-track-category='ERROR_REPORT'
                  data-track-name='Cancel'
                >
                  Cancel
                </Button>
                <Button
                  type='button'
                  onClick={() => void handleSubmit()}
                  loading={isSubmitting}
                  disabled={!title.trim() || !description.trim()}
                  className='bg-action-primary text-action-primary-foreground hover:bg-action-primary/90'
                  data-track-category='ERROR_REPORT'
                  data-track-name='Submit'
                >
                  Submit report
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
};
