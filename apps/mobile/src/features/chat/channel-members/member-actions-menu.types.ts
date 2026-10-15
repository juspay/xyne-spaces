import type { ReactElement } from 'react';

import type { MemberAction } from '@/src/features/chat/channel-members/channel-member-actions';

export type MemberActionsMenuProps = {
  userId: string;
  memberName: string;
  actions: MemberAction[];
  onAction: (id: MemberAction['id']) => void;
};

export type MemberActionsMenuComponent = (props: MemberActionsMenuProps) => ReactElement | null;
