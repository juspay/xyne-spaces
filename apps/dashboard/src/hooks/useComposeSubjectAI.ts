import { useCallback, useRef, useState } from 'react';
import { xyneAIStreamManager, type StreamState } from '../services/XyneAI';
import type { Message } from '../components/Chat/XyneAISidebar/utils/XyneAITypes';

export interface UseComposeSubjectAIReturn {
  isGenerating: boolean;
  generate: (body: string) => Promise<string>;
}

const SUBJECT_PROMPT = (body: string): string =>
  `Suggest a concise, professional email subject line (max ~80 characters) that fits the email body below. Reply with ONLY the subject line — no quotes, no explanation, no markdown formatting, no "Subject:" prefix.

Email body:
"""
${body}
"""`;

const finalBotContent = (messages: Message[]): string | null => {
  const bot = [...messages].reverse().find(m => m.type === 'bot');
  if (!bot) return null;
  const stream = bot.streamingContent || bot.content || '';
  return stream || null;
};

const sanitizeSubject = (raw: string): string => {
  const stripped = raw
    .trim()
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '') // surrounding quotes
    .replace(/^\s*subject\s*:\s*/i, '') // accidental "Subject:" prefix
    .replace(/[\r\n]+/g, ' ') // collapse newlines
    .trim();
  return stripped;
};

export function useComposeSubjectAI(
  channelId: string | null | undefined,
): UseComposeSubjectAIReturn {
  const [isGenerating, setIsGenerating] = useState(false);
  // Tracks the latest in-flight generate() call. If two calls race (rapid
  // double-click), only the latest one is allowed to flip the spinner off,
  // so an earlier call's error doesn't hide the spinner mid-generation.
  const inflightRef = useRef<string | null>(null);

  const generate = useCallback(
    (body: string): Promise<string> => {
      if (!channelId) return Promise.resolve('');
      const trimmed = body.trim();
      if (!trimmed) return Promise.resolve('');

      setIsGenerating(true);

      // Disposable threadId — different from the body-draft thread so a
      // subject generation doesn't show up in the body's DraftCard.
      const threadId = `${channelId}_subject_${Date.now()}`;
      const userMessageId = `user-${Date.now()}`;
      const botMessageId = `bot-${Date.now()}`;
      inflightRef.current = threadId;

      return new Promise<string>(resolve => {
        let resolved = false;
        const finalize = (value: string): void => {
          if (resolved) return;
          resolved = true;
          unsubscribe();
          if (inflightRef.current === threadId) {
            inflightRef.current = null;
            setIsGenerating(false);
          }
          resolve(value);
        };

        const unsubscribe = xyneAIStreamManager.subscribe((state: StreamState) => {
          if (state.threadId !== threadId) return;
          if (state.status === 'error' || state.status === 'aborted') {
            finalize('');
            return;
          }
          if (state.status === 'completed') {
            const content = finalBotContent(state.messages);
            finalize(content ? sanitizeSubject(content) : '');
          }
        });

        xyneAIStreamManager
          .startStream(
            threadId,
            {
              query: SUBJECT_PROMPT(trimmed),
              channelIds: [],
              conversationId: '',
              webSearchEnabled: false,
              deepResearchEnabled: false,
              researchContext: null,
              attachments: [],
              localUserMessageId: userMessageId,
              suppressCompletionToast: true,
              draftMode: true,
              showInSidebar: false,
            },
            [
              {
                id: userMessageId,
                type: 'user',
                content: 'Generate subject',
                timestamp: new Date(),
              },
              {
                id: botMessageId,
                type: 'bot',
                content: '',
                timestamp: new Date(),
                isStreaming: true,
                parentId: userMessageId,
              },
            ],
          )
          .catch(() => {
            finalize('');
          });
      });
    },
    [channelId],
  );

  return { isGenerating, generate };
}
