import type { ReactElement } from 'react';
import { ArrowRight, CornerDownRight } from 'lucide-react';
import { lengthBucket } from '../../services/Analytics/trackSource';
import { cn } from '../../utils/classNames';

interface FollowUpSuggestionsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  messageId: string;
  trackContext?: Record<string, unknown> | undefined;
  className?: string;
}

/**
 * Suggested next questions under an answer. A single aligned list rather than
 * wrapping pills: every suggestion starts at the same x and reads top to
 * bottom like the answer above it, long ones wrap within their row instead of
 * reflowing the others, and the whole row is the click target. Rows fade in
 * one after another once the answer has settled; reduced-motion users get
 * them at once.
 */
export function FollowUpSuggestions({
  suggestions,
  onSelect,
  messageId,
  trackContext,
  className,
}: FollowUpSuggestionsProps): ReactElement {
  return (
    <div className={cn('mt-3', className)} data-testid='ask-ai-follow-ups'>
      <p className='mb-1 px-1 text-xs font-medium text-muted-foreground'>Follow up</p>
      <ul className='flex flex-col'>
        {suggestions.map((suggestion, index) => (
          <li
            key={suggestion}
            className='border-t border-border/60 duration-300 animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both first:border-t-0 motion-reduce:animate-none'
            style={{ animationDelay: `${index * 70}ms` }}
          >
            <button
              type='button'
              onClick={() => onSelect(suggestion)}
              className='group/follow-up flex w-full items-start gap-2 rounded-md px-1 py-2 text-left text-sm leading-5 text-foreground/80 transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:bg-accent/60 focus-visible:outline-none'
              data-track-category='AskAI'
              data-track-name='FollowUpSuggestion'
              data-track-metadata={JSON.stringify({
                ...trackContext,
                messageId,
                index,
                lengthBucket: lengthBucket(suggestion.length),
              })}
            >
              <CornerDownRight
                className='mt-0.5 size-3.5 shrink-0 text-muted-foreground'
                aria-hidden
              />
              <span className='min-w-0 flex-1'>{suggestion}</span>
              <ArrowRight
                className='mt-0.5 size-3.5 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-[opacity,transform] group-hover/follow-up:translate-x-0 group-hover/follow-up:opacity-100 group-focus-visible/follow-up:translate-x-0 group-focus-visible/follow-up:opacity-100'
                aria-hidden
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
