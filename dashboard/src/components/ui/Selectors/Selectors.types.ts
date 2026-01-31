import type { Editor } from '@tiptap/react';
import { UserPresenceStatus } from '@xyne/shared';

export interface MentionResult {
  id: string;
  name: string;
  type: 'user' | 'group' | 'channel' | 'here';
  username?: string;
  email?: string;
  picture?: string;
  avatar?: string;
  alias?: string;
  description?: string;
  memberCount?: number;
  isSpecial?: boolean; // Flag for @channel and @here
  isPrivate?: boolean; // Flag for private channels (when type is 'channel')
  isChannelMember?: boolean; // Flag indicating if the user is a member of the channel
  presenceStatus?: UserPresenceStatus | undefined;
}

export interface MentionSelectorProps {
  editor: Editor | null;
  mentionItems: MentionResult[];
  onMentionSearch?: (query: string) => void;
  onMentionSelect?: (mention: MentionResult) => void;
  triggerChar?: '@' | '#'; // Which trigger character to use (default: '@')
}

export interface CommandItem {
  id: string;
  name: string;
  description: string;
  category?: string;
}

export interface CommandSelectorProps {
  editor: Editor | null;
  commandItems: CommandItem[];
  isLoadingCommands?: boolean;
  onCommandSelect?: ((command: CommandItem) => void | Promise<void>) | undefined;
}

export interface ChannelResult {
  id: string;
  name: string;
  isPrivate: boolean;
  description?: string;
}

export interface ChannelSelectorProps {
  editor: Editor | null;
  channelItems: ChannelResult[];
  onChannelSearch?: (query: string) => void;
  onChannelSelect?: (channel: ChannelResult) => void;
}
