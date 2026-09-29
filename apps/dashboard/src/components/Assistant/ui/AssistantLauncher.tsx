import type { ReactElement } from 'react';
import XyneAIStar from '../../icons/xyne-ai/XyneAIStar';

/** The floating button that opens Ask AI straight into voice mode. */
export function AssistantLauncher({ onActivate }: { onActivate: () => void }): ReactElement {
  return (
    <button
      type='button'
      onClick={onActivate}
      aria-label='Talk to the assistant'
      title='Talk to the assistant'
      className='fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
      data-track-category='XyneAI'
      data-track-name='OPEN_ASSISTANT_FLOATING'
    >
      <XyneAIStar size={20} />
    </button>
  );
}
