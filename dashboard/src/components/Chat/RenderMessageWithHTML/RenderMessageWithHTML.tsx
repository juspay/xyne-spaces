import React, { JSX, useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { usePlatform } from '../../../hooks/usePlatform';
import { Lock, Users, Clock } from 'lucide-react';
import { highlightCodeBlocks } from './utils';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { UserHoverWrapper } from '../../ui/UserMentionPopover/UserMentionPopover';
import { useChannel } from '../../../hooks/useChannels';
import { GenericMentionHoverPopover } from '../../ui/GenericMentionPopover/GenericMentionPopover';
import { ALLOWED_TAGS, isValidURL, sanitizeDomTree } from '../../../utils/sanitizer';
import { tokenizeMessage, isEmojiOnly } from '../../../utils/emojiUtils';
import { useUsers } from '../../../hooks/useUsers';
import { GroupHoverWrapper } from '../../ui/GroupMentionPopover/GroupMentionPopover';
import { ToolOutputRenderer, type ToolOutput as GeniusToolOutput } from 'cosmic-ai-genius';
import { cn } from '../../../utils/classNames';
import { isElectronApp, isElectronStandaloneWindow } from '../../../utils/electronApp';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';

interface RenderMessageWithHTMLProps {
  message: string;
  onSendMessage?: (userId: string) => void;
  onChannelClick?: (channelId: string) => void;
  showEdited?: boolean;
  isSystemMessage?: boolean;
  breakLongLinks?: boolean;
}

const MAX_HTML_LENGTH = 100000;

const URL_REGEX = /https?:\/\/[^\s<]+[^<.,:;"')\]\s]/gi;

const CanvasLink = ({
  href,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>): JSX.Element => {
  const navigate = useNavigate();
  const location = useLocation();
  const { channelId } = useParams<{ channelId: string }>();
  const { isMobile } = usePlatform();

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>): void => {
    if (!href) return;
    const url = new URL(href, window.location.origin);

    // Check for Cmd/Ctrl+Click to open in new tab (desktop only)
    const isCmdClick = event.metaKey || event.ctrlKey;
    if (!isMobile && isCmdClick) {
      event.preventDefault();
      window.open(href, '_blank');
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
      href={href}
      onClick={handleClick}
      {...props}
      data-track-category='MESSAGE'
      data-track-name='OPEN_CANVAS_LINK'
      data-track-metadata={JSON.stringify({ href })}
    >
      {children}
    </a>
  );
};

function MentionRenderer({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}): JSX.Element {
  const context = useAuthContextValues();
  const user = useUsers();

  if (!user) {
    return <>{children}</>;
  }

  const isCurrentUser = context.userID === userId;

  return (
    <UserHoverWrapper userId={userId}>
      <span
        className={
          isCurrentUser
            ? 'mention-text !bg-[var(--mention-current-user-bg)] !text-[color:var(--mention-color)]'
            : 'mention-text'
        }
      >
        {children}
      </span>
    </UserHoverWrapper>
  );
}

function ChannelMentionRenderer({
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
      <span className='text-[color:var(--mention-color)] bg-[var(--mention-channel-bg)] hover:bg-[var(--mention-channel-hover-bg)] px-[2px] pt-[1px] font-normal no-underline transition-colors duration-200 inline whitespace-nowrap leading-none align-baseline '>
        {isPrivate ? <Lock className='h-3 w-3 inline-block mr-0.5 mb-1' /> : '#'}
        {channelName}
      </span>
    </GenericMentionHoverPopover>
  );
}

function GroupMentionRenderer({
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

  const handleClick = (): void => {
    if (channelId) {
      void navigate(`/chat/dir/${channelId}/group/${groupId}`);
    }
  };

  return (
    <GroupHoverWrapper groupId={groupId}>
      <span
        className='mention-text cursor-pointer'
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
      const existingClass = (restProps['className'] as string) || '';
      const tableProps = {
        ...restProps,
        className: cn('border border-gray-300 border-collapse w-full my-2', existingClass),
      };
      return {
        props: tableProps,
        wrapper: (
          <div key={`${keyPrefix}-table-wrapper-${idx}`} className='overflow-x-auto'>
            <table {...(tableProps as React.TableHTMLAttributes<HTMLTableElement>)}>
              {children}
            </table>
          </div>
        ),
      };
    },
    thead: (_el, props) => {
      const existingClass = (props['className'] as string) || '';
      return { props: { ...props, className: cn('bg-gray-50', existingClass) } };
    },
    td: (el, props) => {
      const existingClass = (props['className'] as string) || '';
      const newProps: Record<string, unknown> = {
        ...props,
        className: cn('border border-gray-300 px-3 py-2 text-left', existingClass),
      };
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
      const existingClass = (props['className'] as string) || '';
      const newProps: Record<string, unknown> = {
        ...props,
        className: cn(
          'border border-gray-300 px-3 py-2 text-left font-semibold bg-gray-50',
          existingClass,
        ),
      };
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
    tr: (_el, props) => {
      const existingClass = (props['className'] as string) || '';
      return {
        props: {
          ...props,
          className: cn('border-b border-gray-200 last:border-b-0', existingClass),
        },
      };
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

      // Check if this is a canvas link
      const isCanvasLink = ((): boolean => {
        try {
          const urlObj = new URL(url, window.location.origin);
          return (
            urlObj.origin === window.location.origin && urlObj.pathname.startsWith('/chat/canvas/')
          );
        } catch {
          return false;
        }
      })();

      if (isCanvasLink) {
        parts.push(
          <CanvasLink
            key={`${keyPrefix}-url-${offset}`}
            href={url}
            className={cn('text-primary hover:underline', breakLongLinks && 'break-all')}
          >
            {url}
          </CanvasLink>,
        );
      } else {
        // Check if URL is external before setting target
        const isExternalUrl = ((): boolean => {
          try {
            const urlObj = new URL(url, window.location.origin);
            return urlObj.origin !== window.location.origin;
          } catch {
            return true; // Treat invalid URLs as external for safety
          }
        })();

        const linkProps = isExternalUrl
          ? { target: '_blank' as const, rel: 'noopener noreferrer' }
          : {};

        parts.push(
          <a
            key={`${keyPrefix}-url-${offset}`}
            href={url}
            {...linkProps}
            className={cn('text-primary hover:underline', breakLongLinks && 'break-all')}
            data-track-category='MESSAGE'
            data-track-name='ClickExternalLink'
            data-track-metadata={JSON.stringify({ url, isExternal: isExternalUrl })}
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
    const username = el.getAttribute('data-username') || '';

    return (
      <MentionRenderer key={`${keyPrefix}-mention-${idx}`} userId={userId}>
        {username}
      </MentionRenderer>
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
        <span className='chat-input-special-mention'>@channel</span>
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
        <span className='chat-input-special-mention'>@here</span>
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
        className='bg-yellow-200 text-inherit font-inherit px-0 rounded-sm'
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

    if (src && isValidURL(src)) {
      (props as { src: string; alt?: string; title?: string }).src = src;
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
    const href = el.getAttribute('href');
    if (href && isValidURL(href)) {
      const urlObj = new URL(href, window.location.origin);
      if (urlObj.origin === window.location.origin && urlObj.pathname.startsWith('/chat/canvas/')) {
        const { key, ...restProps } = props;
        const linkProps = { ...restProps, href };
        return (
          <CanvasLink
            key={key as string}
            {...(linkProps as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
          >
            {children}
          </CanvasLink>
        );
      }

      (props as { href: string; target: string; rel: string }).href = href;

      // Only open external links in new tab
      const isExternal = urlObj.origin !== window.location.origin;

      if (isExternal) {
        (props as { href: string; target: string; rel: string }).target = '_blank';
        (props as { href: string; target: string; rel: string }).rel = 'noopener noreferrer';
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

  return React.createElement(tag, props, ...children);
};

export const RenderMessageWithHTML: React.FC<RenderMessageWithHTMLProps> = ({
  message,
  showEdited = false,
  isSystemMessage = false,
  breakLongLinks = false,
}): JSX.Element => {
  const navigate = useNavigate();
  const keyPrefix = useMemo<string>(() => Math.random().toString(36).slice(2), []);

  const parsedContent = useMemo<React.ReactNode[]>(() => {
    try {
      if (!message || typeof message !== 'string') return [];

      const safe = message.slice(0, MAX_HTML_LENGTH);
      const parser = new DOMParser();
      const doc = parser.parseFromString(safe, 'text/html');

      sanitizeDomTree(doc.body);

      try {
        const highlightedHTML = highlightCodeBlocks(doc.body.innerHTML);
        const tempDoc = new DOMParser().parseFromString(highlightedHTML, 'text/html');
        while (doc.body.firstChild) {
          doc.body.removeChild(doc.body.firstChild);
        }
        // This moves nodes from tempDoc.body to doc.body without string parsing
        while (tempDoc.body.firstChild) {
          doc.body.appendChild(tempDoc.body.firstChild);
        }
      } catch {
        // If highlighting fails, leave content as-is (already sanitized)
      }

      const nodes: React.ReactNode[] = [];
      let idx = 0;

      const sanitizedHtml = doc.body.innerHTML;
      const skipEmojiWrapping = isEmojiOnly(sanitizedHtml);

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
        );
        if (parsed !== null) nodes.push(parsed);
      });

      return nodes;
    } catch {
      return [message.replace(/<[^>]*>/g, '')];
    }
  }, [message, keyPrefix, navigate, breakLongLinks]);

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
    <div className={cn('message-html-root', isSystemMessage ? 'text-[#747474]' : '')}>
      {contentWithEdited}
    </div>
  );
};
