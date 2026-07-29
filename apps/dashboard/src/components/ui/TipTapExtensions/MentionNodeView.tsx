import React from 'react';
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import { MentionText } from '../MentionText';
import type {
  UserMentionAction,
  GroupMentionAction,
  UserMentionActionType,
  GroupMentionActionType,
} from '../MentionText';

interface MentionStorage {
  userActions?: UserMentionAction[];
  groupActions?: GroupMentionAction[];
  onUserAction?: (userId: string, action: UserMentionActionType) => void;
  onGroupAction?: (groupId: string, action: GroupMentionActionType) => void;
  preserveThreadRoute?: boolean;
}

interface EditorStorage {
  mention?: MentionStorage;
  [key: string]: unknown;
}

export function MentionNodeView({ node, editor }: NodeViewProps): React.JSX.Element {
  const attrs = node.attrs as Record<string, unknown>;
  const isChannel = attrs['channelId'];
  const mentionType = attrs['mentionType'] as string;
  const isGroup = mentionType === 'group' || attrs['groupId'];
  const isSpecial = mentionType === 'channel' || mentionType === 'here';

  // Access actions and handlers from extension storage with proper typing
  const editorStorage = editor?.storage as unknown as EditorStorage | undefined;
  const storage = editorStorage?.mention;
  const userActions = storage?.userActions;
  const groupActions = storage?.groupActions;
  const onUserAction = storage?.onUserAction;
  const onGroupAction = storage?.onGroupAction;
  const preserveThreadRoute = storage?.preserveThreadRoute ?? false;

  return (
    <NodeViewWrapper as='span' className='mention-node-wrapper inline'>
      <span
        contentEditable={false}
        data-mention=''
        data-mention-type={isChannel ? 'channel' : isGroup ? 'group' : 'user'}
      >
        {isSpecial ? (
          <span className='chat-input-special-mention'>@{mentionType}</span>
        ) : isChannel ? (
          <MentionText
            type='channel'
            channelId={attrs['channelId'] as string}
            channelName={attrs['channelName'] as string}
            isPrivate={attrs['isPrivate'] as boolean}
            {...(attrs['description'] !== undefined && {
              description: attrs['description'] as string,
            })}
          />
        ) : isGroup ? (
          <MentionText
            type='group'
            groupId={attrs['groupId'] as string}
            groupName={attrs['groupName'] as string}
            {...(attrs['groupAlias'] !== undefined && {
              groupAlias: attrs['groupAlias'] as string,
            })}
            {...(attrs['description'] !== undefined && {
              description: attrs['description'] as string,
            })}
            {...(attrs['memberCount'] !== undefined && {
              memberCount: attrs['memberCount'] as number,
            })}
            {...(groupActions !== undefined && { groupActions })}
            {...(onGroupAction !== undefined && { onGroupAction })}
          />
        ) : (
          <MentionText
            type='user'
            userId={attrs['userId'] as string}
            username={attrs['username'] as string}
            {...(attrs['userEmail'] !== undefined && { userEmail: attrs['userEmail'] as string })}
            {...(attrs['userPicture'] !== undefined && {
              userPicture: attrs['userPicture'] as string,
            })}
            {...(userActions !== undefined && { userActions })}
            {...(onUserAction !== undefined && { onUserAction })}
            preserveThreadRoute={preserveThreadRoute}
          />
        )}
      </span>
    </NodeViewWrapper>
  );
}
