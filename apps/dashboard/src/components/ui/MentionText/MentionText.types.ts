export type UserMentionActionType = 'view_profile' | 'send_message' | 'copy_email';
export type GroupMentionActionType = 'view_group' | 'join_group' | 'copy_link';

export interface UserMentionAction {
  type: UserMentionActionType;
  label: string;
  icon?: React.ReactNode;
}

export interface GroupMentionAction {
  type: GroupMentionActionType;
  label: string;
  icon?: React.ReactNode;
}

export interface MentionHoverOptions {
  enterDelay?: number;
  leaveDelay?: number;
}

export interface MentionHoverHandlers {
  isOpen: boolean;
  anchorEl: HTMLElement | null;
  handleMouseEnter: (event: React.MouseEvent<HTMLElement>) => void;
  handleMouseLeave: () => void;
  handlePopoverEnter: () => void;
  handlePopoverLeave: () => void;
  handleClose: () => void;
}

interface BaseMentionTextProps {
  userActions?: UserMentionAction[];
  groupActions?: GroupMentionAction[];
  onUserAction?: (userId: string, action: UserMentionActionType) => void;
  onGroupAction?: (groupId: string, action: GroupMentionActionType) => void;
  hoverHandlers?: MentionHoverHandlers;
  preserveThreadRoute?: boolean;
  className?: string;
}

export type UserMentionProps = BaseMentionTextProps & {
  type: 'user';
  userId: string;
  username: string;
  userEmail?: string;
  userPicture?: string;
};

export type GroupMentionProps = BaseMentionTextProps & {
  type: 'group';
  groupId: string;
  groupName: string;
  groupAlias?: string;
  description?: string;
  memberCount?: number;
  onGroupClick?: (groupId: string) => void;
};

export type ChannelMentionProps = BaseMentionTextProps & {
  type: 'channel';
  channelId: string;
  channelName: string;
  isPrivate: boolean;
  description?: string;
};

export type MentionTextProps = UserMentionProps | GroupMentionProps | ChannelMentionProps;
