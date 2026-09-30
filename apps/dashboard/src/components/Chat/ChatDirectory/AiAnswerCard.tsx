import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type ComponentType,
  type MouseEvent,
  type ReactElement,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { MessageSquareText } from 'lucide-react';
import type { Components } from 'react-markdown';
import { useCmdkAiAnswer } from '../../../hooks/useCmdkAiAnswer';
import XyneAIStar from '../../icons/xyne-ai/XyneAIStar';
import { HoverCard } from '../../ui/HoverCard';
import { MarkdownMessageRenderer } from '../../ui/MessageBubble/MarkdownMessageRenderer';
import { createMarkdownComponents } from '../../../utils/markdownComponents';
import { KINDS, snippetOf } from '../ChatInput/relatedContextDisplay';
import { useWhereOf } from '../ChatInput/useRelatedWhere';
import type { CmdkAnswerSource, DisplaySearchResult } from '../../../types/search';
import { citationOrder, linkCitations, senderOf, sourceNumberOf } from './AiAnswerCard.utils';

interface AiAnswerCardProps {
  /** What is in the search box: asked once typing settles, shown only while it still matches. */
  query: string;
  question: string | null;
  /**
   * Whether the query currently reads as a question. False draws nothing, but the card
   * stays mounted and keeps the answer it is holding: the verdict drops out for a moment
   * on every edit (a shortened query is not reclassified until the new verdict lands), and
   * unmounting would throw away a good answer and pay for it again on the way back.
   */
  active: boolean;
  onOpenSource: (result: DisplaySearchResult, event: MouseEvent<HTMLButtonElement>) => void;
  onContinue: (question: string) => void;
}

// Carries the Ask AI star (the gradient mark every Ask AI entry point uses). Heading type
// matches the palette's group headings.
const HEADING_CLASS = 'text-xs font-medium uppercase tracking-wide font-mono text-foreground';

/**
 * The overview sits above the tab's own results, so it must never fill the palette: a
 * result row has to stay visible underneath, or the search looks replaced rather than
 * topped. Roughly six lines at `leading-6`; a longer answer scrolls inside the card.
 */
const ANSWER_MAX_HEIGHT = 'max-h-36';

const ANSWER_LINE_WIDTHS = ['w-full', 'w-[92%]', 'w-[58%]'];
const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
const CHIP_CLASS =
  'cmdk-ai-source flex h-7 max-w-[22rem] items-center gap-1.5 rounded-md bg-activity-chip px-2 text-xs text-muted-foreground transition-[background-color,color,box-shadow,transform] duration-150 hover:bg-activity-chip-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]';
const CONTINUE_CLASS =
  'flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]';
const PREVIEW_CLASS = 'z-[10002] w-72 rounded-lg p-3';

type Phase = 'thinking' | 'answering' | 'done';

interface CitationContextValue {
  sources: CmdkAnswerSource[];
  focused: number | null;
  setFocused: (source: number | null) => void;
  labelOf: (source: number) => number;
  onOpenSource: AiAnswerCardProps['onOpenSource'];
}

const CitationContext = createContext<CitationContextValue | null>(null);

const AnswerSkeleton = (): ReactElement => (
  <div aria-hidden='true' className='flex flex-col gap-2.5 py-1.5'>
    {ANSWER_LINE_WIDTHS.map((width, index) => (
      <div
        key={width}
        className={`cmdk-ai-skeleton-bar h-2.5 ${width}`}
        style={{ animationDelay: `${index * 120}ms` }}
      />
    ))}
  </div>
);

const SourcePreview = ({ source }: { source: CmdkAnswerSource }): ReactElement => {
  const where = useWhereOf(source);
  const sender = senderOf(source);
  const snippet = snippetOf(source);
  return (
    <div className='space-y-1.5 text-left'>
      <p className='text-xs font-medium leading-snug text-popover-foreground'>
        {KINDS[source.kind].name} · {where}
      </p>
      {sender && <p className='text-[11px] leading-snug text-muted-foreground'>{sender}</p>}
      {snippet && (
        <p className='line-clamp-4 text-xs leading-snug text-muted-foreground'>{snippet}</p>
      )}
    </div>
  );
};

interface CitationButtonProps {
  source: CmdkAnswerSource;
  number: number;
  context: CitationContextValue;
}

const CitationButton = ({ source, number, context }: CitationButtonProps): ReactElement => {
  const where = useWhereOf(source);
  const label = context.labelOf(number);
  return (
    <HoverCard
      side='top'
      sideOffset={6}
      openDelay={350}
      closeDelay={80}
      className={PREVIEW_CLASS}
      trigger={
        <button
          type='button'
          className='cmdk-ai-cite'
          aria-label={`Source ${label}: ${where}`}
          data-active={context.focused === number}
          data-track-category='SEARCH'
          data-track-name='AI_OVERVIEW_CITATION'
          onMouseEnter={() => context.setFocused(number)}
          onMouseLeave={() => context.setFocused(null)}
          onFocus={() => context.setFocused(number)}
          onBlur={() => context.setFocused(null)}
          onClick={event => context.onOpenSource(source.result, event)}
        >
          {label}
        </button>
      }
    >
      <SourcePreview source={source} />
    </HoverCard>
  );
};

const Citation = ({ number }: { number: number }): ReactElement | null => {
  const context = useContext(CitationContext);
  const source = context?.sources[number - 1];
  return context && source ? (
    <CitationButton source={source} number={number} context={context} />
  ) : null;
};

const BASE_COMPONENTS = createMarkdownComponents('cmdk-ai-answer');
const BaseAnchor = BASE_COMPONENTS.a as ComponentType<AnchorHTMLAttributes<HTMLAnchorElement>>;

const AnswerAnchor = ({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>): ReactElement => {
  const number = sourceNumberOf(href);
  if (number !== null) return <Citation number={number} />;
  return (
    <BaseAnchor href={href} {...props}>
      {children}
    </BaseAnchor>
  );
};

const MARKDOWN_COMPONENTS: Components = { ...BASE_COMPONENTS, a: AnswerAnchor };

interface SourceChipProps {
  source: CmdkAnswerSource;
  number: number;
  label: number;
  index: number;
}

const SourceChip = ({ source, number, label, index }: SourceChipProps): ReactElement => {
  const context = useContext(CitationContext);
  const reduceMotion = useReducedMotion();
  const where = useWhereOf(source);
  const sender = senderOf(source);
  const Icon = KINDS[source.kind].icon;
  return (
    <motion.li
      className='min-w-0 shrink-0'
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4, filter: 'blur(3px)' }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.28, ease: EASE_OUT, delay: reduceMotion ? 0 : index * 0.05 }}
    >
      <HoverCard
        side='bottom'
        align='start'
        sideOffset={6}
        openDelay={350}
        closeDelay={80}
        className={PREVIEW_CLASS}
        trigger={
          <button
            type='button'
            className={CHIP_CLASS}
            aria-label={`Source ${label}: ${where}${sender ? `, ${sender}` : ''}`}
            data-active={context?.focused === number}
            data-track-category='SEARCH'
            data-track-name='AI_OVERVIEW_SOURCE'
            onMouseEnter={() => context?.setFocused(number)}
            onMouseLeave={() => context?.setFocused(null)}
            onFocus={() => context?.setFocused(number)}
            onBlur={() => context?.setFocused(null)}
            onClick={event => context?.onOpenSource(source.result, event)}
          >
            <span className='font-medium tabular-nums'>{label}</span>
            <Icon aria-hidden className='size-3.5 shrink-0' strokeWidth={2} />
            <span className='min-w-0 truncate font-medium text-foreground/90'>{where}</span>
            {sender && <span className='hidden min-w-0 truncate sm:inline'>{sender}</span>}
          </button>
        }
      >
        <SourcePreview source={source} />
      </HoverCard>
    </motion.li>
  );
};

/**
 * AI answer shown above the current tab's results, Google "AI Overview" style, when the
 * query needs AI. The backend searches the workspace, Jev keeps the results that are
 * about the question, and one fast model call streams the answer over them; the tab's
 * own results stay right below it. One question, one answer — "Continue in Xyne AI"
 * takes it into a chat. A new query asks again, replacing the answer.
 *
 * Not a cmdk item: arrow keys and Enter keep working on the results underneath.
 */
export const AiAnswerCard = ({
  query,
  question,
  active,
  onOpenSource,
  onContinue,
}: AiAnswerCardProps): ReactElement | null => {
  const { answer, ask } = useCmdkAiAnswer();
  const reduceMotion = useReducedMotion();
  const [focused, setFocused] = useState<number | null>(null);

  useEffect(() => {
    if (question) ask(question);
  }, [ask, question]);

  const order = useMemo(
    () => citationOrder(answer.content, answer.sources.length),
    [answer.content, answer.sources.length],
  );
  const renderedContent = useMemo(
    () => linkCitations(answer.content, order),
    [answer.content, order],
  );
  const shown = useMemo((): Array<{ source: CmdkAnswerSource; number: number }> => {
    if (order.length > 0) {
      return order.flatMap(number => {
        const source = answer.sources[number - 1];
        return source ? [{ source, number }] : [];
      });
    }
    return answer.status === 'completed'
      ? answer.sources.map((source, index) => ({ source, number: index + 1 }))
      : [];
  }, [order, answer.sources, answer.status]);
  const context = useMemo(
    (): CitationContextValue => ({
      sources: answer.sources,
      focused,
      setFocused,
      labelOf: number => order.indexOf(number) + 1 || number,
      onOpenSource,
    }),
    [answer.sources, focused, order, onOpenSource],
  );

  // Shown from the moment the answer is asked for: a skeleton until the text streams in.
  // Hidden if the run fails, or when the results can't answer the query.
  if (!active || answer.status === 'idle' || answer.status === 'error') return null;

  // The box has moved on since this answer was asked for (still typing, or a newer answer
  // is on its way), so the answer on hand is for a different question: show the skeleton
  // until the new one arrives rather than an answer that no longer matches the query.
  const current = answer.askedQuery !== null && query.trim() === answer.askedQuery;

  // The run for this exact query finished with nothing to show: drop the card instead of
  // leaving the skeleton shimmering over the results for a reply that will never come.
  if (current && answer.status === 'completed' && !answer.content) return null;

  const showAnswer = Boolean(answer.content) && current;
  const phase: Phase = !showAnswer
    ? 'thinking'
    : answer.status === 'streaming'
      ? 'answering'
      : 'done';
  const swap = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, filter: 'blur(2px)' },
        animate: { opacity: 1, filter: 'blur(0px)' },
        exit: { opacity: 0, filter: 'blur(2px)' },
      };

  return (
    <CitationContext.Provider value={context}>
      <motion.section
        className='cmdk-ai-overview mb-2 px-3 pb-3 pt-2'
        data-state={phase}
        aria-live='polite'
        aria-busy={phase !== 'done'}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: EASE_OUT }}
      >
        <header className='mb-1.5 flex h-7 items-center gap-1.5'>
          <XyneAIStar size={14} />
          <span className={HEADING_CLASS}>AI overview</span>
          <div className='ml-auto flex items-center'>
            <AnimatePresence initial={false} mode='wait'>
              {phase === 'thinking' ? (
                <motion.span
                  key='status'
                  className='cmdk-ai-status px-2 text-xs'
                  transition={{ duration: 0.16, ease: EASE_OUT }}
                  {...swap}
                >
                  Reading your workspace
                </motion.span>
              ) : (
                <motion.button
                  key='continue'
                  type='button'
                  className={CONTINUE_CLASS}
                  data-track-category='SEARCH'
                  data-track-name='AI_OVERVIEW_CONTINUE'
                  onClick={() => onContinue(query.trim())}
                  transition={{ duration: 0.16, ease: EASE_OUT }}
                  {...swap}
                >
                  <MessageSquareText aria-hidden className='size-3.5' strokeWidth={2} />
                  Continue in Xyne AI
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </header>

        {showAnswer ? (
          // Capped so a long answer never pushes the results out of reach; it scrolls.
          <motion.div
            key={answer.askedQuery}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
          >
            <div
              className={`cmdk-ai-answer ${ANSWER_MAX_HEIGHT} overflow-y-auto text-pretty text-sm leading-6 text-foreground [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0`}
              data-streaming={phase === 'answering'}
            >
              <MarkdownMessageRenderer
                content={renderedContent}
                markdownComponents={MARKDOWN_COMPONENTS}
              />
            </div>
            {shown.length > 0 && (
              <ul aria-label='Sources' className='mt-2.5 flex flex-wrap gap-1.5'>
                {shown.map(({ source, number }, index) => (
                  <SourceChip
                    key={source.id}
                    source={source}
                    number={number}
                    label={order.length > 0 ? index + 1 : number}
                    index={index}
                  />
                ))}
              </ul>
            )}
          </motion.div>
        ) : (
          <AnswerSkeleton />
        )}
      </motion.section>
    </CitationContext.Provider>
  );
};
