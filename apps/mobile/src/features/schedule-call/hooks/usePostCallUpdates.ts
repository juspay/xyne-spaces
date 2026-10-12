// State logic ported from xyne-spaces apps/dashboard ScheduleCallModal/hooks/usePostCallUpdates.tsx.
// Differences, all for mobile:
//  - The channel list, its search and the picker are a separate screen, so none of that lives here
//    (subscribing to the workspace channel list here re-rendered the whole form on every update).
//  - The picked channel is kept as {id, name}; the Combobox items and input focus are web-only.
import { useState } from 'react';

export interface PostCallUpdatesChannel {
  id: string;
  name: string;
}

interface UsePostCallUpdatesParams {
  participantCount: number;
}

export interface PostCallUpdates {
  postCallUpdates: boolean;
  setPostCallUpdates: (value: boolean) => void;
  selectedChannel: PostCallUpdatesChannel | null;
  selectChannel: (channel: PostCallUpdatesChannel) => void;
  showPostCallUpdates: boolean;
  /** True when the toggle is on but no channel is picked. */
  updateChannelError: boolean;
}

export function usePostCallUpdates({
  participantCount,
}: UsePostCallUpdatesParams): PostCallUpdates {
  const [postCallUpdates, setPostCallUpdates] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<PostCallUpdatesChannel | null>(null);

  const updateChannelError = postCallUpdates && !selectedChannel;
  const showPostCallUpdates = participantCount > 0 || postCallUpdates;

  return {
    postCallUpdates,
    setPostCallUpdates,
    selectedChannel,
    selectChannel: setSelectedChannel,
    showPostCallUpdates,
    updateChannelError,
  };
}
