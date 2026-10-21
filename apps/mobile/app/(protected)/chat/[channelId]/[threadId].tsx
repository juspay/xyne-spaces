import { useRef, type ReactElement } from 'react';

import { isChatV3Enabled } from '@/src/features/chat/v3/flag';
import ChatThreadScreenV2 from '@/src/features/chat/v2/screens/ChatThreadScreen';
import ChatThreadScreenV3 from '@/src/features/chat/v3/screens/ChatThreadScreen';

export default function ChatThreadRoute(): ReactElement {
  const enabled = useRef(isChatV3Enabled()).current;
  return enabled ? <ChatThreadScreenV3 /> : <ChatThreadScreenV2 />;
}
