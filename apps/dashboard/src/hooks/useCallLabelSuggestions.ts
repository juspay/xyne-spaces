import { useMemo } from 'react';
import { normalizeRecordingTags } from '../utils/recordingUtils';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';

/** Recent calls sampled to build the suggestion list. */
const SUGGESTION_SAMPLE_SIZE = 100;

/**
 * Label ids already applied to the user's recent calls, offered in the call
 * detail picker before anything is typed. The recordings equivalent lives in
 * useRecordingLabelSuggestions — the two read different slices of `calls`
 * (HEADLESS vs. everything else), so they stay separate hooks.
 */
export function useCallLabelSuggestions(enabled = true): string[] {
  const [calls] = useCachedQuery(
    queries.userCallHistoryV2({ limit: SUGGESTION_SAMPLE_SIZE, start: null }),
    { enabled },
  );

  return useMemo(
    () =>
      normalizeRecordingTags((calls ?? []).flatMap(call => call.labels)).sort((left, right) =>
        left.localeCompare(right),
      ),
    [calls],
  );
}
