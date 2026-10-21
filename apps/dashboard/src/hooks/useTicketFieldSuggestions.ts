import { useEffect, useMemo, useState } from 'react';
import { suggestTicketFields, type TicketFieldSuggestions } from '../services/ticketBoardService';
import { countTicketWords, TICKET_FIELD_SUGGESTION_MIN_WORDS } from '@xyne/shared';
import { useDebouncedValue } from './useDebouncedValue';

export const useTicketFieldSuggestions = ({
  title,
  description,
  boards,
  enabled,
}: {
  title: string;
  description: string;
  boards: { id: string; name: string; description?: string }[];
  enabled: boolean;
}): TicketFieldSuggestions => {
  const [suggestions, setSuggestions] = useState<TicketFieldSuggestions>({});
  // Debounced on content: the boards array is rebuilt every render.
  const key = useMemo(
    () => JSON.stringify({ title: title.trim(), description: description.trim(), boards }),
    [title, description, boards],
  );
  const debouncedKey = useDebouncedValue(key, 900);

  useEffect(() => {
    const input = JSON.parse(debouncedKey) as Parameters<typeof suggestTicketFields>[0];
    const words = countTicketWords(`${input.title} ${input.description}`);
    if (!enabled || words < TICKET_FIELD_SUGGESTION_MIN_WORDS) {
      setSuggestions({});
      return;
    }
    const controller = new AbortController();
    suggestTicketFields(input, { signal: controller.signal })
      .then(setSuggestions)
      .catch((): void => {
        if (!controller.signal.aborted) setSuggestions({});
      });
    return (): void => controller.abort();
  }, [debouncedKey, enabled]);

  return suggestions;
};
