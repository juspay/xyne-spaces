import { useRef, type ReactElement } from 'react';

import { isFlagOn } from '@/src/flags';
import { ConversationThreadScreen } from '@/src/features/conversation';
import { isChatV3Enabled } from '@/src/features/chat/v3/flag';
import ChatThreadScreenV2 from '@/src/features/chat/v2/screens/ChatThreadScreen';
import ChatThreadScreenV3 from '@/src/features/chat/v3/screens/ChatThreadScreen';

export default function ChatThreadRoute(): ReactElement {
  const enabled = useRef(isChatV3Enabled()).current;
  const conversationEnabled = useRef(isFlagOn('ui.conversation')).current;
  if (enabled) return <ChatThreadScreenV3 />;
  return conversationEnabled ? <ConversationThreadScreen /> : <ChatThreadScreenV2 />;
}
