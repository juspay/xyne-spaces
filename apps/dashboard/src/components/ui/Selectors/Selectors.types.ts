import type { Editor } from '@tiptap/react';
import type { MentionResult } from '@xyne/shared';

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
  kind?: 'app' | 'slash-command-artifact';
  /** Registry command id when kind is 'slash-command-artifact'. */
  slashCommandArtifactCommand?: string;
  badge?: string;
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
