import { useState, useCallback, useRef, useEffect } from 'react';
import { BASE_URL } from '../services/clients/apiClient';
import { fetchSessionsByConversationId } from '../services/XyneAI/XyneAISessionsService';

interface Email {
  from?: string | null;
  to?: string[] | null;
  subject?: string | null;
  body?: string | null;
  createdAt?: string | Date | number | null;
}

interface UseDeskAIDraftOptions {
  channelId: string;
  conversationId: string;
  sessionId?: string | null;
}

export interface UseDeskAIDraftReturn {
  draftContent: string;
  isStreaming: boolean;
  isDraftActive: boolean;
  triggerDraft: (emails: Email[]) => void;
  refineDraft: (instruction: string) => void;
  acceptDraft: () => string;
  rejectDraft: () => void;
  currentSessionId: string | null;
}

function serializeEmails(emails: Email[]): string {
  return emails
    .map((email, i) => {
      const from = email.from || 'Unknown';
      const to = (email.to || []).join(', ');
      const subject = email.subject || '(no subject)';
      const body = email.body || '';
      const plainBody = body.replace(/<[^>]*>/g, '').trim();
      return `--- Email ${i + 1} ---\nFrom: ${from}\nTo: ${to}\nSubject: ${subject}\n\n${plainBody}`;
    })
    .join('\n\n');
}

export function useDeskAIDraft({
  channelId,
  conversationId,
  sessionId,
}: UseDeskAIDraftOptions): UseDeskAIDraftReturn {
  const [draftContent, setDraftContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isDraftActive, setIsDraftActive] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(sessionId || null);
  const sessionIdRef = useRef<string | null>(sessionId || null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionLookedUpRef = useRef(false);

  // Reset all draft state and look up session when conversationId changes (ticket switch)
  useEffect(() => {
    // Abort any in-flight stream
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    // Reset draft UI state
    setDraftContent('');
    setIsStreaming(false);
    setIsDraftActive(false);
    // Reset session tracking
    sessionIdRef.current = null;
    setCurrentSessionId(null);
    sessionLookedUpRef.current = false;

    // Look up existing session for this conversationId
    if (!conversationId) return;
    sessionLookedUpRef.current = true;
    void fetchSessionsByConversationId(conversationId)
      .then(sessions => {
        if (sessions.length > 0 && sessions[0] && !sessionIdRef.current) {
          sessionIdRef.current = sessions[0].sessionId;
          setCurrentSessionId(sessions[0].sessionId);
        }
      })
      .catch(() => {
        /* ignore */
      });
  }, [conversationId]);

  const streamQuery = useCallback(
    async (query: string) => {
      if (abortRef.current) {
        abortRef.current.abort();
      }

      const controller = new AbortController();
      abortRef.current = controller;

      setIsStreaming(true);
      setDraftContent('');
      setIsDraftActive(true);

      try {
        // Using fetch instead of axios for SSE streaming (ReadableStream support)
        // eslint-disable-next-line local-rules/no-fetch-use-axios
        const response = await fetch(`${BASE_URL}/xyne-ai`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          credentials: 'include',
          body: JSON.stringify({
            query,
            session_id: sessionIdRef.current || undefined,
            channel_ids: [channelId],
            conversation_id: conversationId,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Stream failed: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';
        let buffer = '';
        let done = false;

        while (!done) {
          const result = await reader.read();
          done = result.done;
          if (done) break;

          buffer += decoder.decode(result.value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6)) as {
                type: string;
                sessionId?: string;
                content?: string;
                output?: { summary?: string };
                error?: string;
              };

              if (data.type === 'start' && data.sessionId) {
                sessionIdRef.current = data.sessionId;
                setCurrentSessionId(data.sessionId);
              } else if (data.type === 'delta' && data.content) {
                accumulated += data.content;
                setDraftContent(accumulated);
              } else if (data.type === 'complete' && data.output?.summary) {
                accumulated = data.output.summary;
                setDraftContent(accumulated);
              } else if (data.type === 'error') {
                console.error('[DeskAIDraft] Stream error:', data.error);
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('[DeskAIDraft] Stream failed:', error);
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [channelId, conversationId],
  );

  const triggerDraft = useCallback(
    (emails: Email[]) => {
      const emailContext = serializeEmails(emails);
      const query = `Based on the following email thread, draft a professional reply to the most recent email. Consider the full context of the conversation.\n\n${emailContext}\n\nDraft a concise, professional reply. Output ONLY the email body text, no subject line or headers.`;
      void streamQuery(query);
    },
    [streamQuery],
  );

  const refineDraft = useCallback(
    (instruction: string) => {
      const query = `Refine the previous draft reply with this instruction: ${instruction}\n\nOutput ONLY the refined email body text, no subject line or headers.`;
      void streamQuery(query);
    },
    [streamQuery],
  );

  const acceptDraft = useCallback(() => {
    setIsDraftActive(false);
    const content = draftContent;
    return content;
  }, [draftContent]);

  const rejectDraft = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setIsDraftActive(false);
    setDraftContent('');
    setIsStreaming(false);
  }, []);

  return {
    draftContent,
    isStreaming,
    isDraftActive,
    triggerDraft,
    refineDraft,
    acceptDraft,
    rejectDraft,
    currentSessionId,
  };
}
