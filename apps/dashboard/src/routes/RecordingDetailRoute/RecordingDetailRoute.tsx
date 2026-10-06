import type { ReactElement } from 'react';
import { useRecordingVersion } from '../../hooks/useRecordingVersion';
import RecordingDetailScreen from '../RecordingDetailScreen/RecordingDetailScreen';
import RecordingDetailV2Screen from '../RecordingDetailV2Screen/RecordingDetailV2Screen';

/**
 * Version-aware route wrapper for the recording detail screen.
 *
 * `embedded` marks the copy rendered inside the Activity panel's outlet, which
 * drops the page chrome that the surrounding screen already provides. Only v2
 * has that chrome, so v1 ignores it.
 */
export default function RecordingDetailRoute({
  embedded = false,
  recordingId,
  onBack,
}: {
  embedded?: boolean;
  /** Show this recording instead of the route's. v2 only — v1 reads the route. */
  recordingId?: string;
  /** Replaces "go back" for a host with no page behind it. v2 only. */
  onBack?: () => void;
}): ReactElement {
  const { recordingVersion } = useRecordingVersion();

  return recordingVersion === 'v2' ? (
    <RecordingDetailV2Screen
      embedded={embedded}
      {...(recordingId !== undefined && { recordingId })}
      {...(onBack !== undefined && { onBack })}
    />
  ) : (
    <RecordingDetailScreen />
  );
}
