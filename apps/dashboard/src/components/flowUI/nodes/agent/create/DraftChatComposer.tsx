import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
} from 'react';
import {
  FileText,
  MultipleCrossCancelDefault as X,
  PlusDefault as Plus,
  SendPlaneSlant,
  Square,
} from '@xyne/icons';
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react';
import { toast } from 'sonner';
import { ComposerVoiceButton } from '@/components/AIScreen/ComposerVoiceButton';
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { DraftChatExtras } from '@/services/claw/draftChat';
import { cn } from '@/utils/classNames';
import { DraftChatPlusMenu } from './DraftChatPlusMenu';
import { useExclusiveMenu } from './useExclusiveMenu';
import { admitDraftFiles, readDraftAttachments } from './draftChatAttachments';
import { DRAFT_CHAT_EASE_OUT } from './draftChatMotion';

const ICON_CLASS =
  'dc-pressable inline-flex size-7 shrink-0 items-center justify-center rounded-full text-foreground/70';
const CONTROL_SIZE = 28;
const CONTROL_GAP = 4;
const TEXTAREA_MIN = 28;
/** Eight lines (20px each, plus py-1), then the text scrolls inside the box. */
const TEXTAREA_MAX = 168;
const TEXTAREA_CLASS =
  'min-h-7 min-w-0 w-full resize-none bg-transparent px-1 text-sm font-[450] tracking-[-0.28px] text-foreground [overflow-wrap:anywhere] placeholder:text-transparent focus:outline-none disabled:cursor-not-allowed';
const RADIUS = 18;
/** The empty box's hint, in the placeholder's type. */
const HINT_CLASS = 'text-sm font-[450] tracking-[-0.28px] text-foreground/40';
/**
 * A hint or status line giving way to the next: the old one lifts away and
 * blurs out, and the new one rises in a beat later, so the two never sit on
 * top of each other at full strength.
 */
const SWAP_IN: Transition = { duration: 0.24, ease: DRAFT_CHAT_EASE_OUT, delay: 0.05 };
const SWAP_OUT: Transition = { duration: 0.12, ease: [0.4, 0, 1, 1] };
const SWAP_FROM = { opacity: 0, y: 8, filter: 'blur(2px)' };
const SWAP_SHOWN = { opacity: 1, y: 0, filter: 'blur(0px)', transitionEnd: { filter: 'none' } };
const SWAP_AWAY = { opacity: 0, y: -8, filter: 'blur(2px)', transition: SWAP_OUT };
const FADE_FROM = { opacity: 0 };
const FADE_AWAY = { opacity: 0, transition: SWAP_OUT };

/**
 * Text that crossfades when it changes ("Thinking" to "Replying"), the two
 * stacked in one cell while they swap. Reduced motion fades without the lift.
 */
function SwapText({
  text,
  className,
  shimmer = false,
}: {
  text: string;
  className?: string;
  /** Sweeps the shimmer over it (draft-chat.css .dc-shimmer). */
  shimmer?: boolean;
}): ReactElement {
  const reduceMotion = useReducedMotion();
  return (
    <span className={cn('inline-grid min-w-0', className)}>
      <AnimatePresence initial={false}>
        <motion.span
          key={text}
          className={cn('truncate [grid-area:1/1]', shimmer && 'dc-shimmer')}
          data-text={shimmer ? text : undefined}
          initial={reduceMotion ? FADE_FROM : SWAP_FROM}
          animate={SWAP_SHOWN}
          exit={reduceMotion ? FADE_AWAY : SWAP_AWAY}
          transition={SWAP_IN}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * What the agent is doing while a reply is on its way, beside its busy avatar:
 * in the open thread, and in the folded bar in place of the placeholder. Set
 * in the thread's body text, with the shimmer sweeping it.
 */
export function ThinkingStatus({
  avatar,
  replying,
}: {
  avatar: ReactNode;
  /** The reply has started to stream. */
  replying: boolean;
}): ReactElement {
  const label = replying ? 'Replying' : 'Thinking';
  return (
    <span className='inline-flex min-w-0 items-center gap-1.5 text-sm font-normal'>
      {avatar}
      <SwapText text={label} shimmer />
    </span>
  );
}

/**
 * The folded bar once a reply has come in while the chat was away: the
 * agent's avatar with an unread dot, and how many replies are waiting, in the
 * same place and type as ThinkingStatus. Opening the chat reads them.
 */
export function UnreadStatus({
  avatar,
  count,
}: {
  avatar: ReactNode;
  count: number;
}): ReactElement {
  return (
    <span className='inline-flex min-w-0 items-center gap-1.5 text-sm font-normal text-foreground'>
      <span className='relative inline-flex shrink-0'>
        {avatar}
        <span
          aria-hidden
          className='absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary ring-2 ring-background'
        />
      </span>
      <SwapText text={`${count} new ${count === 1 ? 'message' : 'messages'}`} />
    </span>
  );
}

/**
 * The Digital Twin ask bar: one line with "+", voice and send while the text
 * fits, then the text takes the full width and the controls drop below it.
 * It grows a line at a time with the text, straight away (no height animation,
 * like ChatGPT's or Claude's box), up to eight lines, then scrolls inside.
 */
export function DraftChatComposer({
  inputId,
  value,
  onValueChange,
  extras,
  onExtrasChange,
  placeholder,
  status,
  statusKey = 'status',
  statusOnly = false,
  pending,
  disabled = false,
  onSend,
  onStop,
}: {
  inputId: string;
  value: string;
  onValueChange: Dispatch<SetStateAction<string>>;
  extras: DraftChatExtras;
  onExtrasChange: Dispatch<SetStateAction<DraftChatExtras>>;
  placeholder: string;
  /**
   * Shown in place of the placeholder while the box is empty: what the agent
   * is doing while the chat is folded away (see ThinkingStatus). The
   * placeholder still names it for screen readers.
   */
  status?: ReactNode;
  /**
   * Which status it is ('working', 'unread'): a new one swaps in like a new
   * placeholder does, while changes within one (its words) animate in place.
   */
  statusKey?: string;
  /**
   * While the status shows, it is all the bar shows: no +, voice or send (an
   * unread reply waiting in the folded bar). Typing brings them back.
   */
  statusOnly?: boolean;
  /** A reply is streaming: send turns into stop. */
  pending: boolean;
  disabled?: boolean;
  onSend: (text: string, extras: DraftChatExtras) => void;
  onStop: () => void;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const plusMenu = useExclusiveMenu();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const canSend = value.trim().length > 0 && !pending && !disabled;
  const reduceMotion = useReducedMotion();
  const showStatus = Boolean(status) && value.length === 0;
  const bare = statusOnly && showStatus;
  // The box's cells, which the status shares: the whole row on its own, else
  // between + and voice.
  const boxCells =
    expanded || bare ? 'col-span-full col-start-1 row-start-1' : 'col-start-2 row-start-1';
  const attachments = extras.attachments;

  const insertSnippet = useCallback(
    (snippet: string): void => {
      const el = inputRef.current;
      if (!el) {
        onValueChange(current => `${current}${snippet}`);
        return;
      }
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      onValueChange(current => `${current.slice(0, start)}${snippet}${current.slice(end)}`);
      requestAnimationFrame(() => {
        el.focus();
        const next = start + snippet.length;
        el.setSelectionRange(next, next);
      });
    },
    [onValueChange],
  );

  const submit = useCallback((): void => {
    const text = value.trim();
    if (!text || pending || disabled) return;
    onSend(text, extras);
    onValueChange('');
  }, [disabled, extras, onSend, onValueChange, pending, value]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const picked = Array.from(event.target.files ?? []);
    // Clear so picking the same file again still fires change.
    event.target.value = '';
    const { admitted, problem } = admitDraftFiles(picked, attachments);
    if (problem) toast.error(problem, { duration: 3000 });
    if (admitted.length === 0) return;
    try {
      const read = await readDraftAttachments(admitted);
      onExtrasChange(current => ({ ...current, attachments: [...current.attachments, ...read] }));
      inputRef.current?.focus();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not read those files.', {
        duration: 3000,
      });
    }
  };

  const removeAttachment = (id: string): void => {
    onExtrasChange(current => ({
      ...current,
      attachments: current.attachments.filter(file => file.id !== id),
    }));
  };

  useLayoutEffect(() => {
    const input = inputRef.current;
    const controls = controlsRef.current;
    const measure = measureRef.current;
    if (!input || !controls || !measure) return;

    const sync = (): void => {
      const inlineInputWidth = controls.clientWidth - CONTROL_SIZE * 3 - CONTROL_GAP * 3;
      const needsFullWidth =
        value.length > 0 &&
        inlineInputWidth > 0 &&
        (value.includes('\n') || measure.offsetWidth + 8 > inlineInputWidth);
      if (needsFullWidth !== expanded) {
        setExpanded(needsFullWidth);
      }

      if (needsFullWidth) {
        input.style.height = '0px';
        const contentHeight = input.scrollHeight;
        input.style.height = `${Math.min(Math.max(contentHeight, TEXTAREA_MIN), TEXTAREA_MAX)}px`;
        input.style.overflowY = contentHeight > TEXTAREA_MAX ? 'auto' : 'hidden';
      } else {
        input.style.height = `${TEXTAREA_MIN}px`;
        input.style.overflowY = 'hidden';
      }
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(controls);
    return (): void => observer.disconnect();
  }, [expanded, value, attachments.length]);

  return (
    <div
      className='dc-composer-shadow w-full overflow-visible bg-transparent'
      style={{ borderRadius: RADIUS }}
    >
      <form
        onSubmit={handleSubmit}
        className='dc-composer relative flex w-full flex-col overflow-visible border border-foreground/10 bg-background'
        style={{ overflow: 'visible', borderRadius: RADIUS }}
        data-testid='draft-chat-composer'
      >
        <div className='dc-composer-clip isolate flex h-full min-h-0 w-full flex-col justify-center overflow-hidden'>
          <div className='flex w-full shrink-0 flex-col p-1'>
            <label className='sr-only' htmlFor={inputId}>
              {placeholder}
            </label>
            <input
              ref={fileInputRef}
              type='file'
              multiple
              className='hidden'
              tabIndex={-1}
              aria-hidden
              onChange={event => {
                void handleFiles(event);
              }}
            />
            <span
              ref={measureRef}
              aria-hidden='true'
              className='pointer-events-none invisible absolute left-0 top-0 whitespace-pre text-sm font-[450] leading-5 tracking-[-0.28px]'
            >
              {value || ' '}
            </span>
            {attachments.length > 0 ? (
              <ul className='flex flex-wrap gap-1 px-0.5 pb-1.5 pt-0.5' aria-label='Attached files'>
                {attachments.map(file => (
                  <li
                    key={file.id}
                    className='inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-[10px] bg-foreground/[0.06] pl-2 pr-1 text-xs font-[450] text-foreground'
                  >
                    <FileText className='size-3.5 shrink-0 text-foreground/60' aria-hidden />
                    <span className='min-w-0 truncate'>{file.fileName}</span>
                    <button
                      type='button'
                      onClick={() => removeAttachment(file.id)}
                      className='dc-pressable inline-flex size-5 shrink-0 items-center justify-center rounded-md text-foreground/60 hover:bg-foreground/[0.08] hover:text-foreground'
                      aria-label={`Remove ${file.fileName}`}
                      data-track-category='Claw Agents'
                      data-track-name='Create agent: draft chat remove file'
                    >
                      <X className='size-3' />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div
              ref={controlsRef}
              className={cn(
                'grid grid-cols-[28px_minmax(0,1fr)_28px_28px] gap-x-1 gap-y-1.5',
                expanded ? 'items-end' : 'items-center',
              )}
            >
              {/* Mid-reply the next message can still be written, so + and voice stay. */}
              {bare ? null : (
                <div
                  className={cn(
                    'justify-self-start',
                    expanded ? 'col-start-1 row-start-2' : 'col-start-1 row-start-1',
                  )}
                >
                  <DropdownMenu open={plusMenu.open} onOpenChange={plusMenu.onOpenChange}>
                    <DropdownMenuTrigger asChild>
                      <button
                        type='button'
                        disabled={disabled}
                        className={cn(
                          ICON_CLASS,
                          'bg-foreground/[0.06] hover:bg-foreground/[0.1] disabled:cursor-not-allowed disabled:opacity-50',
                        )}
                        aria-label='Add'
                        title='Add'
                        data-track-category='Claw Agents'
                        data-track-name='Create agent: draft chat open add menu'
                      >
                        <Plus className='size-4' />
                      </button>
                    </DropdownMenuTrigger>
                    <DraftChatPlusMenu
                      extras={extras}
                      onExtrasChange={next => onExtrasChange(next)}
                      onInsertSnippet={insertSnippet}
                      onAttach={() => fileInputRef.current?.click()}
                    />
                  </DropdownMenu>
                </div>
              )}
              <textarea
                id={inputId}
                ref={inputRef}
                rows={1}
                value={value}
                disabled={disabled}
                onChange={event => onValueChange(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                className={cn(
                  TEXTAREA_CLASS,
                  // The status stands in for the placeholder, so no caret blinks
                  // beside it; the first key typed brings both back.
                  showStatus && 'caret-transparent',
                  boxCells,
                  expanded ? 'py-1 leading-5' : 'py-0 leading-7',
                )}
                data-track-category='Claw Agents'
                data-track-name='Create agent: draft chat input'
              />
              {value.length === 0 ? (
                // What the empty box says, drawn over it in its own cell: the
                // status while there is one, else the placeholder (the native one
                // is transparent, kept for screen readers). A new line swaps in;
                // the first key typed clears it at once, as a placeholder goes.
                <div
                  aria-hidden
                  className={cn('pointer-events-none relative min-w-0 self-stretch', boxCells)}
                >
                  <AnimatePresence initial={false}>
                    <motion.div
                      key={showStatus ? `status:${statusKey}` : `placeholder:${placeholder}`}
                      className={cn(
                        'absolute inset-0 flex min-w-0 items-center px-1',
                        !showStatus && HINT_CLASS,
                      )}
                      initial={reduceMotion ? FADE_FROM : SWAP_FROM}
                      animate={SWAP_SHOWN}
                      exit={reduceMotion ? FADE_AWAY : SWAP_AWAY}
                      transition={SWAP_IN}
                    >
                      {showStatus ? status : <span className='truncate'>{placeholder}</span>}
                    </motion.div>
                  </AnimatePresence>
                </div>
              ) : null}
              {bare ? null : (
                <ComposerVoiceButton
                  onTranscript={text =>
                    onValueChange(current => (current ? `${current.trimEnd()} ${text}` : text))
                  }
                  className={cn(
                    ICON_CLASS,
                    'h-7 w-7 opacity-70 hover:bg-foreground/[0.06] hover:opacity-100',
                    expanded ? 'col-start-3 row-start-2' : 'col-start-3 row-start-1',
                  )}
                />
              )}
              {bare ? null : pending ? (
                <button
                  type='button'
                  onClick={onStop}
                  aria-label='Stop'
                  title='Stop'
                  className={cn(
                    ICON_CLASS,
                    'bg-foreground text-background hover:opacity-90',
                    expanded ? 'col-start-4 row-start-2' : 'col-start-4 row-start-1',
                  )}
                  data-track-category='Claw Agents'
                  data-track-name='Create agent: draft chat stop'
                >
                  {/* The icon set's Solid square is an outline, so fill it like Ask AI's stop. */}
                  <Square className='size-2.5 fill-current' strokeWidth={0} aria-hidden />
                </button>
              ) : (
                <button
                  type='submit'
                  disabled={!canSend}
                  aria-label='Send'
                  title='Send'
                  className={cn(
                    ICON_CLASS,
                    'disabled:cursor-not-allowed',
                    canSend
                      ? 'bg-foreground text-background enabled:hover:opacity-90'
                      : 'bg-foreground/10 text-foreground/40',
                    expanded ? 'col-start-4 row-start-2' : 'col-start-4 row-start-1',
                  )}
                  data-track-category='Claw Agents'
                  data-track-name='Create agent: draft chat send'
                >
                  <SendPlaneSlant className='size-4' variant='Solid' />
                </button>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
