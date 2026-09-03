import React, { JSX, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { usePlatform } from '../../../hooks/usePlatform';
import {
  Check,
  Copy,
  FileText,
  Lock,
  MessageSquare,
  Ticket as TicketIcon,
  Users,
  Clock,
  Phone,
} from 'lucide-react';
import {
  getAnchorTargetProps,
  getInternalLinkLabel,
  isExternalUrl,
  parseInternalXyneLink,
  patchLegacyInternalUrl,
  shouldReplaceWithSemanticLabel,
  type InternalXyneLinkKind,
} from './internalLinkUtils';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { UserHoverWrapper } from '../../ui/UserMentionPopover/UserMentionPopover';
import { useChannel } from '../../../hooks/useChannels';
import { GenericMentionHoverPopover } from '../../ui/GenericMentionPopover/GenericMentionPopover';
import { ALLOWED_TAGS, isValidURL, sanitizeDomTree } from '../../../utils/sanitizer';
import { CopyCopied, CopyDefault, MaximizeTwoArrow } from '@xyne/icons';
import { copyTextToClipboard } from '../../../utils/clipboardUtils';
import { tokenizeMessage, isEmojiOnlyFromDom } from '../../../utils/emojiUtils';
import { useUsers } from '../../../hooks/useUsers';
import { GroupHoverWrapper } from '../../ui/GroupMentionPopover/GroupMentionPopover';
import { LinkHoverCard } from '../LinkHoverCard/LinkHoverCard';
import { getUserDisplayNameById } from '../../../utils/userDisplayName';
import { ToolOutputRenderer } from '../../Charts';
import type { ToolOutput as GeniusToolOutput } from '../../../types/toolOutput';
import { cn } from '../../../utils/classNames';
import { isElectronApp, isElectronStandaloneWindow } from '../../../utils/electronApp';
import { openLink } from '../../../utils/openLink';
import { logger, Event } from '../../../utils/logger';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useUserGroupMappings } from '../../../hooks/useUserGroup';
import { API_BASE_URL } from '../../../config';
import { FlowScreenManager } from '../../flowUI/FlowScreenManager';
import { ChannelScopeType, type FlowDefinition } from '@xyne/shared';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import { withWorkspacePrefix } from '../../../hooks/useShareableOrigin';
import { formatChannelLabel } from '../ChatDirectory/ChatDirectory.utils';

interface RenderMessageWithHTMLProps {
  message: string;
  onSendMessage?: (userId: string) => void;
  onChannelClick?: (channelId: string) => void;
  showEdited?: boolean;
  isSystemMessage?: boolean;
  breakLongLinks?: boolean;
  /** Needed to render embedded FlowScreenManager widgets */
  messageId?: string;
  conversationId?: string;
  preserveThreadRoute?: boolean;
  slashCommandArtifactContext?: {
    channelId?: string;
    senderId?: string;
    createdAt?: number;
    surface?: 'channel' | 'thread';
  };
}

const MAX_HTML_LENGTH = 100000;

const URL_REGEX = /https?:\/\/[^\s<]+[^<.,:;"')\]\s]/gi;

const getInternalLinkIcon = (kind: InternalXyneLinkKind): JSX.Element => {
  switch (kind) {
    case 'ticket':
      return <TicketIcon className='h-3.5 w-3.5' />;
    case 'canvas':
      return <FileText className='h-3.5 w-3.5' />;
    case 'call':
      return <Phone className='h-3.5 w-3.5' />;
    default:
      return <MessageSquare className='h-3.5 w-3.5' />;
  }
};

const getOptionalStringProperty = (value: unknown, key: string): string | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const propertyValue = (value as Record<string, unknown>)[key];
  return typeof propertyValue === 'string' ? propertyValue : undefined;
};

const isChannelScopeType = (value: string | undefined): value is ChannelScopeType => {
  return value !== undefined && (Object.values(ChannelScopeType) as string[]).includes(value);
};

const getOptionalChannelScopeType = (value: unknown): ChannelScopeType | undefined => {
  const scopeType = getOptionalStringProperty(value, 'scopeType');
  return isChannelScopeType(scopeType) ? scopeType : undefined;
};

export const InternalXyneLink = ({
  href,
  children,
  className,
  onClick,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>): JSX.Element => {
  const resolvedHref = href ?? '';
  const parsedLink = parseInternalXyneLink(resolvedHref);
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const copyHref =
    parsedLink?.kind === 'call' ? resolvedHref : withWorkspacePrefix(resolvedHref, workspaceId);
  const channel = useChannel(parsedLink?.channelId ?? '');
  const { userID } = useAuthContextValues();
  const { displayName: channelDisplayName } = useChannelDisplayName(channel, userID);
  const channelScopeType = getOptionalChannelScopeType(channel);
  const [ticket] = useCachedQuery(queries.ticketByIdV2({ ticketId: parsedLink?.ticketId ?? '' }), {
    enabled: !!parsedLink?.ticketId,
  });
  const [canvas] = useCachedQuery(queries.getCanvas({ canvasId: parsedLink?.canvasId ?? '' }), {
    enabled: !!parsedLink?.canvasId,
  });
  const [copied, setCopied] = useState(false);

  // Call links are left to bubble: the document-level handler in App.tsx routes
  // every anchor in the app, and it turns an invite URL into the dashboard's own
  // call route. Claiming them here as well would do the same work twice.

  if (!resolvedHref || !parsedLink) {
    return (
      <a
        href={href}
        className={className}
        onClick={onClick}
        data-track-category='MESSAGE'
        data-track-name='OPEN_MESSAGE_LINK'
        {...props}
      >
        {children}
      </a>
    );
  }

  const handleCopy = (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    void navigator.clipboard.writeText(copyHref).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  const channelName = getOptionalStringProperty(channel, 'name');
  const fallbackChannelLabel = channelName ? `#${channelName}` : undefined;
  const channelLabel =
    channelName && channelScopeType
      ? formatChannelLabel({
          channel: { name: channelName, scopeType: channelScopeType },
          ...(channelDisplayName ? { searchableNames: [channelDisplayName] } : {}),
        })
      : fallbackChannelLabel;
  const linkLabel = getInternalLinkLabel(
    parsedLink,
    channelLabel,
    getOptionalStringProperty(ticket, 'xyneId'),
    getOptionalStringProperty(canvas, 'title'),
  );
  const leadingIcon = getInternalLinkIcon(parsedLink.kind);

  if (!shouldReplaceWithSemanticLabel(children, resolvedHref)) {
    return (
      <a
        href={href}
        className={className}
        onClick={onClick}
        data-track-category='MESSAGE'
        data-track-name='OPEN_INTERNAL_LINK'
        data-track-metadata={JSON.stringify({ href: copyHref, kind: parsedLink.kind })}
        {...props}
      >
        {children}
      </a>
    );
  }

  const linkClassName = cn(
    'inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/80 bg-muted/40 px-2 py-0.5 text-primary no-underline transition-colors hover:bg-muted hover:no-underline',
    className,
  );

  const linkContent = (
    <>
      <span className='shrink-0 text-muted-foreground'>{leadingIcon}</span>
      <span className='truncate'>{linkLabel}</span>
    </>
  );

  return (
    <span className='group/internal-link inline-flex items-center gap-1.5 align-baseline max-w-full'>
      {parsedLink.kind === 'canvas' ? (
        <CanvasLink href={href} className={linkClassName} onClick={onClick} {...props}>
          {linkContent}
        </CanvasLink>
      ) : (
        <a
          href={resolvedHref}
          className={linkClassName}
          onClick={onClick}
          data-track-category='MESSAGE'
          data-track-name='OPEN_INTERNAL_LINK'
          data-track-metadata={JSON.stringify({ href: resolvedHref, kind: parsedLink.kind })}
          {...props}
        >
          {linkContent}
        </a>
      )}
      <button
        type='button'
        onClick={handleCopy}
        className='inline-flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-muted group-hover/internal-link:opacity-100 focus-visible:opacity-100'
        aria-label='Copy original link'
        title='Copy original link'
        data-track-category='MESSAGE'
        data-track-name='COPY_INTERNAL_LINK'
        data-track-metadata={JSON.stringify({ href: resolvedHref, kind: parsedLink.kind })}
      >
        {copied ? (
          <Check className='h-3 w-3 text-green-600' />
        ) : (
          <Copy className='h-3 w-3 text-muted-foreground' />
        )}
      </button>
    </span>
  );
};

const CanvasLink = ({
  href,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>): JSX.Element => {
  const resolvedHref = href ?? '';
  const navigate = useNavigate();
  const location = useLocation();
  const { channelId } = useParams<{ channelId: string }>();
  const { isMobile } = usePlatform();

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>): void => {
    if (!resolvedHref) return;
    const url = new URL(resolvedHref, window.location.origin);

    // Check for Cmd/Ctrl+Click to open in new tab (desktop only)
    const isCmdClick = event.metaKey || event.ctrlKey;
    if (!isMobile && isCmdClick) {
      event.preventDefault();
      window.open(resolvedHref, '_blank');
      return;
    }

    if (url.origin === window.location.origin && url.pathname.startsWith('/chat/canvas/')) {
      event.preventDefault();
      const parts = url.pathname.split('/');
      const targetCanvasId = parts[parts.length - 1];

      if (targetCanvasId && channelId) {
        // Open as overlay in current channel
        void navigate(`${location.pathname}#canvas=${targetCanvasId}`);
      } else {
        // Fallback to full page navigation
        void navigate(url.pathname);
      }
    }

    if (props.onClick) {
      props.onClick(event);
    }
  };

  return (
    <a
      href={resolvedHref}
      onClick={handleClick}
      {...props}
      data-track-category='MESSAGE'
      data-track-name='OPEN_CANVAS_LINK'
      data-track-metadata={JSON.stringify({ href: resolvedHref })}
    >
      {children}
    </a>
  );
};

export function MentionRenderer({
  userId,
  fallbackName,
  preserveThreadRoute = false,
}: {
  userId: string;
  fallbackName?: string | undefined;
  preserveThreadRoute?: boolean;
}): JSX.Element {
  const context = useAuthContextValues();
  const users = useUsers();
  const resolved = getUserDisplayNameById(users, userId);
  const displayName = resolved === 'Unknown' && fallbackName ? fallbackName : resolved;

  const isCurrentUser = context.userID === userId;

  return (
    <UserHoverWrapper userId={userId} preserveThreadRoute={preserveThreadRoute}>
      <span
        data-mention=''
        data-mention-type='user'
        data-user-id={userId}
        data-username={displayName}
        className={
          isCurrentUser
            ? 'mention-text !bg-[var(--mention-current-user-bg)] !text-[color:var(--mention-current-user-color,var(--mention-color))]'
            : 'mention-text'
        }
      >
        {displayName}
      </span>
    </UserHoverWrapper>
  );
}

export function ChannelMentionRenderer({
  channelId,
  channelName,
  isPrivate,
  navigate,
}: {
  channelId: string;
  channelName: string;
  isPrivate: boolean;
  navigate: ReturnType<typeof useNavigate>;
}): JSX.Element {
  const channel = useChannel(channelId);
  const [lastActivityAt, setLastActivity] = useState<number | undefined>(undefined);
  const [participantCount, setParticipantCount] = useState<number | undefined>(undefined);
  const zero = useZero();

  const handleChannelClick = (): void => {
    void navigate(`/chat/dir/${channelId}`);
  };

  useEffect(() => {
    zero
      .run(queries.channelStats({ channelId }), { type: 'complete' })
      .then(stats => {
        if (!stats) return;
        setLastActivity(stats.lastActivityAt);
        setParticipantCount(stats.participantCount);
      })
      .catch(() => {
        // { Handle error silently, stats will just not show in popover }
      });
  }, [channelId, zero]);

  let lastActivity: string | undefined;
  let metaContent: React.ReactNode | undefined;

  if (channel) {
    // Show last activity time
    if (lastActivityAt) {
      const lastActivityDate = new Date(lastActivityAt);
      const now = new Date();
      const diffMs = now.getTime() - lastActivityDate.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) {
        lastActivity = 'Just now';
      } else if (diffMins < 60) {
        lastActivity = `${diffMins}m ago`;
      } else if (diffHours < 24) {
        lastActivity = `${diffHours}h ago`;
      } else {
        lastActivity = `${diffDays}d ago`;
      }
    }

    // Build meta content with member count, last activity, and button
    const metaParts: React.ReactNode[] = [];

    if (participantCount !== undefined) {
      metaParts.push(
        <div key='members' className='flex items-center gap-2'>
          <Users className='h-3.5 w-3.5' />
          <span>{participantCount} people in this channel</span>
        </div>,
      );
    }

    if (lastActivity) {
      metaParts.push(
        <div key='activity' className='flex items-center gap-2'>
          <Clock className='h-3.5 w-3.5' />
          <span>Last message {lastActivity}</span>
        </div>,
      );
    }

    if (metaParts.length > 0 || channel) {
      metaContent = (
        <div className='space-y-3'>
          {metaParts.length > 0 && <div className='space-y-1'>{metaParts}</div>}
          <button
            type='button'
            onClick={handleChannelClick}
            className='text-xs cursor-pointer bg-none border border-border px-2 py-1 rounded-md text-muted-foreground hover:bg-accent w-full'
            data-track-category='MESSAGE'
            data-track-name='VIEW_CHANNEL_MENTION'
            data-track-metadata={JSON.stringify({ channelId })}
          >
            View Channel
          </button>
        </div>
      );
    }
  }

  return (
    <GenericMentionHoverPopover
      data={{
        icon: isPrivate ? <Lock className='h-4 w-4' /> : '#',
        title: channelName,
        ...(channel?.description && { subtitle: channel.description }),
        ...(metaContent && { meta: metaContent }),
      }}
      onClick={handleChannelClick}
    >
      <span
        data-channel-mention=''
        data-channel-id={channelId}
        data-channel-name={channelName}
        data-is-private={isPrivate.toString()}
        className='text-[color:var(--mention-color)] bg-[var(--mention-channel-bg)] hover:bg-[var(--mention-channel-hover-bg)] px-1 py-[2px] rounded-[4px] font-normal no-underline transition-colors duration-200 inline whitespace-nowrap align-baseline'
      >
        {isPrivate ? <Lock className='h-3 w-3 inline-block mr-0.5 mb-1' /> : '#'}
        {channelName}
      </span>
    </GenericMentionHoverPopover>
  );
}

export function GroupMentionRenderer({
  groupId,
  groupName,
  alias,
}: {
  groupId: string;
  groupName: string;
  alias: string;
}): JSX.Element {
  const navigate = useNavigate();
  const { channelId } = useParams<{ channelId: string }>();
  const userMemberships = useUserGroupMappings();

  const isCurrentUserInGroup = useMemo(
    () => userMemberships?.some(m => m.userGroupId === groupId) ?? false,
    [userMemberships, groupId],
  );

  const handleClick = (): void => {
    if (channelId) {
      void navigate(`/chat/dir/${channelId}/group/${groupId}`);
    }
  };

  return (
    <GroupHoverWrapper groupId={groupId}>
      <span
        data-mention=''
        data-mention-type='group'
        data-group-id={groupId}
        data-group-name={groupName}
        data-group-alias={alias}
        className={
          isCurrentUserInGroup
            ? 'mention-text cursor-pointer !bg-[var(--mention-current-user-bg)] !text-[color:var(--mention-current-user-color,var(--mention-color))]'
            : 'mention-text cursor-pointer'
        }
        onClick={handleClick}
        role='button'
        tabIndex={0}
        data-track-category='MESSAGE'
        data-track-name='VIEW_GROUP_MENTION'
        data-track-metadata={JSON.stringify({ groupId })}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        {alias || groupName}
      </span>
    </GroupHoverWrapper>
  );
}

function CollapsibleConversationHistory({
  children,
  keyPrefix,
}: {
  children: React.ReactNode;
  keyPrefix: string;
}): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleExpanded = (): void => {
    setIsExpanded(!isExpanded);
  };

  return (
    <div className='conversation-history-container' key={`${keyPrefix}-conversation-history`}>
      <button
        type='button'
        onClick={toggleExpanded}
        className='see-more-btn text-primary hover:text-primary/80 font-medium text-sm underline cursor-pointer bg-none border-none p-0 mb-2'
        data-track-category='MESSAGE'
        data-track-name='TOGGLE_CONVERSATION_HISTORY'
        data-track-metadata={JSON.stringify({ isExpanded })}
      >
        {isExpanded ? 'See less' : 'See more'}
      </button>
      <div
        className={`conversation-history-content transition-all duration-200 ${
          isExpanded ? 'block' : 'hidden'
        }`}
        style={{
          marginTop: isExpanded ? '10px' : '0',
          paddingTop: isExpanded ? '10px' : '0',
          borderTop: isExpanded ? '1px solid hsl(var(--border))' : 'none',
        }}
      >
        {children}
      </div>
    </div>
  );
}

const CODE_BLOCK_COLLAPSE_THRESHOLD = 50;
const CODE_BLOCK_PREVIEW_LINES = 20;
const CODE_BLOCK_PREVIEW_MAX_HEIGHT = CODE_BLOCK_PREVIEW_LINES * 20 + 16;

function MessageCodeBlock({
  children,
  codeText,
}: {
  children: React.ReactNode;
  codeText: string;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const resetTimerRef = useRef<number | undefined>(undefined);

  useEffect(
    () => (): void => {
      if (resetTimerRef.current !== undefined) window.clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const handleCopy = (): void => {
    void copyTextToClipboard(codeText)
      .then(() => {
        setCopied(true);
        resetTimerRef.current = window.setTimeout(() => setCopied(false), 1200);
      })
      .catch((error: unknown) => {
        logger.error(Event.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('Failed to copy code snippet to clipboard'),
          error: error,
        });
      });
  };

  const lines = codeText.length > 0 ? codeText.replace(/\n$/, '').split('\n').length : 0;
  const collapsible = lines > CODE_BLOCK_COLLAPSE_THRESHOLD;

  return (
    <div className='xyne-code-block group/code-block relative my-3 max-w-full overflow-hidden rounded-[10px] border border-border bg-muted'>
      <div
        className='relative overflow-hidden'
        style={
          collapsible && !isExpanded
            ? { maxHeight: `${CODE_BLOCK_PREVIEW_MAX_HEIGHT}px` }
            : undefined
        }
      >
        {children}
        {collapsible && (
          <div
            className={
              isExpanded
                ? 'flex justify-center pb-2'
                : 'pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pt-8 pb-3'
            }
            style={
              isExpanded
                ? undefined
                : {
                    backgroundImage: 'linear-gradient(to bottom, transparent, hsl(var(--muted)))',
                  }
            }
          >
            <button
              type='button'
              onClick={() => setIsExpanded(prev => !prev)}
              className='expand-toggle-pill pointer-events-auto flex items-center gap-1 rounded-full bg-background px-2.5 py-1.5 text-[13px] leading-none text-foreground transition-colors hover:bg-muted cursor-pointer'
              data-track-category='MESSAGE'
              data-track-name='TOGGLE_CODE_BLOCK'
              data-track-metadata={JSON.stringify({ isExpanded, lineCount: lines })}
            >
              <MaximizeTwoArrow size={16} className={isExpanded ? 'rotate-180' : undefined} />
              <span>{isExpanded ? 'Show less' : `Show more (${lines} lines)`}</span>
            </button>
          </div>
        )}
      </div>

      <button
        type='button'
        onClick={handleCopy}
        className='absolute right-2 top-2 z-10 flex items-center rounded-md border border-border bg-background p-0.5 text-muted-foreground opacity-100 shadow-sm transition-opacity hover:text-foreground md:opacity-0 group-hover/code-block:opacity-100 focus-visible:opacity-100'
        aria-label='Copy code snippet'
        title='Copy code snippet'
        data-track-category='MESSAGE'
        data-track-name='COPY_CODE_SNIPPET'
      >
        <span className='flex items-center justify-center p-1'>
          {copied ? (
            <CopyCopied size={16} className='text-status-success' />
          ) : (
            <CopyDefault size={16} />
          )}
        </span>
      </button>
      <span aria-live='polite' className='sr-only'>
        {copied ? 'Code snippet copied to clipboard' : ''}
      </span>
    </div>
  );
}

const tokenizeToReactNodes = (
  text: string,
  skipEmojiWrapping: boolean,
  keyPrefix: string,
): React.ReactNode[] => {
  const tokens = tokenizeMessage(text, skipEmojiWrapping);
  return tokens.map((token, i) =>
    token.type === 'emoji' ? (
      <span key={`${keyPrefix}-${i}`} className='inline-emoji'>
        {token.content}
      </span>
    ) : (
      <React.Fragment key={`${keyPrefix}-${i}`}>{token.content}</React.Fragment>
    ),
  );
};

const addTokenizedNodes = (
  parts: React.ReactNode[],
  text: string,
  skipEmojiWrapping: boolean,
  keyPrefix: string,
): void => {
  const tokens = tokenizeMessage(text, skipEmojiWrapping);
  tokens.forEach((token, i) => {
    if (token.type === 'emoji') {
      parts.push(
        <span key={`${keyPrefix}-${i}`} className='inline-emoji'>
          {token.content}
        </span>,
      );
    } else {
      parts.push(token.content);
    }
  });
};

/**
 * Trims only leading and trailing whitespace text nodes on the root body.
 * Internal text spacing stays untouched to preserve user intent.
 */
function isStructurallyEmptyElement(el: HTMLElement): boolean {
  // Treat <br> as empty
  if (el.tagName === 'BR') return true;

  // Elements that are inherently meaningful
  const nonEmptyTags = new Set([
    'IMG',
    'VIDEO',
    'AUDIO',
    'IFRAME',
    'EMBED',
    'OBJECT',
    'INPUT',
    'TEXTAREA',
    'SELECT',
    'TABLE',
    'HR',
    'CANVAS',
    'SVG',
  ]);

  if (nonEmptyTags.has(el.tagName)) return false;

  // A div with data-flow-json is a flow widget placeholder — never treat as empty
  if (el.hasAttribute('data-flow-json')) return false;
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      if ((child.textContent ?? '').trim().length > 0) {
        return false;
      }
    }

    if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as HTMLElement;

      // If any child is not empty → this is not empty
      if (!isStructurallyEmptyElement(childEl)) {
        return false;
      }
    }
  }

  return true;
}

type TrimBoundaryEdge = 'leading' | 'trailing';

function trimBoundary(node: Node, edge: TrimBoundaryEdge): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    const trimmed = edge === 'leading' ? text.replace(/^\s+/, '') : text.replace(/\s+$/, '');
    if (!trimmed) {
      node.parentNode?.removeChild(node);
      return true;
    }
    node.textContent = trimmed;
    return false;
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;

    if (isStructurallyEmptyElement(el)) {
      el.parentNode?.removeChild(el);
      return true;
    }

    while (edge === 'leading' ? el.firstChild : el.lastChild) {
      const child = edge === 'leading' ? el.firstChild! : el.lastChild!;
      if (!trimBoundary(child, edge)) return false;
    }

    if (isStructurallyEmptyElement(el)) {
      el.parentNode?.removeChild(el);
      return true;
    }
  }

  return false;
}

function trimBoundaryWhitespace(body: HTMLElement): void {
  while (body.firstChild && trimBoundary(body.firstChild, 'leading')) {
    continue;
  }
  while (body.lastChild && trimBoundary(body.lastChild, 'trailing')) {
    continue;
  }
}

type TableElementResult = {
  props: Record<string, unknown>;
  wrapper?: JSX.Element;
};

type TableElementHandler = (
  el: HTMLElement,
  props: Record<string, unknown>,
  children: React.ReactNode[],
  idx: number,
  keyPrefix: string,
) => TableElementResult | null;

const handleTableElement = (
  el: HTMLElement,
  props: Record<string, unknown>,
  children: React.ReactNode[],
  idx: number,
  keyPrefix: string,
): TableElementResult | null => {
  const tag = el.tagName.toLowerCase();

  const tableHandlers: Record<string, TableElementHandler> = {
    table: (_el, props, children, idx, keyPrefix) => {
      const { key: _key, ...restProps } = props;
      return {
        props: restProps,
        wrapper: (
          <div key={`${keyPrefix}-table-wrapper-${idx}`} className='overflow-x-auto max-w-full'>
            <table {...(restProps as React.TableHTMLAttributes<HTMLTableElement>)}>
              {children}
            </table>
          </div>
        ),
      };
    },
    td: (el, props) => {
      const newProps: Record<string, unknown> = { ...props };
      const colspan = el.getAttribute('colspan');
      const rowspan = el.getAttribute('rowspan');
      if (colspan) {
        const col = parseInt(colspan, 10);
        if (!isNaN(col)) newProps['colSpan'] = col;
      }
      if (rowspan) {
        const row = parseInt(rowspan, 10);
        if (!isNaN(row)) newProps['rowSpan'] = row;
      }
      return { props: newProps };
    },
    th: (el, props) => {
      const newProps: Record<string, unknown> = { ...props };
      const colspan = el.getAttribute('colspan');
      const rowspan = el.getAttribute('rowspan');
      if (colspan) {
        const col = parseInt(colspan, 10);
        if (!isNaN(col)) newProps['colSpan'] = col;
      }
      if (rowspan) {
        const row = parseInt(rowspan, 10);
        if (!isNaN(row)) newProps['rowSpan'] = row;
      }
      return { props: newProps };
    },
  };

  const handler = tableHandlers[tag];
  return handler ? handler(el, props, children, idx, keyPrefix) : null;
};

const parseNode = (
  node: Node,
  keyPrefix: string,
  idx: number,
  navigate: ReturnType<typeof useNavigate>,
  insideSlackBlockquote = false,
  insideCodeBlock = false,
  skipEmojiWrapping = false,
  breakLongLinks = false,
  messageId?: string,
  conversationId?: string,
  preserveThreadRoute = false,
  slashCommandArtifactContext?: RenderMessageWithHTMLProps['slashCommandArtifactContext'],
): React.ReactNode | null => {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || '';
    // Skip URL auto-linking inside code blocks or code elements
    if (insideCodeBlock || !URL_REGEX.test(text)) {
      // Tokenize text to wrap emojis in spans for larger sizing
      return (
        <React.Fragment key={`${keyPrefix}-text-${idx}`}>
          {tokenizeToReactNodes(text, skipEmojiWrapping, `emoji-${idx}`)}
        </React.Fragment>
      );
    }

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;

    text.replace(URL_REGEX, (url: string, offset: number) => {
      // Tokenize text before URL to wrap emojis
      if (offset > lastIndex) {
        const textBeforeUrl = text.slice(lastIndex, offset);
        addTokenizedNodes(parts, textBeforeUrl, skipEmojiWrapping, `emoji-url-${offset}`);
      }

      if (parseInternalXyneLink(url)) {
        const external = isExternalUrl(url);
        const linkProps = getAnchorTargetProps(url);

        parts.push(
          <InternalXyneLink
            key={`${keyPrefix}-url-${offset}`}
            href={url}
            {...linkProps}
            className={cn('text-primary', breakLongLinks && 'break-all')}
            data-track-category='MESSAGE'
            data-track-name={external ? 'ClickExternalLink' : 'ClickInternalLink'}
            data-track-metadata={JSON.stringify({ url, isExternal: external })}
          >
            {url}
          </InternalXyneLink>,
        );
      } else {
        const external = isExternalUrl(url);
        const linkProps = getAnchorTargetProps(url);

        parts.push(
          <a
            key={`${keyPrefix}-url-${offset}`}
            href={url}
            {...linkProps}
            className={cn('text-primary hover:underline', breakLongLinks && 'break-all')}
            data-track-category='MESSAGE'
            data-track-name='ClickExternalLink'
            data-track-metadata={JSON.stringify({ url, isExternal: external })}
          >
            {url}
          </a>,
        );
      }

      lastIndex = offset + url.length;
      return url;
    });

    // Tokenize remaining text after last URL
    if (lastIndex < text.length) {
      const remainingText = text.slice(lastIndex);
      addTokenizedNodes(parts, remainingText, skipEmojiWrapping, `emoji-end-${idx}`);
    }
    return <React.Fragment key={`${keyPrefix}-text-${idx}`}>{parts}</React.Fragment>;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (el.hasAttribute('data-mention') && el.getAttribute('data-mention-type') === 'user') {
    const userId = el.getAttribute('data-user-id') || '';
    const username = el.getAttribute('data-username') || undefined;

    return (
      <MentionRenderer
        key={`${keyPrefix}-mention-${idx}`}
        userId={userId}
        fallbackName={username}
        preserveThreadRoute={preserveThreadRoute}
      />
    );
  }

  if (el.getAttribute('data-mention-type') === 'group') {
    const groupName = el.getAttribute('data-group-name') || '';
    const groupId = el.getAttribute('data-group-id') || '';
    // const count = parseInt(el.getAttribute('data-member-count') || '0', 10);
    const alias = el.getAttribute('data-group-alias') || '';

    return (
      <GroupMentionRenderer
        key={`${keyPrefix}-group-${idx}`}
        groupId={groupId}
        groupName={groupName}
        alias={alias}
      />
    );
  }

  // Special mentions (@channel and @here)
  if (el.getAttribute('data-mention-type') === 'channel') {
    return (
      <GenericMentionHoverPopover
        key={`${keyPrefix}-special-channel-${idx}`}
        data={{
          icon: '📢',
          title: 'Channel Mention',
          subtitle: 'Notifies all members in this channel',
        }}
      >
        <span data-mention='' data-mention-type='channel' className='chat-input-special-mention'>
          @channel
        </span>
      </GenericMentionHoverPopover>
    );
  }

  if (el.getAttribute('data-mention-type') === 'here') {
    return (
      <GenericMentionHoverPopover
        key={`${keyPrefix}-special-here-${idx}`}
        data={{
          icon: '👋',
          title: 'Here Mention',
          subtitle: 'Notifies all online members',
        }}
      >
        <span data-mention='' data-mention-type='here' className='chat-input-special-mention'>
          @here
        </span>
      </GenericMentionHoverPopover>
    );
  }

  if (el.hasAttribute('data-channel-mention')) {
    const channelName = el.getAttribute('data-channel-name') || '';
    const channelId = el.getAttribute('data-channel-id') || '';
    const isPrivate = el.getAttribute('data-is-private') === 'true';

    return (
      <ChannelMentionRenderer
        key={`${keyPrefix}-channel-${idx}`}
        channelId={channelId}
        channelName={channelName}
        isPrivate={isPrivate}
        navigate={navigate}
      />
    );
  }

  // Handle bot tool outputs embedded in messages
  if (el.hasAttribute('data-bot-tool')) {
    const toolDataStr = el.getAttribute('data-tool-data');

    try {
      const toolOutput = JSON.parse(toolDataStr || '{}') as GeniusToolOutput;
      return (
        <div key={`${keyPrefix}-tool-${idx}`} className='mt-3 w-full max-w-[500px] overflow-hidden'>
          {toolOutput.description && (
            <div className='text-sm text-muted-foreground mb-2 leading-[1.8]'>
              {toolOutput.description}
            </div>
          )}
          <ToolOutputRenderer
            toolOutput={toolOutput}
            className={toolOutput.singleStat ? '' : 'border border-border rounded-lg'}
          />
        </div>
      );
    } catch {
      // Invalid JSON, skip rendering
      return null;
    }
  }

  // Handle embedded flow JSON — render FlowScreenManager in place of the div
  if (el.hasAttribute('data-flow-json')) {
    const raw = el.getAttribute('data-flow-json');
    logger.info(Event.FRONTEND_ERROR, {
      type: 'migrated_console_log',
      message: String('[RenderMsg] data-flow-json found, raw length:'),
      context: [raw?.length, 'messageId:', messageId, 'conversationId:', conversationId],
    });
    if (raw) {
      try {
        const flowJSON = JSON.parse(raw) as FlowDefinition;
        logger.info(Event.FRONTEND_ERROR, {
          type: 'migrated_console_log',
          message: String('[RenderMsg] parsed flowJSON ok, screenId:'),
          context: [flowJSON.screenId],
        });
        return (
          <FlowScreenManager
            key={`${keyPrefix}-flow-${idx}-${flowJSON.screenId}`}
            flow={flowJSON}
            messageId={messageId ?? ''}
            conversationId={conversationId ?? ''}
            {...(slashCommandArtifactContext && {
              messageContext: slashCommandArtifactContext,
            })}
          />
        );
      } catch (e) {
        logger.error(Event.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('[RenderMsg] failed to parse data-flow-json:'),
          error: e,
        });
        return null;
      }
    }
  }

  // Check if this is a conversation history container
  const isZohoConversationHistory =
    tag === 'div' &&
    el.getAttribute('data-has-history') === 'true' &&
    el.classList.contains('conversation-history-container'); // conversation-history-container is coming from zoho only

  // Check if this is a slack blockquote
  const isSlackBlockquote = tag === 'blockquote' && el.getAttribute('data-slack') === 'true';
  const shouldPreserveStyles = insideSlackBlockquote || isSlackBlockquote;

  // Check if this is a code block or inline code element
  const isCodeElement = tag === 'code' || tag === 'pre';
  const isAnchor = tag === 'a';
  const shouldSkipAutoLink = insideCodeBlock || isCodeElement || isAnchor;

  const children: React.ReactNode[] = [];
  let childIdx = 0;

  el.childNodes.forEach(child => {
    const parsed = parseNode(
      child,
      keyPrefix,
      childIdx++,
      navigate,
      shouldPreserveStyles,
      shouldSkipAutoLink,
      skipEmojiWrapping,
      breakLongLinks,
      messageId,
      conversationId,
      preserveThreadRoute,
      slashCommandArtifactContext,
    );
    if (parsed !== null) children.push(parsed);
  });

  // Handle conversation history containers specially
  if (isZohoConversationHistory) {
    return (
      <CollapsibleConversationHistory keyPrefix={keyPrefix}>
        {children}
      </CollapsibleConversationHistory>
    );
  }

  if (tag === 'br') return <br key={`${keyPrefix}-br-${idx}`} />;

  // Handle <hi> tag for search result highlighting
  if (tag === 'hi') {
    return (
      <mark
        key={`${keyPrefix}-highlight-${idx}`}
        className='search-result-highlight text-inherit font-inherit'
      >
        {children}
      </mark>
    );
  }

  if (!ALLOWED_TAGS.has(tag)) {
    return <React.Fragment key={`${keyPrefix}-fragment-${idx}`}>{children}</React.Fragment>;
  }

  let props: Record<string, unknown> = { key: `${keyPrefix}-${tag}-${idx}` };

  const className = el.getAttribute('class');
  if (className) {
    props['className'] = className;
  }

  // Forward data-* attributes for span elements (e.g. data-search-show-more, data-has-history)
  if (tag === 'span') {
    [...el.attributes].forEach(attr => {
      if (attr.name.startsWith('data-')) {
        props[attr.name] = attr.value;
      }
    });
  }

  if (tag === 'ol') {
    const start = el.getAttribute('start');
    const type = el.getAttribute('type');
    if (start) {
      const parsedStart = parseInt(start, 10);
      if (!isNaN(parsedStart)) {
        (props as { start?: number }).start = parsedStart;
      }
    }
    if (type) {
      (props as { type?: string }).type = type;
    }
  }

  // Parse style attribute only for slack blockquote or its children
  const styleAttr = el.getAttribute('style');
  if (styleAttr && shouldPreserveStyles) {
    const styleObj: Record<string, string> = {};
    styleAttr.split(';').forEach(declaration => {
      const colonIndex = declaration.indexOf(':');
      if (colonIndex === -1) return;

      const property = declaration.slice(0, colonIndex).trim();
      const value = declaration.slice(colonIndex + 1).trim();

      if (property && value) {
        // CSS custom properties (--foo-bar) should be kept as-is
        // Regular properties (foo-bar) should be converted to camelCase (fooBar)
        if (property.startsWith('--')) {
          styleObj[property] = value;
        } else {
          const camelProperty = property.replace(/-([a-z])/g, (_match: string, letter: string) =>
            letter.toUpperCase(),
          );
          styleObj[camelProperty] = value;
        }
      }
    });
    if (Object.keys(styleObj).length > 0) {
      props['style'] = styleObj;
    }
  }

  // Handle custom emoji images (data-emoji="true")
  if (tag === 'img' && el.getAttribute('data-emoji') === 'true') {
    const src = el.getAttribute('src');
    const alt = el.getAttribute('alt');
    const title = el.getAttribute('title');
    const emojiId = el.getAttribute('data-emoji-id');

    // Construct emoji URL dynamically at render time
    // Handles both new relative paths (/api/emojis/{id}/stream)
    // and old absolute URLs by extracting emojiId
    if (emojiId) {
      // Always use current window origin for cross-platform compatibility
      (props as { src: string; alt?: string; title?: string }).src =
        `${API_BASE_URL}/emojis/${emojiId}/stream`;
    } else if (src && isValidURL(src)) {
      // Fallback: try to extract emojiId from old-style URL
      const match = src.match(/\/api\/emojis\/([^/]+)\/stream/);
      if (match && match[1]) {
        (props as { src: string; alt?: string; title?: string }).src =
          `${API_BASE_URL}/emojis/${match[1]}/stream`;
      } else {
        (props as { src: string; alt?: string; title?: string }).src = src;
      }
    }
    if (alt) {
      (props as { src: string; alt?: string; title?: string }).alt = alt;
    }
    if (title) {
      (props as { src: string; alt?: string; title?: string }).title = title;
    }
  }

  if (tag === 'img' && shouldPreserveStyles) {
    const src = el.getAttribute('src');
    const alt = el.getAttribute('alt');

    if (src && isValidURL(src)) {
      (props as { src: string; alt?: string }).src = src;
    }
    if (alt) {
      (props as { src: string; alt?: string }).alt = alt;
    }
  }

  if (tag === 'a') {
    let href = el.getAttribute('href');
    if (href && isValidURL(href)) {
      href = patchLegacyInternalUrl(href);
      const urlObj = new URL(href, window.location.origin);
      if (parseInternalXyneLink(href)) {
        const { key, ...restProps } = props;
        const linkProps = { ...restProps, href };
        const external = isExternalUrl(href);
        if (external) {
          (linkProps as { target?: string; rel?: string }).target = '_blank';
          (linkProps as { target?: string; rel?: string }).rel = 'noopener noreferrer';
        }
        return (
          <InternalXyneLink
            key={key as string}
            {...(linkProps as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
          >
            {children}
          </InternalXyneLink>
        );
      }

      (props as { href: string; target: string; rel: string }).href = href;

      // Only open external links in new tab
      const isExternal = isExternalUrl(href);

      if (isExternal) {
        (props as { href: string; target: string; rel: string }).target = '_blank';
        (props as { href: string; target: string; rel: string }).rel = 'noopener noreferrer';
        const externalHref = href;
        props['onClick'] = (e: React.MouseEvent<HTMLAnchorElement>): void => {
          e.preventDefault();
          openLink(externalHref, e);
        };
      } else {
        const isSupportedRoute = urlObj.pathname.startsWith('/chat/');

        if (isElectronApp() && isSupportedRoute) {
          props['onClick'] = (e: React.MouseEvent<HTMLAnchorElement>): void => {
            if (isElectronStandaloneWindow()) {
              e.preventDefault();
              const newPath = `/newWindow${urlObj.pathname}${urlObj.search}${urlObj.hash}`;
              void navigate(newPath);
            } else if (e.metaKey || e.ctrlKey) {
              e.preventDefault();
              const newWindowPath = `/newWindow${urlObj.pathname}${urlObj.search}${urlObj.hash}`;
              const newWindow = window.open(newWindowPath, '_blank');
              if (newWindow) {
                newWindow.focus();
              }
            }
          };
        }
      }
      props['data-track-category'] = 'MESSAGE';
      props['data-track-name'] = isExternal ? 'ClickExternalLink' : 'ClickInternalLink';
      props['data-track-metadata'] = JSON.stringify({ url: href, isExternal });

      const label = (el.textContent ?? '').trim().replace(/\/+$/, '');
      if (isExternal && label !== href.replace(/\/+$/, '')) {
        const { key, ...anchorProps } = props;
        return (
          <LinkHoverCard key={key as string} href={href}>
            {React.createElement(tag, anchorProps, ...children)}
          </LinkHoverCard>
        );
      }
    }
  }

  if (tag === 'button' && shouldPreserveStyles) {
    const disabled = el.getAttribute('disabled');
    if (disabled !== null) {
      (props as { disabled: boolean }).disabled = true;
    }
  }

  const tableResult = handleTableElement(el, props, children, idx, keyPrefix);
  if (tableResult) {
    if (tableResult.wrapper) {
      return tableResult.wrapper;
    }
    props = tableResult.props;
  }

  if (tag === 'pre') {
    const codeText = el.textContent ?? '';
    return (
      <MessageCodeBlock key={`${keyPrefix}-code-block-${idx}`} codeText={codeText}>
        {React.createElement(tag, props, ...children)}
      </MessageCodeBlock>
    );
  }

  return React.createElement(tag, props, ...children);
};

export const RenderMessageWithHTML: React.FC<RenderMessageWithHTMLProps> = ({
  message,
  showEdited = false,
  isSystemMessage = false,
  breakLongLinks = false,
  messageId,
  conversationId,
  preserveThreadRoute = false,
  slashCommandArtifactContext,
}): JSX.Element => {
  const navigate = useNavigate();
  const keyPrefix = useMemo<string>(() => Math.random().toString(36).slice(2), []);

  const parsedContent = useMemo<React.ReactNode[]>(() => {
    try {
      if (!message || typeof message !== 'string') return [];

      if (message.includes('data-flow-json')) {
        logger.info(Event.FRONTEND_ERROR, {
          type: 'migrated_console_log',
          message: String('[RenderMsg] content contains data-flow-json, messageId:'),
          context: [messageId, 'len:', message.length],
        });
      }

      const safe = message.slice(0, MAX_HTML_LENGTH).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const parser = new DOMParser();
      const doc = parser.parseFromString(safe, 'text/html');

      sanitizeDomTree(doc.body);

      trimBoundaryWhitespace(doc.body);

      const nodes: React.ReactNode[] = [];
      let idx = 0;

      // Reuse the already-parsed tree — isEmojiOnly(html) would re-parse the
      // whole message with DOMParser a third time.
      const skipEmojiWrapping = isEmojiOnlyFromDom(doc.body);

      doc.body.childNodes.forEach((child: Node) => {
        const parsed = parseNode(
          child,
          keyPrefix,
          idx++,
          navigate,
          false,
          false,
          skipEmojiWrapping,
          breakLongLinks,
          messageId,
          conversationId,
          preserveThreadRoute,
          slashCommandArtifactContext,
        );
        if (parsed !== null) nodes.push(parsed);
      });

      return nodes;
    } catch {
      return [message.replace(/<[^>]*>/g, '')];
    }
  }, [
    message,
    keyPrefix,
    navigate,
    breakLongLinks,
    messageId,
    conversationId,
    preserveThreadRoute,
    slashCommandArtifactContext,
  ]);

  // Inject (edited) into the last element if it's safe to do so
  const contentWithEdited = useMemo(() => {
    if (!showEdited || parsedContent.length === 0) return parsedContent;

    const editedSpan = (
      <span key={`edited-${keyPrefix}`} className='text-xs text-muted-foreground ml-1.5'>
        (edited)
      </span>
    );
    const lastIndex = parsedContent.length - 1;
    const lastElement = parsedContent[lastIndex];
    if (!React.isValidElement(lastElement)) {
      return [...parsedContent, editedSpan];
    }

    try {
      const elementType = lastElement.type;

      const safeElements = ['p', 'div', 'span'];

      if (typeof elementType === 'string' && safeElements.includes(elementType)) {
        // Type assert to safely access children property
        const element = lastElement as React.ReactElement<{ children?: React.ReactNode }>;
        const existingChildren = element.props.children;
        const childrenArray: React.ReactNode[] = Array.isArray(existingChildren)
          ? (existingChildren as React.ReactNode[])
          : existingChildren !== undefined
            ? [existingChildren]
            : [];

        const filteredChildren = childrenArray.filter(
          (child): child is NonNullable<React.ReactNode> => child !== undefined && child !== null,
        );

        const modifiedLast = React.cloneElement(lastElement, {}, ...filteredChildren, editedSpan);

        return [...parsedContent.slice(0, lastIndex), modifiedLast];
      }
    } catch {
      // Ignore errors and fall through to appending on new line
    }

    // For unsafe elements (lists, blockquotes, etc.), or on error, append on new line
    return [...parsedContent, editedSpan];
  }, [parsedContent, showEdited, keyPrefix]);

  return (
    <div
      className={cn(
        'message-html-root jp-message-html',
        isSystemMessage ? 'text-muted-foreground' : '',
      )}
    >
      {contentWithEdited}
    </div>
  );
};
