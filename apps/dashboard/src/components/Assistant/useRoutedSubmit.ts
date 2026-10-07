import { useRef } from 'react';
import type { Resolved } from './engine/resolve';
import type { AssistantActions } from './useAssistantActions';

export type AssistantRouting = Pick<
  AssistantActions,
  'ask' | 'answer' | 'cancel' | 'card' | 'pick' | 'phrases' | 'resumePrompt'
>;

export const useRoutedSubmit = <Trigger>({
  assistant,
  value,
  tagged,
  clear,
  submit,
}: {
  assistant: AssistantRouting | undefined;
  value: string;
  tagged?: readonly Resolved[]; // the @mention chips in `value`
  clear: () => void;
  submit: (trigger: Trigger) => void;
}): { route: (trigger: Trigger) => boolean; stop: () => boolean } => {
  // After the await these must be the latest submit and value, not the render that started it.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const valueRef = useRef(value);
  valueRef.current = value;
  const inFlightRef = useRef<object | null>(null);

  const route = (trigger: Trigger): boolean => {
    if (!assistant) return false;
    // A newer submit supersedes one still routing: `ask` cancels that, and its outcome is dropped.
    const token = {};
    inFlightRef.current = token;
    const asked = value;
    void assistant.ask(asked, tagged).then(outcome => {
      if (inFlightRef.current !== token) return;
      inFlightRef.current = null;
      // Handed over: the sentence a card was about was already sent to Ask AI.
      const settled = outcome.outcome === 'cancelled' || outcome.outcome === 'handed_over';
      if (settled || valueRef.current !== asked) return;
      if (outcome.outcome === 'replied') clear();
      else submitRef.current(trigger);
    });
    return true;
  };

  const stop = (): boolean => {
    if (!inFlightRef.current) return false;
    inFlightRef.current = null;
    assistant?.cancel();
    return true;
  };

  return { route, stop };
};
