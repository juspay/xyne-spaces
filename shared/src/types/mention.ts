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
  isSpecial?: boolean;
  isPrivate?: boolean;
  isChannelMember?: boolean;
  isDeactivated?: boolean;
}
