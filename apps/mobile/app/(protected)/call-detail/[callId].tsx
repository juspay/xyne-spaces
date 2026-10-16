import { useLocalSearchParams } from 'expo-router';
import type { ReactElement } from 'react';

import { CallDetailScreen } from '@/src/features/call-detail';

/** Full call detail for an ended call. `callId` is the call row id (Call.id). */
export default function CallDetailRoute(): ReactElement {
  const { callId } = useLocalSearchParams<{ callId: string }>();
  return <CallDetailScreen callId={callId ?? ''} />;
}
