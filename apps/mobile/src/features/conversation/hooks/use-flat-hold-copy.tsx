import { FlatMessage, type FlatMessageContentProps } from '../components/flat-message';
import { MESSAGE_PADDING_Y } from '../constants';
import { useHoldSource } from './use-hold-source';

const NOOP = (): void => undefined;

/**
 * `useHoldSource` for a flat message row: the hold menu lifts a copy of the
 * message drawn from `content`, still and without press handlers. A
 * continuation's copy gets back the top padding it gives up in the list.
 */
export function useFlatHoldCopy(
  content: FlatMessageContentProps,
): ReturnType<typeof useHoldSource> {
  return useHoldSource(
    () => <FlatMessage {...content} isLifted onPress={NOOP} />,
    content.isContinuation ? MESSAGE_PADDING_Y : 0,
  );
}
