import { useEffect, useMemo, type ReactElement } from 'react';
import { useCmdkAiAnswer } from '../../../hooks/useCmdkAiAnswer';
import XyneAIStar from '../../icons/xyne-ai/XyneAIStar';
import { MarkdownMessageRenderer } from '../../ui/MessageBubble/MarkdownMessageRenderer';
import { createMarkdownComponents } from '../../../utils/markdownComponents';
import { Skeleton } from '../../ui/Skeleton';
import {
  buildClawCitationToolNumbers,
  linkifyAndGroupClawCitations,
  stripCitationMarks,
} from '../../ui/TipTapExtensions/CitationMark';

interface AiAnswerCardProps {
  /** What is in the search box: asked once typing settles, shown only while it still matches. */
  query: string;
  /** The active tab; claw searches its scope (+ KB) for the answer. */
  tab: string;
  /**
   * Whether the query currently reads as a question. False draws nothing, but the card
   * stays mounted and keeps the answer it is holding: the verdict drops out for a moment
   * on every edit (a shortened query is not reclassified until the new verdict lands), and
   * unmounting would throw away a good answer and pay for it again on the way back.
   */
  active: boolean;
}

// Borderless, like a search overview sitting on the palette, carrying the Ask AI star
// (the gradient mark every Ask AI entry point uses). Heading type matches the palette's
// group headings, and the horizontal padding lines it up with the result rows.
const HEADING_CLASS = 'text-xs font-medium uppercase tracking-wide font-mono text-foreground';

/**
 * Wait for typing to settle before asking. Every pause long enough to classify starts a
 * run otherwise ("what is mett" scores the same as "what is mettl" — the question shape
 * is what Jev reads, not whether the last word is finished), and an early abort only
 * stops the browser listening: claw has no run id to cancel yet and finishes anyway.
 */
const SETTLE_MS = 600;
const CARD_CLASS = 'mb-2 px-2 py-1.5';

/**
 * The overview sits above the tab's own results, so it must never fill the palette: a
 * result row has to stay visible underneath, or the search looks replaced rather than
 * topped. Roughly six lines at `leading-6`; a longer answer scrolls inside the card.
 */
const ANSWER_MAX_HEIGHT = 'max-h-36';

// Same look as cmd+K's result skeleton (SearchSectionSkeleton): Skeleton's own `bg-muted`
// barely shows on the palette, so the bars are darkened (`!` beats Skeleton's bg class),
// and widths vary so it reads as a paragraph coming, not stripes.
const ANSWER_LINE_WIDTHS = ['w-full', 'w-[92%]', 'w-[58%]'];
const SKELETON_BAR_CLASS = '!bg-muted-foreground/30';

const AnswerSkeleton = (): ReactElement => (
  <div aria-hidden='true' className='flex flex-col gap-2.5 py-1'>
    {ANSWER_LINE_WIDTHS.map(width => (
      <Skeleton key={width} className={`h-3 ${width} ${SKELETON_BAR_CLASS}`} />
    ))}
  </div>
);

/**
 * AI answer shown above the current tab's results, Google "AI Overview" style, when the
 * query needs AI. The `cmdk-answer` claw agent searches the tab's scope (+ KB) and
 * streams one answer; the tab's own results stay right below it. One question, one
 * answer — no chat. A new query or a tab switch asks again, replacing the answer.
 *
 * Not a cmdk item: arrow keys and Enter keep working on the results underneath.
 */
export const AiAnswerCard = ({ query, tab, active }: AiAnswerCardProps): ReactElement | null => {
  const { answer, ask } = useCmdkAiAnswer();

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => void ask(query, tab), SETTLE_MS);
    return (): void => clearTimeout(timer);
  }, [active, ask, query, tab]);

  // Same citation pipeline as chat bubbles: inline `[clf-…#n]` markers become source
  // chips backed by the tool calls' citations.
  const citationCtx = useMemo(() => {
    const toolNumbers = buildClawCitationToolNumbers(answer.content);
    return toolNumbers.size > 0 && answer.toolInvocations.length > 0
      ? { toolInvocations: answer.toolInvocations, toolNumbers }
      : undefined;
  }, [answer.content, answer.toolInvocations]);
  const renderedContent = useMemo(
    () =>
      stripCitationMarks(
        citationCtx
          ? linkifyAndGroupClawCitations(answer.content, citationCtx.toolNumbers)
          : answer.content,
      ),
    [answer.content, citationCtx],
  );
  const markdownComponents = useMemo(
    () => createMarkdownComponents('cmdk-ai-answer', citationCtx),
    [citationCtx],
  );

  // Shown from the moment the answer is asked for: a skeleton until the text streams in.
  // Hidden if the run fails. When the results can't answer the query the agent replies
  // with one short line (Slack-style) and the tab's results stay right below.
  if (!active || answer.status === 'idle' || answer.status === 'error') return null;

  // The box has moved on since this answer was asked for (still typing, or a newer answer
  // is on its way), so the answer on hand is for a different question: show the skeleton
  // until the new one arrives rather than an answer that no longer matches the query.
  const current = answer.askedQuery !== null && query.trim() === answer.askedQuery;

  // The run for this exact query finished with nothing to show: drop the card instead of
  // leaving the skeleton shimmering over the results for a reply that will never come.
  if (current && answer.status === 'completed' && !answer.content) return null;

  return (
    <section className={CARD_CLASS} aria-live='polite'>
      <header className='mb-1.5 flex items-center gap-1.5'>
        <XyneAIStar size={14} />
        <span className={HEADING_CLASS}>AI overview</span>
      </header>

      {answer.content && current ? (
        // Capped so a long answer never pushes the results out of reach; it scrolls.
        <div
          className={`${ANSWER_MAX_HEIGHT} overflow-y-auto text-sm leading-6 text-foreground [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0`}
        >
          <MarkdownMessageRenderer
            content={renderedContent}
            markdownComponents={markdownComponents}
          />
        </div>
      ) : (
        <AnswerSkeleton />
      )}
    </section>
  );
};
