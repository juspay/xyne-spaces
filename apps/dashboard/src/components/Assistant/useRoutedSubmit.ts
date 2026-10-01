import { useRef } from 'react';
import type { AssistantActions } from './useAssistantActions';

export type AssistantRouting = Pick<AssistantActions, 'ask' | 'cancel'>;

export const useRoutedSubmit = <Trigger>({
  assistant,
  value,
  clear,
  submit,
}: {
  assistant: AssistantRouting | undefined;
  value: string;
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
    if (inFlightRef.current) return true;
    const token = {};
    inFlightRef.current = token;
    const asked = value;
    void assistant.ask(asked).then(outcome => {
      if (inFlightRef.current !== token) return;
      inFlightRef.current = null;
      if (outcome.outcome === 'cancelled' || valueRef.current !== asked) return;
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
