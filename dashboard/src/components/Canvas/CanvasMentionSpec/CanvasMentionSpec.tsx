import { createReactInlineContentSpec } from '@blocknote/react';
import type { ReactCustomInlineContentRenderProps } from '@blocknote/react';
import { createContext, useContext } from 'react';
import { Lock } from 'lucide-react';
import { CanvasRole } from '@xyne/shared';
import { HoverCard } from '../../ui/HoverCard/HoverCard';
import Button from '../../ui/Button';

function formatCanvasRoleLabel(role: CanvasRole): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

export interface MentionUser {
  userId: string;
  username: string;
  userEmail: string;
}

export interface CanvasMentionContextValue {
  canGrantAccess: boolean;
  canGrantOwnerAccess: boolean;
  grantMentionAccess: (mention: MentionUser, role: CanvasRole) => boolean;
  grantGroupMentionAccess: (groupId: string, role: CanvasRole) => boolean;
  hasMentionAccess: (userId: string) => boolean;
  getMentionAccessRole: (userId: string) => CanvasRole | null;
  hasGroupMentionAccess: (groupId: string) => boolean;
}

export const CanvasMentionContext = createContext<CanvasMentionContextValue>({
  canGrantAccess: false,
  canGrantOwnerAccess: false,
  grantMentionAccess: () => false,
  grantGroupMentionAccess: () => false,
  hasMentionAccess: () => true,
  getMentionAccessRole: () => null,
  hasGroupMentionAccess: () => false,
});

export const useCanvasMentionContext = (): CanvasMentionContextValue =>
  useContext(CanvasMentionContext);

export function buildMentionProps(user: MentionUser): Record<string, string> {
  return {
    userId: user.userId,
    username: user.username,
    userEmail: user.userEmail,
  };
}

type MentionConfig = {
  type: 'mention';
  propSchema: {
    userId: { default: '' };
    username: { default: '' };
    userEmail: { default: '' };
    groupId: { default: '' };
    groupName: { default: '' };
  };
  content: 'none';
};

const mentionConfig: MentionConfig = {
  type: 'mention',
  propSchema: {
    userId: { default: '' },
    username: { default: '' },
    userEmail: { default: '' },
    groupId: { default: '' },
    groupName: { default: '' },
  },
  content: 'none',
};

// BlockNote's createReactInlineContentSpec render props type requires a style schema
// generic. We don't use custom styles, so we pass an empty object type.
type NoStyleSchema = Record<string, never>;

type MentionRenderProps = ReactCustomInlineContentRenderProps<MentionConfig, NoStyleSchema>;

const MentionRender = ({ inlineContent, contentRef }: MentionRenderProps) => {
  const props = inlineContent.props;
  const displayName = props.groupId && props.groupName ? props.groupName : props.username || '';
  const {
    canGrantAccess,
    canGrantOwnerAccess,
    grantMentionAccess,
    grantGroupMentionAccess,
    hasMentionAccess,
    hasGroupMentionAccess,
  } = useCanvasMentionContext();
  const isGroup = Boolean(props.groupId);
  const hasAccess = isGroup ? hasGroupMentionAccess(props.groupId) : hasMentionAccess(props.userId);
  const roleOptions = canGrantOwnerAccess
    ? [CanvasRole.VIEWER, CanvasRole.EDITOR, CanvasRole.OWNER]
    : [CanvasRole.VIEWER, CanvasRole.EDITOR];

  if (hasAccess) {
    return (
      <span
        ref={contentRef}
        className='inline-flex items-center rounded-[4px] bg-black/5 px-1 py-0.5 font-medium text-[#0066cc]'
      >
        @{displayName}
      </span>
    );
  }

  const trigger = (
    <span
      ref={contentRef}
      className='inline-flex items-center gap-1 rounded-[4px] border border-dashed border-amber-400 bg-amber-50 px-1 py-0.5 font-medium text-amber-700'
    >
      @{displayName}
      <Lock className='h-3 w-3' />
    </span>
  );

  if (!canGrantAccess) {
    return trigger;
  }

  if (isGroup) {
    return (
      <HoverCard
        trigger={trigger}
        openDelay={120}
        side='top'
        align='start'
        className='w-60 p-3'
        showArrow
      >
        <div className='space-y-2'>
          <div className='text-xs text-muted-foreground'>
            <span className='font-medium text-foreground'>{props.groupName}</span>{' '}
            <span className='font-medium text-amber-600 dark:text-amber-500'>
              doesn&apos;t have access.
            </span>
          </div>
          <div className='text-xs text-muted-foreground'>
            Give any of the following access to this group.
          </div>
          <div className='flex items-center gap-2'>
            {roleOptions.map(role => (
              <Button
                key={role}
                size='sm'
                variant='secondary'
                onClick={() => {
                  grantGroupMentionAccess(props.groupId, role);
                }}
              >
                {formatCanvasRoleLabel(role)}
              </Button>
            ))}
          </div>
        </div>
      </HoverCard>
    );
  }

  return (
    <HoverCard
      trigger={trigger}
      openDelay={120}
      side='top'
      align='start'
      className='w-60 p-3'
      showArrow
    >
      <div className='space-y-2'>
        <div className='text-xs text-muted-foreground'>
          <span className='font-medium text-foreground'>{props.username}</span>{' '}
          <span className='font-medium text-amber-600 dark:text-amber-500'>
            doesn&apos;t have access.
          </span>
        </div>
        <div className='text-xs text-muted-foreground'>
          Give any of the following access to this user.
        </div>
        <div className='flex items-center gap-2'>
          {roleOptions.map(role => (
            <Button
              key={role}
              size='sm'
              variant='secondary'
              onClick={() => {
                grantMentionAccess(
                  {
                    userId: props.userId,
                    username: props.username,
                    userEmail: props.userEmail,
                  },
                  role,
                );
              }}
            >
              {role.charAt(0) + role.slice(1).toLowerCase()}
            </Button>
          ))}
        </div>
      </div>
    </HoverCard>
  );
};

export const mentionInlineContentSpec = createReactInlineContentSpec(mentionConfig, {
  render: MentionRender,
});
