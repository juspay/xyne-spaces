import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ArrowLeft, Spinner } from '@xyne/icons';
import { SUMMARY_TEMPLATE_SELECTION_MAX_TRANSCRIPT_CHARS } from '@xyne/shared';
import { XyneAIStar } from '../../../components/icons/xyne-ai';
import { Button } from '../../../components/ui/Button/Button';
import {
  recordingService,
  type SummaryTemplateSelectionDraft,
  type SummaryTemplateSelectionTestResult,
} from '../../../services/Recording/recordingService';
import { cn } from '../../../utils/classNames';
import { getApiErrorMessage } from '../../../utils/apiError';

type InputMode = 'paste' | 'upload';

const INPUT_MODES: Array<{ value: InputMode; label: string }> = [
  { value: 'paste', label: 'Paste' },
  { value: 'upload', label: 'Upload' },
];

const TRANSCRIPT_FILE_ACCEPT = '.txt,.vtt,.srt,.md,text/plain,text/vtt,text/markdown';
const MAX_TRANSCRIPT_LENGTH = SUMMARY_TEMPLATE_SELECTION_MAX_TRANSCRIPT_CHARS;
// Enough bytes for MAX_TRANSCRIPT_LENGTH characters even if every one is 4-byte UTF-8.
const MAX_TRANSCRIPT_READ_BYTES = MAX_TRANSCRIPT_LENGTH * 4;
const TRUNCATION_NOTE = `Only the first ${MAX_TRANSCRIPT_LENGTH.toLocaleString()} characters are used, the same as for real recordings.`;

const getFallbackReasonLabel = (reason: string | null): string => {
  if (reason === 'no_templates') return 'No templates are available in this workspace.';
  if (reason === 'invalid_selection') return 'The AI did not return a valid template.';
  return 'The AI selection failed, so the default template would be used.';
};

type TestOutcome = { result: SummaryTemplateSelectionTestResult } | { error: string };

interface SummaryTemplateSelectionTestPanelProps {
  draft: SummaryTemplateSelectionDraft;
  onClose: () => void;
}

export function SummaryTemplateSelectionTestPanel({
  draft,
  onClose,
}: SummaryTemplateSelectionTestPanelProps): ReactElement {
  const [mode, setMode] = useState<InputMode>('paste');
  const [pastedTranscript, setPastedTranscript] = useState('');
  const [pasteTruncated, setPasteTruncated] = useState(false);
  const [uploaded, setUploaded] = useState<{
    name: string;
    text: string;
    truncated: boolean;
  } | null>(null);
  const [runningMode, setRunningMode] = useState<InputMode | null>(null);
  const [outcomes, setOutcomes] = useState<Partial<Record<InputMode, TestOutcome>>>({});
  const outcome = outcomes[mode];
  const clearOutcome = (forMode: InputMode): void =>
    setOutcomes(current => ({ ...current, [forMode]: undefined }));
  const fileInputRef = useRef<HTMLInputElement>(null);
  // A result only describes the draft it was run against, so any edit invalidates it.
  const draftKey = JSON.stringify(draft);
  const draftKeyRef = useRef(draftKey);

  useEffect(() => {
    draftKeyRef.current = draftKey;
    setOutcomes({});
  }, [draftKey]);

  const handleFileChange = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      // Read only as much as the prompt can use, so large files never load in full.
      const text = await file.slice(0, MAX_TRANSCRIPT_READ_BYTES).text();
      setUploaded({
        name: file.name,
        text: text.slice(0, MAX_TRANSCRIPT_LENGTH),
        truncated: file.size > MAX_TRANSCRIPT_READ_BYTES || text.length > MAX_TRANSCRIPT_LENGTH,
      });
      clearOutcome('upload');
    } catch {
      setUploaded(null);
      setOutcomes(current => ({
        ...current,
        upload: { error: 'Unable to read this file. Try another transcript.' },
      }));
    }
  };

  const input =
    mode === 'paste'
      ? pastedTranscript.trim()
        ? { transcript: pastedTranscript.trim() }
        : null
      : uploaded?.text.trim()
        ? { transcript: uploaded.text.trim() }
        : null;

  const hasMeetingContext = Boolean(draft.autoTriggerPrompt?.trim());

  const runTest = async (): Promise<void> => {
    if (!input || !hasMeetingContext || runningMode) return;
    const testedMode = mode;
    const testedDraftKey = draftKey;
    setRunningMode(testedMode);
    clearOutcome(testedMode);
    let next: TestOutcome;
    try {
      next = { result: await recordingService.testSummaryTemplateSelection({ ...input, draft }) };
    } catch (err) {
      next = { error: getApiErrorMessage(err, 'Unable to test template selection.') };
    }
    if (draftKeyRef.current === testedDraftKey) {
      setOutcomes(current => ({ ...current, [testedMode]: next }));
    }
    setRunningMode(null);
  };

  return (
    <aside
      className='flex w-96 shrink-0 flex-col border-l border-border bg-background'
      aria-label='Test template selection'
    >
      <div className='flex h-12 shrink-0 items-center gap-1.5 px-2.5 pt-2'>
        <Button
          type='button'
          variant='ghost'
          size='iconSm'
          onClick={onClose}
          className='rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground'
          aria-label='Close template selection test'
          data-track-category='SummaryTemplates'
          data-track-name='CloseSelectionTest'
        >
          <ArrowLeft className='size-4' />
        </Button>
        <h3 className='text-sm font-semibold'>Test template selection</h3>
      </div>

      <div className='thin-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 pt-1'>
        <p className='text-xs text-muted-foreground'>
          Give Xyne a transcript and see which template it would pick automatically. Your current
          edits are included, even if they aren&apos;t saved yet.
        </p>

        {!hasMeetingContext && (
          <div className='flex flex-col gap-1 rounded-xl bg-muted/50 p-3' role='status'>
            <p className='text-sm font-medium text-status-pending'>Add a Meeting Context first</p>
            <p className='text-xs text-muted-foreground'>
              Xyne picks templates by their Meeting Context, so this template can&apos;t be tested
              without one.
            </p>
          </div>
        )}

        <div className='flex divide-x divide-border overflow-hidden rounded-lg border border-border bg-background'>
          {INPUT_MODES.map(option => (
            <button
              key={option.value}
              type='button'
              onClick={() => setMode(option.value)}
              className={cn(
                'flex h-8 flex-1 items-center justify-center px-2 text-xs font-medium leading-none text-foreground transition-colors hover:bg-muted/60',
                mode === option.value && 'bg-foreground/10 hover:bg-foreground/10',
              )}
              aria-pressed={mode === option.value}
              data-track-category='SummaryTemplates'
              data-track-name={`SelectionTestInput_${option.value}`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {mode === 'paste' && (
          <textarea
            value={pastedTranscript}
            onChange={event => {
              const { value } = event.target;
              setPastedTranscript(value.slice(0, MAX_TRANSCRIPT_LENGTH));
              setPasteTruncated(value.length > MAX_TRANSCRIPT_LENGTH);
              clearOutcome('paste');
            }}
            rows={10}
            placeholder='Paste a meeting transcript…'
            className='min-h-48 w-full resize-y rounded-xl bg-muted/50 px-3 py-2.5 text-sm leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-border placeholder:text-muted-foreground/60'
            data-track-category='SummaryTemplates'
            data-track-name='EditSelectionTestTranscript'
          />
        )}
        {mode === 'paste' && pasteTruncated && (
          <p className='-mt-2 text-xs text-muted-foreground'>{TRUNCATION_NOTE}</p>
        )}

        {mode === 'upload' && (
          <div className='flex flex-col gap-2'>
            <input
              ref={fileInputRef}
              type='file'
              accept={TRANSCRIPT_FILE_ACCEPT}
              className='hidden'
              onChange={event => {
                void handleFileChange(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <Button
              type='button'
              variant='outline'
              onClick={() => fileInputRef.current?.click()}
              className='h-20 w-full rounded-xl border-0 bg-muted/50 text-sm text-muted-foreground shadow-none hover:bg-muted'
            >
              {uploaded ? uploaded.name : 'Choose a .txt, .vtt, .srt or .md file'}
            </Button>
            {uploaded && (
              <p className='text-xs text-muted-foreground'>
                {uploaded.truncated
                  ? TRUNCATION_NOTE
                  : `${uploaded.text.length.toLocaleString()} characters loaded`}
              </p>
            )}
          </div>
        )}

        <Button
          type='button'
          onClick={() => void runTest()}
          disabled={!input || !hasMeetingContext || runningMode !== null}
          className='h-9 gap-1.5 rounded-lg text-sm font-semibold'
          data-track-category='SummaryTemplates'
          data-track-name='RunSelectionTest'
          data-track-metadata={JSON.stringify({ templateId: draft.id, inputMode: mode })}
        >
          {runningMode === mode ? (
            <Spinner className='size-3.5 animate-spin' />
          ) : (
            <XyneAIStar size={13} />
          )}
          {runningMode === mode ? 'Testing…' : 'Test now'}
        </Button>

        {outcome && 'error' in outcome && (
          <p className='text-xs text-status-failure'>{outcome.error}</p>
        )}

        {outcome && 'result' in outcome && <SelectionResult result={outcome.result} />}
      </div>
    </aside>
  );
}

function SelectionResult({ result }: { result: SummaryTemplateSelectionTestResult }): ReactElement {
  const pickedThis = result.selectedDraft;
  const title = result.fellBack
    ? 'Fell back to the default template'
    : pickedThis
      ? 'This template was selected'
      : `Another template was selected: ${result.selectedTemplateName ?? 'Unknown'}`;
  const detail = result.fellBack
    ? getFallbackReasonLabel(result.reason)
    : pickedThis
      ? 'Recordings like this one will be summarized with this template.'
      : 'Try making the Meeting Context more specific to this kind of meeting.';

  return (
    <div className='flex flex-col gap-1 rounded-xl bg-muted/50 p-3' aria-live='polite'>
      <p
        className={cn(
          'text-sm font-semibold',
          result.fellBack
            ? 'text-status-pending'
            : pickedThis
              ? 'text-status-success'
              : 'text-foreground',
        )}
      >
        {title}
      </p>
      <p className='text-xs text-muted-foreground'>{detail}</p>
    </div>
  );
}
