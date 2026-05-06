import { useZero } from './useZero';
import { mutators } from '../zero/mutators';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';

export const useEnterSendsMessage = (): {
  enterSendsMessage: boolean;
  setEnterSendsMessage: (value: boolean) => void;
} => {
  const zero = useZero();
  const [userPreference] = useCachedQuery(queries.getCurrentUserPreference({}));

  // Default true: Enter sends, Shift+Enter = new line
  const enterSendsMessage = userPreference?.enterSendsMessage ?? true;

  const setEnterSendsMessage = (value: boolean): void => {
    void zero.mutate(
      mutators.userPreference.setEnterSendsMessage({
        id: userPreference?.id ?? crypto.randomUUID(),
        enterSendsMessage: value,
        timestamp: Date.now(),
      }),
    );
  };

  return { enterSendsMessage, setEnterSendsMessage };
};
