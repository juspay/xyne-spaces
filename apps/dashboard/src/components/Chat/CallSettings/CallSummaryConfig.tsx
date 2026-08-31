import { ArrowLeft, Loader2, Pencil, SendHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DEFAULT_SUMMARY_FIELDS, SUMMARY_PROMPT_MAX_LENGTH } from '@xyne/shared';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { callSummaryApi } from '../../../api/callSummaryApi';
import { Dialog } from '../../ui/Dialog/Dialog';
import { Button } from '../../ui/Button/Button';
import { posthogService } from '../../../services/Analytics/posthogService';
import { SummaryCanvasPreview } from './SummaryCanvasPreview';

const AI_WORDS = [
  'Cooking',
  'Brewing',
  'Tinkering',
  'Crafting',
  'Composing',
  'Polishing',
  'Refining',
];

export interface CallSummaryConfigProps {
  channelId: string;
  currentPrompt: string | null | undefined;
  canManage: boolean;
  onBack?: () => void;
}

export const CallSummaryConfig: React.FC<CallSummaryConfigProps> = ({
  channelId,
  currentPrompt,
  canManage,
  onBack,
}) => {
  const zero = useZero();
  const savedPrompt = currentPrompt ?? DEFAULT_SUMMARY_FIELDS;
  const [draft, setDraft] = useState<string>(savedPrompt);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiWordIndex, setAiWordIndex] = useState(0);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const aiInputRef = useRef<HTMLInputElement>(null);
  const syncingRef = useRef(false);

  const isDefault = !currentPrompt || currentPrompt.trim() === '';
  const dirty = draft !== savedPrompt;

  useEffect(() => {
    setDraft(savedPrompt);
    setAiInstruction('');
    setExpanded(false);
  }, [savedPrompt]);

  const handleOpenChange = (open: boolean): void => {
    if (!open) {
      setDraft(savedPrompt);
      setAiInstruction('');
    }
    setExpanded(open);
  };

  useEffect(() => {
    if (!expanded) return;
    const t = setTimeout(() => aiInputRef.current?.focus(), 80);
    return (): void => clearTimeout(t);
  }, [expanded]);

  useEffect(() => {
    if (!aiLoading) return;
    setAiWordIndex(0);
    const id = setInterval(() => setAiWordIndex(i => (i + 1) % AI_WORDS.length), 1400);
    return (): void => clearInterval(id);
  }, [aiLoading]);

  const aiOverlay = aiLoading ? (
    <div className='absolute inset-0 z-10 flex items-center justify-center rounded-[10px] bg-background/50 backdrop-blur-sm'>
      <div className='flex items-center gap-2 text-sm font-medium text-foreground'>
        <Loader2 size={16} className='animate-spin text-primary' />
        <span>{AI_WORDS[aiWordIndex]}…</span>
      </div>
    </div>
  ) : null;

  const handleSave = async (): Promise<void> => {
    if (!canManage) return;
    const next = draft.trim() === '' || draft === DEFAULT_SUMMARY_FIELDS ? null : draft;
    if (next && next.length > SUMMARY_PROMPT_MAX_LENGTH) {
      toast.error(
        `Template must be ${SUMMARY_PROMPT_MAX_LENGTH.toLocaleString()} characters or less`,
      );
      return;
    }
    setSaving(true);
    try {
      const mutation = zero.mutate(
        mutators.channel.updateCallSummaryPrompt({ channelId, prompt: next }),
      );
      const serverRes = await mutation.server;
      if (serverRes.type === 'error') {
        posthogService.captureActionOutcome('save_call_summary_prompt', 'failure');
        toast.error(serverRes.error.message || 'Failed to save call summary settings');
        return;
      }
      posthogService.captureActionOutcome('save_call_summary_prompt', 'success');
      toast.success('Call summary settings saved');
      setExpanded(false);
    } catch {
      posthogService.captureActionOutcome('save_call_summary_prompt', 'failure');
      toast.error('Failed to save call summary settings');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = (): void => {
    setDraft(DEFAULT_SUMMARY_FIELDS);
  };

  const handleEditWithAI = async (): Promise<void> => {
    const instruction = aiInstruction.trim();
    if (!instruction || aiLoading) return;
    setAiLoading(true);
    try {
      const updated = await callSummaryApi.editPromptWithAI(channelId, draft, instruction);
      setDraft(updated);
      setAiInstruction('');
      posthogService.captureActionOutcome('edit_call_summary_with_ai', 'success');
      toast.success('Template updated with AI');
    } catch (error) {
      posthogService.captureActionOutcome('edit_call_summary_with_ai', 'failure');
      toast.error(error instanceof Error ? error.message : 'AI edit failed. Try again.');
    } finally {
      setAiLoading(false);
      setTimeout(() => aiInputRef.current?.focus(), 0);
    }
  };

  const syncScroll = (src: HTMLElement | null, tgt: HTMLElement | null): void => {
    if (!src || !tgt || syncingRef.current) return;
    syncingRef.current = true;
    const srcMax = src.scrollHeight - src.clientHeight;
    const tgtMax = tgt.scrollHeight - tgt.clientHeight;
    tgt.scrollTop = srcMax > 0 ? (src.scrollTop / srcMax) * tgtMax : 0;
    requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  };

  return (
    <div className='flex flex-col gap-[16px] p-4'>
      {onBack && (
        <button
          type='button'
          className='flex items-center gap-[6px] text-sm text-foreground'
          onClick={onBack}
          data-track-category='CallSummary'
          data-track-name='BackFromCallSummary'
        >
          <ArrowLeft size={16} />
          Call settings
        </button>
      )}

      <div className='flex flex-col gap-1'>
        <div className='text-sm font-medium text-foreground'>Detailed call summary</div>
        <p className='text-[13px] leading-[140%] text-muted-foreground'>
          Preview of the sections included in each call&apos;s detailed summary. Use Edit to
          customize them.
        </p>
      </div>

      <div className='relative'>
        <div className='thin-scrollbar h-[240px] overflow-y-auto rounded-[10px] border border-border bg-background py-3'>
          {savedPrompt.trim() ? (
            <SummaryCanvasPreview markdown={savedPrompt} />
          ) : (
            <p className='px-6 text-muted-foreground'>Nothing to preview.</p>
          )}
        </div>
        {canManage && (
          <button
            type='button'
            onClick={() => handleOpenChange(true)}
            className='absolute bottom-3 right-3 inline-flex items-center gap-2 rounded-[10px] border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-muted/40'
            title='Edit'
            data-track-category='CallSummary'
            data-track-name='OpenCallSummaryEditor'
          >
            <Pencil size={16} />
            Edit
          </button>
        )}
      </div>

      <Dialog
        open={expanded}
        onOpenChange={handleOpenChange}
        focusRef={aiInputRef}
        className='w-[85vw] max-w-[85vw] h-[85vh] rounded-2xl'
      >
        <div className='flex h-[85vh] flex-col gap-3 p-4'>
          <div className='flex items-center justify-between'>
            <div className='text-sm font-medium text-foreground'>Edit detailed call summary</div>
            <button
              type='button'
              onClick={() => handleOpenChange(false)}
              className='rounded-[8px] p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground'
              aria-label='Close'
              data-track-category='CallSummary'
              data-track-name='CloseCallSummaryEditor'
            >
              <X size={18} />
            </button>
          </div>

          <div className='flex min-h-0 flex-1 gap-3'>
            <div className='flex min-w-0 flex-1 flex-col gap-1'>
              <div className='text-xs font-medium text-muted-foreground'>Editor</div>
              <div className='relative min-h-0 flex-1'>
                <textarea
                  ref={editorRef}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onScroll={() => syncScroll(editorRef.current, previewRef.current)}
                  placeholder={DEFAULT_SUMMARY_FIELDS}
                  maxLength={SUMMARY_PROMPT_MAX_LENGTH}
                  spellCheck={false}
                  readOnly={!canManage || aiLoading}
                  className='thin-scrollbar h-full w-full resize-none rounded-[10px] border border-border bg-background px-3 py-2 font-mono text-[13px] leading-[150%] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary read-only:cursor-default read-only:bg-muted/40 read-only:focus:ring-0'
                  data-track-category='CallSummary'
                  data-track-name='EditSummaryDraft'
                />
                {aiOverlay}
              </div>
            </div>
            <div className='flex min-w-0 flex-1 flex-col gap-1'>
              <div className='text-xs font-medium text-muted-foreground'>Preview</div>
              <div className='relative min-h-0 flex-1'>
                <div
                  ref={previewRef}
                  onScroll={() => syncScroll(previewRef.current, editorRef.current)}
                  className='thin-scrollbar h-full overflow-y-auto rounded-[10px] border border-border bg-background py-4'
                >
                  {draft.trim() ? (
                    <SummaryCanvasPreview markdown={draft} />
                  ) : (
                    <p className='px-6 text-muted-foreground'>Nothing to preview.</p>
                  )}
                </div>
                {aiOverlay}
              </div>
            </div>
          </div>

          {canManage && (
            <div className='flex items-center'>
              <div className='flex flex-1 justify-center'>
                <div className='relative w-[340px]'>
                  <input
                    ref={aiInputRef}
                    type='text'
                    value={aiInstruction}
                    onChange={e => setAiInstruction(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleEditWithAI();
                      }
                    }}
                    placeholder='Describe what you want to change here'
                    disabled={aiLoading}
                    className='w-full rounded-[10px] border border-border bg-background py-2 pl-3 pr-10 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50'
                    data-track-category='CallSummary'
                    data-track-name='EditWithAIInput'
                  />
                  <Button
                    variant='ghost'
                    type='button'
                    onClick={() => void handleEditWithAI()}
                    disabled={!aiInstruction.trim() || aiLoading}
                    aria-label='Edit with AI'
                    className='absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-primary hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-40'
                    trackId='edit_call_summary_with_ai'
                    data-track-category='CallSummary'
                    data-track-name='EditWithAI'
                  >
                    {aiLoading ? (
                      <Loader2 size={16} className='animate-spin' />
                    ) : (
                      <SendHorizontal size={16} />
                    )}
                  </Button>
                </div>
              </div>
              <div className='flex flex-1 items-center justify-center gap-4'>
                <button
                  type='button'
                  onClick={handleReset}
                  disabled={isDefault && draft === DEFAULT_SUMMARY_FIELDS}
                  className='w-fit text-xs text-primary hover:underline disabled:opacity-40 disabled:no-underline'
                  data-track-category='CallSummary'
                  data-track-name='ResetCallSummary'
                >
                  Reset to default
                </button>
                <Button
                  variant='default'
                  type='button'
                  onClick={() => void handleSave()}
                  disabled={!dirty || saving}
                  className='inline-flex items-center rounded-[10px] bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50'
                  trackId='save_call_summary_prompt'
                  data-track-category='CallSummary'
                  data-track-name='SaveCallSummary'
                >
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
};
