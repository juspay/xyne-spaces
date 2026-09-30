import { useEffect, useRef, useState } from 'react';
import { isRelatedDraftWorthLookingUp, normalizeRelatedDraft } from '@xyne/shared';
import { useAuthContextValues } from './useAuth';
import { searchService } from '../services/searchService';
import type { CmdkAnswerSource } from '../types/search';

export interface CmdkAiAnswer {
  query: string;
  content: string;
  sources: CmdkAnswerSource[];
  streaming: boolean;
}

const ASK_DELAY_MS = 400;
const QUIET_MS = 60_000;
const CACHE_SIZE = 20;

const continues = (draft: string, foundFor: string): boolean =>
  foundFor !== '' && draft.startsWith(foundFor);

export function useCmdkAiAnswer(
  query: string,
  enabled: boolean,
): { answer: CmdkAiAnswer | null; looking: boolean } {
  const { workspaceId } = useAuthContextValues();
  const [shown, setShown] = useState<CmdkAiAnswer | null>(null);
  const [looking, setLooking] = useState(false);
  const cache = useRef(new Map<string, CmdkAiAnswer | null>());
  const quietUntil = useRef(0);

  useEffect(() => {
    const draft = normalizeRelatedDraft(query);
    if (!enabled || !isRelatedDraftWorthLookingUp(draft)) {
      setShown(null);
      return;
    }

    const controller = new AbortController();
    const keepIfContinued = (): void =>
      setShown(current => (current && continues(draft, current.query) ? current : null));
    const remember = (answer: CmdkAiAnswer | null): void => {
      cache.current.set(draft, answer);
      if (cache.current.size > CACHE_SIZE) {
        cache.current.delete(cache.current.keys().next().value as string);
      }
    };

    const timer = setTimeout(() => {
      const cached = cache.current.get(draft);
      if (cached !== undefined) {
        setShown(cached);
        return;
      }
      if (Date.now() < quietUntil.current) return;

      setLooking(true);
      let answer: CmdkAiAnswer = { query: draft, content: '', sources: [], streaming: true };
      searchService
        .streamCmdkAnswer(
          draft,
          workspaceId,
          event => {
            if (controller.signal.aborted) return;
            if (event.type !== 'sources') setLooking(false);
            if (event.type === 'sources') {
              answer = { ...answer, sources: event.sources };
            } else if (event.type === 'delta') {
              answer = { ...answer, content: answer.content + event.content };
              setShown(answer);
            } else if (event.type === 'done') {
              answer = { ...answer, streaming: false };
              remember(answer);
              setShown(answer);
            } else if (event.type === 'skip' && event.reason === 'nothing') {
              remember(null);
              setShown(null);
            } else {
              if (event.type === 'skip' && event.reason === 'off') {
                quietUntil.current = Date.now() + QUIET_MS;
              }
              keepIfContinued();
            }
          },
          controller.signal,
        )
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          if ((error as { status?: number }).status === 429) {
            quietUntil.current = Date.now() + QUIET_MS;
          }
          setLooking(false);
          keepIfContinued();
        });
    }, ASK_DELAY_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
      setLooking(false);
      setShown(current => (current?.streaming ? null : current));
    };
  }, [query, enabled, workspaceId]);

  return { answer: shown, looking };
}
