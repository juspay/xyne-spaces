import { FlatMessage, type FlatMessageContentProps } from '../components/flat-message';
import { useHoldSource } from './use-hold-source';

const NOOP = (): void => undefined;

/**
 * `useHoldSource` for a flat message row: the hold menu lifts a copy of the
 * message drawn from `content`, still and without press handlers.
 */
export function useFlatHoldCopy(
  content: FlatMessageContentProps,
): ReturnType<typeof useHoldSource> {
  return useHoldSource(() => <FlatMessage {...content} onPress={NOOP} />);
}
