import type { ReactElement, ReactNode } from 'react';
import type { Assistant } from '../useAssistant';
import { AssistantBar, AssistantStage } from './AssistantStage';
import { AssistantTranscript } from './AssistantTranscript';

/**
 * The assistant as a whole page: the orb (or its transcript) above the page's own composer,
 * passed in as `children`. Used where Ask AI is the page itself, not a side panel.
 */
export function AssistantScreen({
  assistant,
  children,
}: {
  assistant: Assistant;
  children: ReactNode;
}): ReactElement {
  return (
    <main className='flex h-full min-h-0 flex-1 flex-col'>
      {assistant.view === 'text' && <AssistantBar assistant={assistant} />}
      <div className='min-h-0 flex-1'>
        {assistant.view === 'voice' ? (
          <AssistantStage assistant={assistant} />
        ) : (
          <AssistantTranscript assistant={assistant} />
        )}
      </div>
      <div className='shrink-0 px-4 pb-2 pt-3 sm:px-6 md:px-10'>
        <div className='mx-auto max-w-3xl'>{children}</div>
      </div>
    </main>
  );
}
