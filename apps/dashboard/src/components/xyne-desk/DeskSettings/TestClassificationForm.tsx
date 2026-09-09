import { Play } from 'lucide-react';
import type { ReactNode } from 'react';

export interface TestClassificationFormProps {
  title: string;
  subjectLabel?: string;
  bodyLabel?: string;
  subjectPlaceholder?: string;
  bodyPlaceholder?: string;
  subjectValue: string;
  onSubjectChange: (value: string) => void;
  bodyValue: string;
  onBodyChange: (value: string) => void;
  isPreviewing: boolean;
  onRunPreview: () => void;
  runButtonLabel?: string;
  runningButtonLabel?: string;
  trackCategory?: string;
  subjectTrackName?: string;
  bodyTrackName?: string;
  runTrackName?: string;
  children?: ReactNode;
}

export const TestClassificationForm: React.FC<TestClassificationFormProps> = ({
  title,
  subjectLabel = 'Email Subject',
  bodyLabel = 'Email body',
  subjectPlaceholder = 'Type your email subject',
  bodyPlaceholder = 'Type your email body',
  subjectValue,
  onSubjectChange,
  bodyValue,
  onBodyChange,
  isPreviewing,
  onRunPreview,
  runButtonLabel = 'Run preview',
  runningButtonLabel = 'Running…',
  trackCategory = 'DeskSettings',
  subjectTrackName,
  bodyTrackName,
  runTrackName,
  children,
}) => {
  return (
    <div className='rounded-[10px] p-4 space-y-4 bg-muted/50 dark:bg-muted/20'>
      <div className='text-desk-helper'>{title}</div>
      <div className='flex flex-col gap-[8px]'>
        <label htmlFor={`test-classification-subject-${title}`} className='text-desk-label'>
          {subjectLabel}
        </label>
        <input
          id={`test-classification-subject-${title}`}
          type='text'
          value={subjectValue}
          onChange={e => onSubjectChange(e.target.value)}
          placeholder={subjectPlaceholder}
          className='w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-desk-helper focus:outline-none focus:ring-1 focus:ring-desk-accent'
          data-track-category={trackCategory}
          data-track-name={subjectTrackName}
        />
      </div>
      <div className='flex flex-col gap-[8px]'>
        <label htmlFor={`test-classification-body-${title}`} className='text-desk-label'>
          {bodyLabel}
        </label>
        <textarea
          id={`test-classification-body-${title}`}
          value={bodyValue}
          onChange={e => onBodyChange(e.target.value)}
          placeholder={bodyPlaceholder}
          rows={4}
          className='w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-desk-helper focus:outline-none focus:ring-1 focus:ring-desk-accent'
          data-track-category={trackCategory}
          data-track-name={bodyTrackName}
        />
      </div>
      <button
        type='button'
        data-ph-capture-attribute-track-id='run_classification_preview'
        onClick={onRunPreview}
        disabled={isPreviewing || !subjectValue.trim() || !bodyValue.trim()}
        className='flex h-auto items-center gap-1.5 rounded-lg bg-desk-accent px-3 py-1.5 text-sm text-white transition-colors hover:bg-desk-accent-hover disabled:cursor-not-allowed disabled:opacity-50'
        data-track-category={trackCategory}
        data-track-name={runTrackName}
      >
        <Play size={14} />
        {isPreviewing ? runningButtonLabel : runButtonLabel}
      </button>

      {children}
    </div>
  );
};
