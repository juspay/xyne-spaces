import React, { useState, useRef, useCallback, useEffect } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Mic,
  Square,
  Upload,
  CheckCircle2,
  Trash2,
  X,
  Waves,
  AlertCircle,
  Quote,
} from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { Button } from '../../ui/Button/Button';
import { toast } from 'sonner';
import {
  uploadVoiceSignature,
  deleteVoiceSignature,
} from '../../../services/userProfile/userProfileService';
import { useOverlayEffect } from '../../../machines/stateMachine';

interface VoiceSignatureModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasVoiceSignature: boolean;
}

const MIN_SECONDS = 5;
const RECOMMENDED_SECONDS = 15;

const VOICE_SCRIPT =
  `Hello, this is my voice recording for testing and verification purposes. ` +
  `Today I am speaking clearly and naturally to capture the full range of my voice. ` +
  `I enjoy working on technology, solving problems, and building useful applications. ` +
  `This sample should help in understanding my tone, pitch, and speaking style.`;

export const VoiceSignatureModal: React.FC<VoiceSignatureModalProps> = ({
  open,
  onOpenChange,
  hasVoiceSignature,
}) => {
  useOverlayEffect(open);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'record' | 'upload'>('record');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingDurationRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state whenever modal opens
  useEffect(() => {
    if (open) {
      setIsRecording(false);
      setRecordingSeconds(0);
      setUploadProgress(null);
      setActiveTab('record');
    }
  }, [open]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      mediaRecorderRef.current?.stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const handleClose = useCallback(() => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
    }
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    onOpenChange(false);
  }, [isRecording, onOpenChange]);

  const processFile = useCallback(async (file: File) => {
    setUploadProgress(0);
    try {
      await uploadVoiceSignature(file, pct => setUploadProgress(pct));
      toast.success('Voice signature saved successfully');
    } catch {
      // uploadVoiceSignature already shows a toast on error
    } finally {
      setUploadProgress(null);
    }
  }, []);

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      const recorder = new MediaRecorder(stream, { mimeType });
      recordingChunksRef.current = [];

      recorder.ondataavailable = e => {
        if (e.data.size > 0) recordingChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        const seconds = recordingDurationRef.current;
        recordingDurationRef.current = 0;
        setRecordingSeconds(0);

        if (seconds < MIN_SECONDS) {
          toast.error(`Recording too short. Please record at least ${MIN_SECONDS} seconds.`);
          return;
        }

        const blob = new Blob(recordingChunksRef.current, { type: mimeType });
        const ext = mimeType.includes('webm') ? '.webm' : '.ogg';
        void processFile(new File([blob], `voice-signature${ext}`, { type: mimeType }));
      };

      recorder.start(100);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds(s => {
          recordingDurationRef.current = s + 1;
          return s + 1;
        });
      }, 1000);
    } catch {
      toast.error('Microphone access denied. Please allow microphone access and try again.');
    }
  };

  const handleStopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void processFile(file);
    e.target.value = '';
  };

  const handleDelete = async () => {
    await deleteVoiceSignature();
    toast.success('Voice signature removed');
  };

  const isProcessing = uploadProgress !== null;

  // Progress bar colour: green once we hit recommended length
  const progressBarWidth = Math.min((recordingSeconds / RECOMMENDED_SECONDS) * 100, 100);
  const progressColour =
    recordingSeconds >= RECOMMENDED_SECONDS
      ? 'bg-green-500'
      : recordingSeconds >= MIN_SECONDS
        ? 'bg-primary'
        : 'bg-amber-500';

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 bg-black/50 backdrop-blur-sm z-50',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          )}
        />

        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
            'w-full max-w-md',
            'bg-popover rounded-xl shadow-xl border border-border',
            'focus:outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
            'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]',
            'duration-200',
          )}
        >
          <DialogPrimitive.Title className='sr-only'>Voice Signature</DialogPrimitive.Title>
          <DialogPrimitive.Description className='sr-only'>
            Record or upload audio to create your voice signature for meeting identification.
          </DialogPrimitive.Description>

          {/* Header */}
          <div className='flex items-start justify-between p-5 pb-4'>
            <div className='flex items-center gap-3'>
              <div className='flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10'>
                <Waves className='size-5 text-primary' />
              </div>
              <div>
                <h2 className='text-sm font-semibold text-foreground'>Voice Signature</h2>
                <p className='text-xs text-muted-foreground mt-0.5'>
                  Used to identify you in meeting recordings
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              data-track-category='voice-signature'
              data-track-name='close-modal'
              className='text-muted-foreground hover:text-foreground transition-colors rounded-md p-1 hover:bg-muted'
            >
              <X className='size-4' />
            </button>
          </div>

          <div className='px-5 pb-5 space-y-4'>
            {/* Current status */}
            {hasVoiceSignature && !isProcessing && (
              <div className='flex items-center justify-between px-3 py-2.5 rounded-lg bg-green-500/10 border border-green-500/20'>
                <div className='flex items-center gap-2'>
                  <CheckCircle2 className='size-4 text-green-500 flex-shrink-0' />
                  <p className='text-xs font-medium text-foreground'>Voice signature stored</p>
                </div>
                <button
                  data-ph-capture-attribute-track-id='delete_voice_signature'
                  onClick={() => void handleDelete()}
                  data-track-category='voice-signature'
                  data-track-name='delete-signature'
                  className='flex items-center gap-1 text-xs text-destructive hover:text-destructive/80 transition-colors'
                >
                  <Trash2 className='size-3' />
                  Remove
                </button>
              </div>
            )}

            {/* Processing bar */}
            {isProcessing && (
              <div className='space-y-1.5'>
                <div className='flex justify-between text-xs text-muted-foreground'>
                  <span>Processing voice signature…</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className='h-1.5 rounded-full bg-muted overflow-hidden'>
                  <div
                    className='h-full bg-primary transition-all duration-300 rounded-full'
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Tab switcher */}
            {!isProcessing && (
              <>
                <div className='flex rounded-lg bg-muted p-1 gap-1'>
                  {(['record', 'upload'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      data-track-category='voice-signature'
                      data-track-name={`tab-${tab}`}
                      className={cn(
                        'flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                        activeTab === tab
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {tab === 'record' ? (
                        <>
                          <Mic className='size-3.5' />
                          Record
                        </>
                      ) : (
                        <>
                          <Upload className='size-3.5' />
                          Upload file
                        </>
                      )}
                    </button>
                  ))}
                </div>

                {/* Record tab */}
                {activeTab === 'record' && (
                  <div className='space-y-3'>
                    {/* Script to read aloud */}
                    <div className='rounded-lg border border-border bg-muted/40 overflow-hidden'>
                      <div className='flex items-center gap-1.5 px-3 py-2 border-b border-border bg-muted/60'>
                        <Quote className='size-3 text-muted-foreground flex-shrink-0' />
                        <p className='text-[10px] font-medium text-muted-foreground uppercase tracking-wide'>
                          Read this aloud while recording
                        </p>
                      </div>
                      <p className='px-3 py-2.5 text-sm text-foreground leading-relaxed select-all'>
                        {VOICE_SCRIPT}
                      </p>
                    </div>
                    <div
                      className={cn(
                        'relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-8 transition-colors',
                        isRecording
                          ? 'border-destructive/50 bg-destructive/5'
                          : 'border-border bg-muted/30',
                      )}
                    >
                      {isRecording ? (
                        <>
                          {/* Animated rings */}
                          <div className='relative flex items-center justify-center'>
                            <span className='absolute inline-flex h-14 w-14 rounded-full bg-destructive/20 animate-ping' />
                            <span className='absolute inline-flex h-10 w-10 rounded-full bg-destructive/30 animate-ping [animation-delay:150ms]' />
                            <button
                              onClick={handleStopRecording}
                              data-track-category='voice-signature'
                              data-track-name='stop-recording'
                              className='relative z-10 flex items-center justify-center w-12 h-12 rounded-full bg-destructive text-white hover:bg-destructive/90 transition-colors shadow-lg'
                            >
                              <Square className='size-4 fill-white' />
                            </button>
                          </div>

                          <div className='text-center space-y-1'>
                            <p className='text-2xl font-mono font-semibold text-foreground tabular-nums'>
                              {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:
                              {String(recordingSeconds % 60).padStart(2, '0')}
                            </p>
                            <p className='text-xs text-muted-foreground'>Recording… tap to stop</p>
                          </div>

                          {/* Duration progress */}
                          <div className='w-full px-4 space-y-1'>
                            <div className='h-1.5 rounded-full bg-muted overflow-hidden'>
                              <div
                                className={cn(
                                  'h-full transition-all duration-1000 rounded-full',
                                  progressColour,
                                )}
                                style={{ width: `${progressBarWidth}%` }}
                              />
                            </div>
                            <div className='flex justify-between text-[10px] text-muted-foreground'>
                              <span>Min {MIN_SECONDS}s</span>
                              <span>Ideal {RECOMMENDED_SECONDS}s</span>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => void handleStartRecording()}
                            data-track-category='voice-signature'
                            data-track-name='start-recording'
                            className='flex items-center justify-center w-14 h-14 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-md hover:shadow-lg hover:scale-105'
                          >
                            <Mic className='size-6' />
                          </button>
                          <div className='text-center'>
                            <p className='text-xs font-medium text-foreground'>
                              {hasVoiceSignature
                                ? 'Re-record voice signature'
                                : 'Tap to start recording'}
                            </p>
                            <p className='text-xs text-muted-foreground mt-0.5'>
                              Speak naturally for 10–30 seconds
                            </p>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Tips */}
                    <div className='flex gap-2 px-3 py-2.5 rounded-lg bg-muted/50 border border-border'>
                      <AlertCircle className='size-3.5 text-muted-foreground flex-shrink-0 mt-0.5' />
                      <p className='text-[11px] text-muted-foreground leading-relaxed'>
                        Read the script above in a quiet environment. Speak at a natural pace —
                        accuracy improves with more varied speech.
                      </p>
                    </div>
                  </div>
                )}

                {/* Upload tab */}
                {activeTab === 'upload' && (
                  <div className='space-y-3'>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      data-track-category='voice-signature'
                      data-track-name='upload-file'
                      className={cn(
                        'w-full flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-10 transition-colors',
                        'border-border bg-muted/30 hover:border-primary/50 hover:bg-primary/5',
                      )}
                    >
                      <div className='flex items-center justify-center w-12 h-12 rounded-full bg-muted border border-border'>
                        <Upload className='size-5 text-muted-foreground' />
                      </div>
                      <div className='text-center'>
                        <p className='text-xs font-medium text-foreground'>
                          Click to select audio file
                        </p>
                        <p className='text-xs text-muted-foreground mt-0.5'>
                          WAV, OGG, MP3, WebM — at least 5 seconds
                        </p>
                      </div>
                    </button>
                    <input
                      ref={fileInputRef}
                      type='file'
                      accept='audio/*'
                      className='hidden'
                      onChange={handleFileChange}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className='flex justify-end border-t border-border px-5 py-3.5'>
            <Button
              variant='outline'
              size='sm'
              onClick={handleClose}
              data-track-category='voice-signature'
              data-track-name='CLOSE_VOICE_SIGNATURE_MODAL'
            >
              {isProcessing ? 'Processing…' : 'Done'}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
