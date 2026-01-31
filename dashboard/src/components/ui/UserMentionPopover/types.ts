/**
 * UserMentionPopover Types
 * Type definitions for mention popover system
 */

import { ReactNode } from 'react';

export interface UserHoverWrapperProps {
  userId: string;
  children: ReactNode;
}

export interface MentionTextProps {
  userId: string;
  username: string;
  userEmail?: string;
  userPicture?: string;
  onSendMessage?: (userId: string) => void;
}
