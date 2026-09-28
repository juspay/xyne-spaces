import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { MessageItem } from '../../Chat/XyneAISidebar/components/MessageItem';
import { chipWithLabel, toChatMessages } from '../transcript';
import type { Assistant } from '../useAssistant';

const noop = (): void => undefined;

/** The assistant's turns as chat bubbles, for pages without an Ask AI transcript to join. */
export function AssistantTranscript({ assistant }: { assistant: Assistant }): ReactElement {
  const { turns, choose } = assistant;
  const messages = useMemo(() => toChatMessages(turns), [turns]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages]);

  const chooseByLabel = (label: string): void => {
    const chip = chipWithLabel(turns, label);
    if (chip) choose(chip);
  };

  return (
    <div className='h-full overflow-y-auto px-4 py-4 sm:px-6 md:px-10'>
      <div className='mx-auto max-w-3xl space-y-4'>
        {messages.map(message => (
          <MessageItem
            key={message.id}
            message={message}
            readOnly
            onFeedback={noop}
            onCitationClick={noop}
            onSummarizerCitationClick={noop}
            feedbackValue={null}
            isLatestBotMessage={message === messages.at(-1)}
            onFollowUpSuggestionClick={chooseByLabel}
          />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
