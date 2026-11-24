import { isChatV3Enabled } from '@/src/features/chat/v3/flag';
import { isFlagOn } from '@/src/flags';

/**
 * Whether threads open as the redesigned card over the room: the
 * `ui.conversation` screens, which chat v3 takes precedence over. Pinned per
 * mount like the flags it reads, so call it once (store in a ref).
 */
export const isConversationThreadCard = (): boolean =>
  isFlagOn('ui.conversation') && !isChatV3Enabled();
