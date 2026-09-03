/**
 * Footer under a generated summary naming the LLM tier that wrote it, offering a
 * rewrite at the other tier. Shared by the recording and call detail screens.
 *
 * The tiers are symmetric — fast offers an upgrade to Thinking, thinking a
 * downgrade to Fast — so one render covers both; only the wording of what "all
 * future summaries" means differs between hosts.
 */

import type { ReactElement } from 'react';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button/Button';
import { Popover } from '../ui/Popover';
import type { SummaryModelPreference } from '../../hooks/useSummaryModelPreference';

export interface SummaryModelFooterProps {
  /** Tier the visible summary was written with. Anything but 'thinking' reads as fast. */
  modelUsed: SummaryModelPreference | null;
  /** The viewer's saved default, for the "· default for future summaries" note. */
  preference: SummaryModelPreference;
  /** True while a rewrite runs, so a second one can't be stacked on it. */
  isRegenerating: boolean;
  /** What the "all future summaries" row promises to change, e.g. 'every call you capture'. */
  defaultScopeLabel: string;
  /** Rewrite at `target`; `makeDefault` also moves the saved preference. */
  onApply: (target: SummaryModelPreference, makeDefault: boolean) => void;
  /** Analytics namespace of the host screen. */
  trackCategory: string;
}

export function SummaryModelFooter({
  modelUsed,
  preference,
  isRegenerating,
  defaultScopeLabel,
  onApply,
  trackCategory,
}: SummaryModelFooterProps): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);

  // A summary written before the tier was recorded reads as fast, matching what an
  // unset tier resolves to on the server.
  const usedThinking = modelUsed === 'thinking';
  const target: SummaryModelPreference = usedThinking ? 'fast' : 'thinking';
  const targetLabel = usedThinking ? 'Fast' : 'Thinking';
  const usedLabel = usedThinking ? 'Thinking' : 'Fast';

  return (
    <div className='mt-5 flex items-center justify-between gap-2.5 border-t border-border pt-3'>
      <span className='text-xs text-muted-foreground'>
        Generated with a {usedThinking ? 'thinking' : 'fast'} model
        {preference === (usedThinking ? 'thinking' : 'fast')
          ? ' · default for future summaries'
          : ''}
      </span>
      <div className='flex items-center gap-2.5'>
        <span className='text-xs text-muted-foreground'>
          {usedThinking ? 'Want it faster?' : 'Not quite right?'}
        </span>
        <Popover
          open={menuOpen}
          onOpenChange={setMenuOpen}
          side='top'
          align='end'
          sideOffset={8}
          className='w-72 rounded-xl border border-border bg-popover p-1.5 shadow-lg'
          trigger={
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={isRegenerating}
              title={
                usedThinking
                  ? 'Regenerate with Fast — single pass, ready in seconds'
                  : 'Regenerate with Thinking — deeper pass, takes a little longer'
              }
              className='h-7 gap-1.5 rounded-lg text-xs font-medium text-muted-foreground'
              data-track-category={trackCategory}
              data-track-name={`retry_with_${target}`}
            >
              <RefreshCw className='size-3.5' />
              Retry with {targetLabel}
            </Button>
          }
        >
          <div>
            <p className='px-2 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
              Apply {target} to
            </p>
            <button
              type='button'
              onClick={() => {
                setMenuOpen(false);
                onApply(target, false);
              }}
              className='block w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted'
              data-track-category={trackCategory}
              data-track-name={`retry_${target}_once`}
            >
              <p className='text-sm font-medium text-foreground'>Just this summary</p>
              <p className='mt-0.5 text-xs leading-snug text-muted-foreground'>
                Regenerate once. Your default stays {usedLabel}.
              </p>
            </button>
            <button
              type='button'
              onClick={() => {
                setMenuOpen(false);
                onApply(target, true);
              }}
              className='block w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted'
              data-track-category={trackCategory}
              data-track-name={`retry_${target}_always`}
            >
              <p className='text-sm font-medium text-foreground'>All future summaries</p>
              <p className='mt-0.5 text-xs leading-snug text-muted-foreground'>
                Make {targetLabel} the default for {defaultScopeLabel}.
              </p>
            </button>
          </div>
        </Popover>
      </div>
    </div>
  );
}
