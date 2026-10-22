import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { suggestStageFormFields } from '../../../services/ticketBoardService';

interface UseStageFormSuggestionsParams {
  ticketId: string;
  formId: string;
  /** The form has loaded the ticket's existing values; suggestions only go into what is still empty. */
  hydrated: boolean;
  /** Off for reviewers and settled forms, which are not edited. */
  enabled: boolean;
  formData: Record<string, string[]>;
  setFormData: Dispatch<SetStateAction<Record<string, string[]>>>;
}

const isEmpty = (value: string[] | undefined): boolean => !value?.some(v => v.trim() !== '');

/**
 * XOR's suggested values for a stage form, read from the ticket and its thread. Once the form has
 * loaded, they fill the fields that are still empty; nothing is saved until the agent submits.
 * Returns the fields still holding their suggestion, so the form can mark them.
 */
export const useStageFormSuggestions = ({
  ticketId,
  formId,
  hydrated,
  enabled,
  formData,
  setFormData,
}: UseStageFormSuggestionsParams): ReadonlySet<string> => {
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});
  const requestedFor = useRef<string | null>(null);

  useEffect(() => {
    const key = `${ticketId}:${formId}`;
    if (!enabled || !hydrated || requestedFor.current === key) return;
    requestedFor.current = key;

    const controller = new AbortController();
    let settled = false;
    suggestStageFormFields(ticketId, formId, { signal: controller.signal })
      .then(suggested => {
        setSuggestions(suggested);
        // Only empty fields: what the ticket or the agent already has is never replaced.
        setFormData(current => {
          const next = { ...current };
          for (const [fieldId, value] of Object.entries(suggested)) {
            if (isEmpty(current[fieldId])) next[fieldId] = value;
          }
          return next;
        });
      })
      .catch(() => {
        // Suggestions are optional: the form works the same without them.
      })
      .finally(() => {
        settled = true;
      });
    return (): void => {
      if (settled) return;
      controller.abort();
      requestedFor.current = null;
    };
  }, [ticketId, formId, hydrated, enabled, setFormData]);

  // A field stops being "suggested" once the agent changes its value.
  return useMemo(
    () =>
      new Set(
        Object.entries(suggestions)
          .filter(([fieldId, value]) => formData[fieldId]?.join('\n') === value.join('\n'))
          .map(([fieldId]) => fieldId),
      ),
    [suggestions, formData],
  );
};
