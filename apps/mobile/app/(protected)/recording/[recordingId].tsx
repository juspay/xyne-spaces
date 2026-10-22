import { RecordingDetailScreen } from '@/src/screens/RecordingDetailScreen';
import { useLocalSearchParams } from 'expo-router';
import type { ReactElement } from 'react';

export default function RecordingDetailRoute(): ReactElement {
  const { recordingId } = useLocalSearchParams<{ recordingId: string }>();

  return <RecordingDetailScreen recordingId={recordingId ?? ''} />;
}
