/**
 * UserMentionPopover Types
 * Type definitions for mention popover system
 */

import { ReactNode } from 'react';

export interface UserHoverWrapperProps {
  userId: string;
  children: ReactNode;
  preserveThreadRoute?: boolean;
}
