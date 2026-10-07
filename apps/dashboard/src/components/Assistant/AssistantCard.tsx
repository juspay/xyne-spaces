import { useState, type ReactElement } from 'react';
import { Button } from '../ui/Button';
import type { AssistantCardData } from './turns';

interface AssistantCardProps {
  card: AssistantCardData;
  // Whether the tap was taken.
  onPick: (optionId: string) => boolean;
}

/**
 * What the assistant asks the user to tap: a confirmation, or one of several matches.
 * A tap that was taken counts once: the buttons stay off after it. Options are one per row, as
 * wide as the card, so a long one ("Sarah Khan in #onboarding · 2 days ago") is cut short with an
 * ellipsis, its whole label on hover, and never runs past the panel's edge however narrow it is.
 */
export const AssistantCard = ({ card, onPick }: AssistantCardProps): ReactElement => {
  const [picked, setPicked] = useState(false);
  const pick = (optionId: string): void => {
    if (onPick(optionId)) setPicked(true);
  };
  if (card.kind === 'choose') {
    return (
      <div className='flex w-full min-w-0 max-w-full flex-col gap-2 rounded-xl border border-border bg-card p-4'>
        {card.options.map(option => (
          <Button
            key={option.id}
            size='sm'
            variant='outline'
            className='w-full min-w-0 max-w-full justify-start'
            title={option.label}
            disabled={picked}
            onClick={() => pick(option.id)}
            data-track-category='XyneAI'
            data-track-name='ASSISTANT_CARD_CHOOSE'
          >
            <span className='min-w-0 truncate'>{option.label}</span>
          </Button>
        ))}
      </div>
    );
  }
  return (
    <div className='flex w-full min-w-0 max-w-full flex-col gap-3 rounded-xl border border-border bg-card p-4'>
      {/* An address or a long name has no space to wrap at. */}
      <p className='text-sm text-foreground [overflow-wrap:anywhere]'>{card.summary}</p>
      <div className='flex flex-wrap gap-2'>
        <Button
          size='sm'
          disabled={picked}
          onClick={() => pick('yes')}
          data-track-category='XyneAI'
          data-track-name='ASSISTANT_CARD_CONFIRM'
        >
          Confirm
        </Button>
        <Button
          size='sm'
          variant='outline'
          disabled={picked}
          onClick={() => pick('cancel')}
          data-track-category='XyneAI'
          data-track-name='ASSISTANT_CARD_CANCEL'
        >
          Cancel
        </Button>
      </div>
    </div>
  );
};
