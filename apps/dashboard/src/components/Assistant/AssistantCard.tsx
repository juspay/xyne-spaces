import { useState, type ReactElement } from 'react';
import { SuggestionPill } from '../ui/SuggestionPill';
import type { AssistantCardData } from './turns';

interface AssistantCardProps {
  card: AssistantCardData;
  // Whether the tap was taken.
  onPick: (optionId: string) => boolean;
}

/**
 * What the assistant asks the user to tap, as pills under its message like Ask AI's follow-ups:
 * a confirmation (the message above says what), or one of several matches. A tap that was taken
 * counts once: the pills stay off after it. A long option ("Sarah Khan in #onboarding · 2 days
 * ago") is cut short with an ellipsis, its whole label on hover, and never runs past the panel's
 * edge however narrow it is.
 */
export const AssistantCard = ({ card, onPick }: AssistantCardProps): ReactElement => {
  const [picked, setPicked] = useState(false);
  const pick = (optionId: string): void => {
    if (onPick(optionId)) setPicked(true);
  };
  if (card.kind === 'choose') {
    return (
      <div className='flex w-full min-w-0 flex-wrap gap-2'>
        {card.options.map(option => (
          <SuggestionPill
            key={option.id}
            className='max-w-full truncate'
            title={option.label}
            disabled={picked}
            onClick={() => pick(option.id)}
            data-track-category='XyneAI'
            data-track-name='ASSISTANT_CARD_CHOOSE'
          >
            {option.label}
          </SuggestionPill>
        ))}
      </div>
    );
  }
  return (
    <div className='flex w-full min-w-0 flex-wrap gap-2'>
      <SuggestionPill
        primary
        disabled={picked}
        onClick={() => pick('yes')}
        data-track-category='XyneAI'
        data-track-name='ASSISTANT_CARD_CONFIRM'
      >
        Confirm
      </SuggestionPill>
      <SuggestionPill
        disabled={picked}
        onClick={() => pick('cancel')}
        data-track-category='XyneAI'
        data-track-name='ASSISTANT_CARD_CANCEL'
      >
        Cancel
      </SuggestionPill>
    </div>
  );
};
