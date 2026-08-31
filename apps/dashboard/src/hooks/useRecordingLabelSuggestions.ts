import { useMemo } from 'react';
import { normalizeRecordingTags } from '../utils/recordingUtils';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';

/** Recent recordings sampled to build the suggestion list. */
const SUGGESTION_SAMPLE_SIZE = 100;

/**
 * @example
 * const suggestions = useRecordingLabelSuggestions(); // ['design', 'infra', 'upi']
 */
export function useRecordingLabelSuggestions(enabled = true): string[] {
  const [recordings] = useCachedQuery(
    queries.createdOatsRecordings({
      limit: SUGGESTION_SAMPLE_SIZE,
      start: null,
      participantId: null,
    }),
    { enabled },
  );

  return useMemo(
    () =>
      normalizeRecordingTags((recordings ?? []).flatMap(recording => recording.labels)).sort(
        (left, right) => left.localeCompare(right),
      ),
    [recordings],
  );
}
