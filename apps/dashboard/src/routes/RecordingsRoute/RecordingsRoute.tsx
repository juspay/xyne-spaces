import type { ReactElement } from 'react';
import { useRecordingVersion } from '../../hooks/useRecordingVersion';
import RecordingsScreen from '../RecordingsScreen/RecordingsScreen';
import RecordingsV2Screen from '../RecordingsV2Screen/RecordingsV2Screen';

export default function RecordingsRoute(): ReactElement {
  const { recordingVersion } = useRecordingVersion();

  return recordingVersion === 'v2' ? <RecordingsV2Screen /> : <RecordingsScreen />;
}
