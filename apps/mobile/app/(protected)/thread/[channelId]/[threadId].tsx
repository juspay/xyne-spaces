import { useRef, type ReactElement } from 'react';

import { ConversationThreadScreen, isConversationThreadCard } from '@/src/features/conversation';
import { isChatV3Enabled } from '@/src/features/chat/v3/flag';
import ChatThreadScreenV2 from '@/src/features/chat/v2/screens/ChatThreadScreen';
import ChatThreadScreenV3 from '@/src/features/chat/v3/screens/ChatThreadScreen';

/**
 * The thread card at the app's root: a transparent modal over whatever screen
 * opened it (a room, Activity, Search, a call), so closing it lands back
 * there. Only the redesigned card opens here; the fallbacks keep a stale link
 * working if the flag is off.
 */
export default function ThreadCardRoute(): ReactElement {
  const threadCard = useRef(isConversationThreadCard()).current;
  const v3 = useRef(isChatV3Enabled()).current;
  if (threadCard) return <ConversationThreadScreen />;
  return v3 ? <ChatThreadScreenV3 /> : <ChatThreadScreenV2 />;
}
