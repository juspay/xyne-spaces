import React, { useState, useEffect, useCallback } from 'react';
import { Dialog } from '../../ui/Dialog/Dialog';
import { AlertTriangle, CheckCircle, Info, Sparkles, Gauge } from 'lucide-react';
import type {
  PriorityClassificationConfig,
  SavePriorityConfigPayload,
  PriorityClassificationPreviewResult,
} from '../../../types/priorityClassification';

interface PrioritySettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  config: PriorityClassificationConfig | null;
  enabled: boolean;
  isSaving: boolean;
  saveConfig: (payload: SavePriorityConfigPayload) => Promise<void>;
  previewResult: PriorityClassificationPreviewResult | null;
  isPreviewing: boolean;
  runPreview: (emailSubject: string, emailBody: string) => Promise<void>;
  error: string | null;
}

const DEFAULT_PRIORITY_PROMPT = `You are an expert support ticket prioritizer for a customer support desk.

Analyze the email and assign a priority level based on:
- Urgency indicators (outage, critical, urgent, down, broken, failure, crash, emergency)
- Business impact (revenue loss, customer blocked, production affected, payment failing)
- Time sensitivity (ASAP, immediately, deadline, expires, today, now)
- Number of affected customers (many, widespread, everyone, multiple clients)
- Security concerns (security breach, vulnerability, hack, attack)
- Severity descriptors (major issue, completely down, severe, catastrophic)
- Escalation indicators (escalate, manager, supervisor, urgent attention)

IMPORTANT: Your response must be ONLY a valid JSON object with no markdown formatting.

Email Subject: {{subject}}

Email Body: {{body}}

Respond with this exact JSON structure:
{
  "priority": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "confidence": number between 0.0 and 1.0,
  "reasoning": "Brief explanation of why this priority was chosen"
}`;

export const PrioritySettingsModal: React.FC<PrioritySettingsModalProps> = ({
  open,
  onOpenChange,
  config,
  enabled,
  isSaving,
  saveConfig,
  previewResult,
  isPreviewing,
  runPreview,
  error,
}) => {
  const [prompt, setPrompt] = useState(DEFAULT_PRIORITY_PROMPT);
  const [threshold, setThreshold] = useState(0.5);
  const [hasChanges, setHasChanges] = useState(false);

  // Preview state
  const [previewSubject, setPreviewSubject] = useState('');
  const [previewBody, setPreviewBody] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  // Sync from config whenever modal opens or config changes
  useEffect(() => {
    if (!open) return;

    setPrompt(config?.priorityClassificationPrompt ?? DEFAULT_PRIORITY_PROMPT);
    setThreshold(config?.priorityClassificationThreshold ?? 0.5);
    setHasChanges(false);
  }, [config, open]);

  const handleChange = useCallback((updater: () => void) => {
    updater();
    setHasChanges(true);
  }, []);

  const handleSave = useCallback(async () => {
    const payload: SavePriorityConfigPayload = {
      enabled,
      priorityClassificationPrompt: prompt || null,
      priorityClassificationThreshold: threshold,
    };
    await saveConfig(payload);
    setHasChanges(false);
  }, [config, prompt, threshold, saveConfig]);

  const handleCancel = useCallback(() => {
    setPrompt(config?.priorityClassificationPrompt ?? DEFAULT_PRIORITY_PROMPT);
    setThreshold(config?.priorityClassificationThreshold ?? 0.5);
    setHasChanges(false);
  }, [config]);

  const handlePreview = useCallback(async () => {
    if (!previewSubject || !previewBody) return;
    setShowPreview(true);
    try {
      await runPreview(previewSubject, previewBody);
    } catch (err) {
      console.error('Preview failed:', err);
      // Error is already handled in the hook
    }
  }, [previewSubject, previewBody, runPreview]);

  const getPriorityColor = (priority: string): string => {
    switch (priority) {
      case 'CRITICAL':
        return 'text-destructive bg-destructive/10 border-destructive/20';
      case 'HIGH':
        return 'text-orange-500 bg-orange-500/10 border-orange-500/20';
      case 'MEDIUM':
        return 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20';
      case 'LOW':
        return 'text-green-500 bg-green-500/10 border-green-500/20';
      default:
        return 'text-muted-foreground bg-muted/50 border-border';
    }
  };

  const getThresholdDescription = (value: number): string => {
    if (value >= 0.8) return 'Very High - Only high-confidence classifications';
    if (value >= 0.6) return 'High - Conservative (fewer auto-changes)';
    if (value >= 0.4) return 'Balanced - Recommended';
    if (value >= 0.2) return 'Low - More aggressive';
    return 'Very Low - Almost always auto-apply';
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='AI Priority Detection'
      className='max-w-2xl'
    >
      <div className='flex flex-col gap-0 max-h-[85vh]'>
        {/* Header */}
        <div className='flex items-center justify-between px-5 py-4 border-b border-border'>
          <div>
            <div className='text-sm font-semibold text-foreground'>Priority Classification</div>
            <div className='text-xs text-muted-foreground mt-0.5'>
              Configure AI to automatically detect ticket priority from email content.
            </div>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className='text-muted-foreground hover:text-foreground transition-colors'
            data-track-category='PrioritySettings'
            data-track-name='CloseModal'
          >
            <svg width='16' height='16' viewBox='0 0 16 16' fill='none'>
              <path
                d='M12 4L4 12M4 4l8 8'
                stroke='currentColor'
                strokeWidth='1.5'
                strokeLinecap='round'
              />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className='overflow-y-auto p-5 space-y-5 text-foreground'>
          {error && (
            <div className='text-sm text-destructive bg-destructive/10 px-3 py-2 rounded'>
              {error}
            </div>
          )}

          {/* Confidence Threshold */}
          <div className='space-y-3'>
            <div className='flex items-center gap-2'>
              <Gauge className='w-4 h-4 text-muted-foreground' />
              <div className='text-sm font-medium'>Confidence Threshold</div>
            </div>
            <p className='text-xs text-muted-foreground'>
              Minimum confidence required to automatically apply the AI-detected priority. Below
              this threshold, the ticket keeps its default priority.
            </p>

            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium'>{(threshold * 100).toFixed(0)}%</span>
                <span className='text-xs text-muted-foreground'>
                  {getThresholdDescription(threshold)}
                </span>
              </div>
              <input
                type='range'
                min='0'
                max='1'
                step='0.05'
                value={threshold}
                onChange={e => handleChange(() => setThreshold(parseFloat(e.target.value)))}
                className='w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-[#6276be]'
                data-track-category='PrioritySettings'
                data-track-name='ThresholdSlider'
              />
              <div className='flex justify-between text-xs text-muted-foreground'>
                <span>0% (Always)</span>
                <span>50% (Balanced)</span>
                <span>100% (Never)</span>
              </div>
            </div>

            {threshold > 0.7 && (
              <div className='flex items-start gap-2 text-xs text-yellow-500 bg-yellow-500/10 p-2 rounded'>
                <AlertTriangle className='w-4 h-4 shrink-0 mt-0.5' />
                <span>
                  High threshold means fewer tickets will have their priority auto-adjusted by AI.
                </span>
              </div>
            )}
            {threshold < 0.3 && (
              <div className='flex items-start gap-2 text-xs text-orange-500 bg-orange-500/10 p-2 rounded'>
                <AlertTriangle className='w-4 h-4 shrink-0 mt-0.5' />
                <span>Low threshold may result in AI adjusting priority even when uncertain.</span>
              </div>
            )}
          </div>

          {/* Classification prompt */}
          <div className='space-y-2'>
            <div className='text-sm font-medium flex items-center gap-2'>
              <Sparkles className='w-4 h-4 text-muted-foreground' />
              Classification Prompt
            </div>
            <p className='text-xs text-muted-foreground'>
              Customize the AI prompt. Use {'{{subject}}'} and {'{{body}}'} as placeholders.
            </p>
            <textarea
              className='w-full rounded border border-border bg-background px-3 py-2 text-sm font-mono text-foreground min-h-[240px] resize-y'
              value={prompt}
              onChange={e => handleChange(() => setPrompt(e.target.value))}
              placeholder='Enter the AI priority classification prompt...'
              spellCheck={false}
              data-track-category='PrioritySettings'
              data-track-name='PromptTextarea'
            />
            <button
              onClick={() => handleChange(() => setPrompt(DEFAULT_PRIORITY_PROMPT))}
              className='text-xs text-[#6276be] hover:underline'
              data-track-category='PrioritySettings'
              data-track-name='ResetToDefaultPrompt'
            >
              Reset to default prompt
            </button>
          </div>

          {/* Save / Cancel */}
          {hasChanges && (
            <div className='flex gap-2'>
              <button
                onClick={() => void handleSave()}
                disabled={isSaving}
                className='text-sm px-4 py-1.5 rounded bg-[#6276be] text-white hover:bg-[#4f62a8] disabled:opacity-50 transition-colors'
                data-track-category='PrioritySettings'
                data-track-name='SaveConfig'
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={handleCancel}
                disabled={isSaving}
                className='text-sm px-4 py-1.5 rounded border border-border hover:bg-secondary text-foreground transition-colors'
                data-track-category='PrioritySettings'
                data-track-name='CancelChanges'
              >
                Cancel
              </button>
            </div>
          )}

          {/* Preview section */}
          <div className='border-t border-border pt-5 space-y-3'>
            <div className='text-sm font-medium flex items-center gap-2'>
              <Sparkles className='w-4 h-4 text-muted-foreground' />
              Preview Classification
            </div>
            <p className='text-xs text-muted-foreground'>
              Test the priority detection with sample email content.
            </p>

            <div className='space-y-3'>
              <div className='space-y-1'>
                <label htmlFor='preview-subject' className='text-xs text-muted-foreground'>
                  Subject
                </label>
                <input
                  id='preview-subject'
                  className='w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground'
                  value={previewSubject}
                  onChange={e => setPreviewSubject(e.target.value)}
                  placeholder='e.g. URGENT: Production outage affecting payments'
                  data-track-category='PrioritySettings'
                  data-track-name='PreviewSubjectInput'
                />
              </div>
              <div className='space-y-1'>
                <label htmlFor='preview-body' className='text-xs text-muted-foreground'>
                  Email Body
                </label>
                <textarea
                  id='preview-body'
                  className='w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground min-h-[100px] resize-y'
                  value={previewBody}
                  onChange={e => setPreviewBody(e.target.value)}
                  placeholder='Enter email content to test priority detection...'
                  data-track-category='PrioritySettings'
                  data-track-name='PreviewBodyTextarea'
                />
              </div>
              <button
                onClick={() => void handlePreview()}
                disabled={isPreviewing || !previewSubject || !previewBody}
                className='text-sm px-4 py-1.5 rounded bg-[#6276be] text-white hover:bg-[#4f62a8] disabled:opacity-50 transition-colors'
                data-track-category='PrioritySettings'
                data-track-name='RunPreview'
              >
                {isPreviewing ? 'Analyzing...' : 'Run Preview'}
              </button>
            </div>

            {/* Preview result */}
            {showPreview && previewResult && (
              <div className='space-y-2 mt-3'>
                <div className='text-sm font-medium'>Result</div>
                <div
                  className={`rounded-lg border p-3 space-y-2 ${getPriorityColor(
                    previewResult.priority,
                  )}`}
                >
                  <div className='flex items-center gap-3'>
                    <span className='text-lg font-bold'>{previewResult.priority}</span>
                    <span className='text-xs opacity-75'>
                      Confidence: {(previewResult.confidence * 100).toFixed(1)}%
                    </span>
                    {previewResult.confidence >= threshold ? (
                      <span className='inline-flex items-center gap-1 text-xs text-green-500'>
                        <CheckCircle className='w-3 h-3' />
                        Would auto-apply
                      </span>
                    ) : (
                      <span className='inline-flex items-center gap-1 text-xs text-muted-foreground'>
                        <Info className='w-3 h-3' />
                        Below threshold
                      </span>
                    )}
                  </div>
                  <p className='text-sm opacity-90'>{previewResult.reasoning}</p>
                </div>
              </div>
            )}

            {showPreview && !previewResult && !isPreviewing && (
              <div className='text-sm text-muted-foreground'>
                No result. Click Run Preview to test.
              </div>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
};
