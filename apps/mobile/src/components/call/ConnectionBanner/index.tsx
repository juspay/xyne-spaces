import React from 'react';
import { useLocalParticipant } from '@livekit/react-native';

import { isReconnectingState } from '../callStage.utils';
import { useConnectionLevel } from '../hooks/useConnectionLevel';
import { ConnectionBannerView, type BannerKind } from './ConnectionBannerView';

interface CallConnectionBannerProps {
  /** The room's own LiveKit ConnectionState ('connected', 'reconnecting', …). */
  connectionState: string;
  topInset: number;
}

/** Must be rendered inside LiveKitRoomProvider: it watches your own network quality too. */
export function CallConnectionBanner({
  connectionState,
  topInset,
}: CallConnectionBannerProps): React.ReactElement | null {
  const { localParticipant } = useLocalParticipant();
  const quality = useConnectionLevel(localParticipant);

  let kind: BannerKind | null = null;
  if (isReconnectingState(connectionState)) kind = 'reconnecting';
  else if (connectionState === 'disconnected') kind = 'disconnected';
  else if (quality !== 'good') kind = 'poor';

  return <ConnectionBannerView kind={kind} topInset={topInset} />;
}
