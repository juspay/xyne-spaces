import { useRef, type ReactElement } from 'react';

import { isChatV3Enabled } from '@/src/features/chat/v3/flag';
import ChatChannelScreenV2 from '@/src/features/chat/v2/screens/ChatChannelScreen';
import ChatChannelScreenV3 from '@/src/features/chat/v3/screens/ChatChannelScreen';

export default function ChatChannelRoute(): ReactElement {
  const enabled = useRef(isChatV3Enabled()).current;
  return enabled ? <ChatChannelScreenV3 /> : <ChatChannelScreenV2 />;
}
