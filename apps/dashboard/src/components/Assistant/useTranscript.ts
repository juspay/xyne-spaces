import { useMemo, useRef } from 'react';
import type { Message } from '../Chat/XyneAISidebar/utils/XyneAITypes';
import { mergeTranscript } from './turns';

const NO_MESSAGES: readonly Message[] = [];

// Remembers how many server messages were on screen when each local message first rendered.
export const useTranscript = (
  serverMessages: readonly Message[],
  localMessages: readonly Message[] = NO_MESSAGES,
): ReturnType<typeof mergeTranscript> => {
  const positions = useRef(new Map<string, number>()).current;
  return useMemo(() => {
    for (const message of localMessages) {
      if (!positions.has(message.id)) positions.set(message.id, serverMessages.length);
    }
    return mergeTranscript(serverMessages, localMessages, positions);
  }, [serverMessages, localMessages, positions]);
};
