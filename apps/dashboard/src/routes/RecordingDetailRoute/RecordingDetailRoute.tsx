import type { ReactElement } from 'react';
import { useRecordingVersion } from '../../hooks/useRecordingVersion';
import RecordingDetailScreen from '../RecordingDetailScreen/RecordingDetailScreen';
import RecordingDetailV2Screen from '../RecordingDetailV2Screen/RecordingDetailV2Screen';

/**
 * Version-aware route wrapper for the recording detail screen.
 */
export default function RecordingDetailRoute(): ReactElement {
  const { recordingVersion } = useRecordingVersion();

  return recordingVersion === 'v2' ? <RecordingDetailV2Screen /> : <RecordingDetailScreen />;
}
