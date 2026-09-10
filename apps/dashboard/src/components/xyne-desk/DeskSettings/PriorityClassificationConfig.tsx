import { ArrowLeft, Gauge, Sparkles, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { useState } from 'react';
import { TestClassificationForm } from './TestClassificationForm';
import { DEFAULT_PRIORITY_PROMPT } from './constants';
import type { PriorityClassificationPreviewResult } from '../../../types/priorityClassification';

export function getPriorityColor(priority: string): string {
  switch (priority) {
    case 'CRITICAL':
      return 'text-red-600 bg-red-50 border-red-200';
    case 'HIGH':
      return 'text-orange-600 bg-orange-50 border-orange-200';
    case 'MEDIUM':
      return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    case 'LOW':
      return 'text-green-600 bg-green-50 border-green-200';
    default:
      return 'text-gray-600 bg-gray-50 border-gray-200';
  }
}

export function getThresholdDescription(value: number): string {
  if (value >= 0.8) return 'Very High - Only high-confidence classifications';
  if (value >= 0.6) return 'High - Conservative (fewer auto-changes)';
  if (value >= 0.4) return 'Balanced - Recommended';
  if (value >= 0.2) return 'Low - More aggressive';
  return 'Very Low - Almost always auto-apply';
}

export interface PriorityClassificationConfigPanelProps {
  canManage: boolean;
  onBack: () => void;
  prompt: string;
  setPrompt: (value: string) => void;
  threshold: number;
  setThreshold: (value: number) => void;
  previewResult: PriorityClassificationPreviewResult | null;
  isPreviewing: boolean;
  runPreview: (emailSubject: string, emailBody: string) => Promise<void>;
  error: string | null;
}

export const PriorityClassificationConfigPanel: React.FC<
  PriorityClassificationConfigPanelProps
> = ({
  canManage,
  onBack,
  prompt,
  setPrompt,
  threshold,
  setThreshold,
  previewResult,
  isPreviewing,
  runPreview,
  error,
}) => {
  const [previewSubject, setPreviewSubject] = useState('');
  const [previewBody, setPreviewBody] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const handleRunPreview = () => {
    if (!previewSubject.trim() || !previewBody.trim()) return;
    setShowPreview(true);
    void runPreview(previewSubject, previewBody);
  };

  const fieldDisabled = !canManage;

  return (
    <div className='flex flex-col gap-[16px]'>
      <button
        type='button'
        className='text-desk-label flex items-center gap-[6px]'
        onClick={onBack}
        data-track-category='DeskSettings'
        data-track-name='BackFromPriorityConfig'
      >
        <ArrowLeft size={16} />
        Configure AI Priority Detection
      </button>

      <p className='text-desk-helper'>
        Configure AI to automatically detect ticket priority from email content.
      </p>

      {error && (
        <div className='text-[14px] font-[450] leading-[120%] tracking-[-0.1px] text-destructive bg-destructive/10 px-3 py-2 rounded-[10px]'>
          {error}
        </div>
      )}

      <div className='flex flex-col gap-3'>
        <div className='flex items-center gap-2'>
          <Gauge size={16} className='text-muted-foreground' />
          <div className='text-desk-label'>Confidence Threshold</div>
        </div>
        <p className='text-desk-helper'>
          Minimum confidence required to automatically apply the AI-detected priority. Below this
          threshold, the ticket keeps its default priority.
        </p>
        <div className='space-y-2'>
          <div className='flex items-center justify-between'>
            <span className='text-desk-label'>{(threshold * 100).toFixed(0)}%</span>
            <span className='text-desk-helper'>{getThresholdDescription(threshold)}</span>
          </div>
          <input
            type='range'
            min={0}
            max={1}
            step={0.05}
            value={threshold}
            onChange={e => setThreshold(parseFloat(e.target.value))}
            disabled={fieldDisabled}
            className='h-2 w-full cursor-pointer appearance-none rounded-lg bg-secondary accent-desk-accent disabled:cursor-not-allowed disabled:opacity-50'
            data-track-category='DeskSettings'
            data-track-name='PriorityThresholdSlider'
          />
          <div className='text-desk-helper flex justify-between'>
            <span>0% (Always)</span>
            <span>50% (Balanced)</span>
            <span>100% (Never)</span>
          </div>
        </div>
        {threshold > 0.7 && (
          <div className='flex items-start gap-2 text-xs text-yellow-600 bg-yellow-50 dark:text-yellow-300 dark:bg-yellow-900/20 p-2 rounded-[10px]'>
            <AlertTriangle size={16} className='shrink-0 mt-0.5' />
            <span>
              High threshold means fewer tickets will have their priority auto-adjusted by AI.
            </span>
          </div>
        )}
        {threshold < 0.3 && (
          <div className='flex items-start gap-2 text-xs text-orange-600 bg-orange-50 dark:text-orange-300 dark:bg-orange-900/20 p-2 rounded-[10px]'>
            <AlertTriangle size={16} className='shrink-0 mt-0.5' />
            <span>Low threshold may result in AI adjusting priority even when uncertain.</span>
          </div>
        )}
      </div>

      <div className='flex flex-col gap-2'>
        <label htmlFor='priority-prompt' className='text-desk-label flex items-center gap-2'>
          <Sparkles size={16} className='text-muted-foreground' />
          Classification Prompt
        </label>
        <p className='text-desk-helper'>
          Customize the AI prompt. Use {'{{subject}}'} and {'{{body}}'} as placeholders.
        </p>
        <textarea
          id='priority-prompt'
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder='Enter the AI priority classification prompt...'
          spellCheck={false}
          readOnly={fieldDisabled}
          disabled={fieldDisabled}
          className='min-h-[240px] w-full resize-y rounded-[10px] border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-desk-accent disabled:opacity-50 read-only:cursor-default read-only:bg-muted/40 read-only:focus:ring-0'
          data-track-category='DeskSettings'
          data-track-name='PriorityPrompt'
        />
        {canManage && (
          <button
            type='button'
            onClick={() => setPrompt(DEFAULT_PRIORITY_PROMPT)}
            className='w-fit text-xs text-desk-accent hover:underline'
            data-track-category='DeskSettings'
            data-track-name='ResetPriorityPrompt'
          >
            Reset to default prompt
          </button>
        )}
      </div>

      <TestClassificationForm
        title='Preview Classification'
        subjectLabel='Subject'
        bodyLabel='Email Body'
        subjectPlaceholder='e.g. URGENT: Production outage affecting payments'
        bodyPlaceholder='Enter email content to test priority detection...'
        subjectValue={previewSubject}
        onSubjectChange={setPreviewSubject}
        bodyValue={previewBody}
        onBodyChange={setPreviewBody}
        isPreviewing={isPreviewing}
        onRunPreview={handleRunPreview}
        runButtonLabel='Run Preview'
        runningButtonLabel='Analyzing…'
        subjectTrackName='PriorityPreviewSubject'
        bodyTrackName='PriorityPreviewBody'
        runTrackName='RunPriorityPreview'
      >
        {showPreview && previewResult && (
          <div className='space-y-2'>
            <div className='text-sm font-medium text-foreground'>Result</div>
            <div
              className={`rounded-[10px] border p-3 space-y-2 ${getPriorityColor(previewResult.priority)}`}
            >
              <div className='flex flex-wrap items-center gap-3'>
                <span className='text-lg font-bold'>{previewResult.priority}</span>
                <span className='text-xs opacity-75'>
                  Confidence: {(previewResult.confidence * 100).toFixed(1)}%
                </span>
                {previewResult.confidence >= threshold ? (
                  <span className='inline-flex items-center gap-1 text-xs text-green-600'>
                    <CheckCircle size={12} />
                    Would auto-apply
                  </span>
                ) : (
                  <span className='inline-flex items-center gap-1 text-xs text-gray-600'>
                    <Info size={12} />
                    Below threshold
                  </span>
                )}
              </div>
              <p className='text-sm opacity-90'>{previewResult.reasoning}</p>
            </div>
          </div>
        )}

        {showPreview && !previewResult && !isPreviewing && (
          <p className='text-desk-helper'>No result. Click Run Preview to test.</p>
        )}
      </TestClassificationForm>
    </div>
  );
};
