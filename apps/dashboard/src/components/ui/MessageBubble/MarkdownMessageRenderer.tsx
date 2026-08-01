import { memo, useMemo, type FC, type ComponentPropsWithoutRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import {
  MentionRenderer,
  GroupMentionRenderer,
  ChannelMentionRenderer,
} from '../../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { GenericMentionHoverPopover } from '../GenericMentionPopover/GenericMentionPopover';
import type { createMarkdownComponents } from '../../../utils/markdownComponents';

type MarkdownComponents = ReturnType<typeof createMarkdownComponents>;

const MENTION_DATA_ATTRS = [
  'dataMention',
  'dataMentionType',
  'dataUserId',
  'dataUsername',
  'dataGroupId',
  'dataGroupName',
  'dataGroupAlias',
  'dataChannelMention',
  'dataChannelId',
  'dataChannelName',
  'dataIsPrivate',
];

const messageSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    span: [...(defaultSchema.attributes?.['span'] ?? []), 'className', ...MENTION_DATA_ATTRS],
    input: [...(defaultSchema.attributes?.['input'] ?? []), 'checked'],
  },
  // Preserve the synthetic `cite:` / `cite-group:` link schemes emitted by
  // `linkifyAndGroupClawCitations` — rehype-sanitize strips unknown href
  // protocols by default, which would erase the href before the `a` override
  // can substitute a citation chip. (Harmless for non-citation messages.)
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.['href'] ?? []), 'cite', 'cite-group'],
  },
};

interface MarkdownMessageRendererProps {
  content: string;
  markdownComponents: MarkdownComponents;
  messageSubtype?: string | undefined;
}

/**
 * Dispatches <span> elements coming out of rehype-raw to the same mention
 * renderers the HTML message path uses. Agent markdown uses the exact same
 * `data-mention-type` / `data-channel-mention` contract as chat HTML, so
 * this is a thin adapter — keep rendering logic inside the shared components.
 */
const MentionAwareSpan: FC<ComponentPropsWithoutRef<'span'>> = ({ children, ...props }) => {
  const navigate = useNavigate();
  const p = props as Record<string, unknown>;

  const mentionType = p['data-mention-type'] as string | undefined;
  const dataMention = p['data-mention'];
  const hasDataMention = dataMention !== undefined;

  if (hasDataMention && mentionType === 'user') {
    const userId = (p['data-user-id'] as string | undefined) ?? '';
    return <MentionRenderer userId={userId} />;
  }

  if (mentionType === 'group') {
    const groupId = (p['data-group-id'] as string | undefined) ?? '';
    const groupName = (p['data-group-name'] as string | undefined) ?? '';
    const alias = (p['data-group-alias'] as string | undefined) ?? '';
    return <GroupMentionRenderer groupId={groupId} groupName={groupName} alias={alias} />;
  }

  if (mentionType === 'channel') {
    return (
      <GenericMentionHoverPopover
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

  if (mentionType === 'here') {
    return (
      <GenericMentionHoverPopover
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

  if (p['data-channel-mention'] !== undefined) {
    const channelId = (p['data-channel-id'] as string | undefined) ?? '';
    const channelName = (p['data-channel-name'] as string | undefined) ?? '';
    const isPrivate = p['data-is-private'] === 'true';
    return (
      <ChannelMentionRenderer
        channelId={channelId}
        channelName={channelName}
        isPrivate={isPrivate}
        navigate={navigate}
      />
    );
  }

  return <span {...props}>{children}</span>;
};

/**
 * Renders bot/agent markdown message content via react-markdown
 * (remark-gfm + rehype-raw so embedded mention HTML spans reach the DOM,
 * plus a custom `span` that dispatches to the shared mention renderers).
 *
 * Input markdown is expected to already be sanitized upstream (same contract as
 * the HTML message path — see RenderMessageWithHTML).
 *
 * The wrapper class is derived from `messageSubtype` so subtype-specific
 * styling (e.g. call_summary) stays co-located with the renderer.
 *
 * Perf: react-markdown re-parses `content` into an mdast/hast AST, runs
 * rehype-raw + rehype-sanitize, and rebuilds a React element tree on every
 * render. In the chat feed these bubbles re-render on every Zero poke (new
 * message, reaction, presence), so an un-memoized parse is paid repeatedly per
 * agent message. Two guards keep that work off the hot path:
 *   1. `memo` on the export skips re-render entirely when props are unchanged.
 *      Both call sites (MessageBubble.tsx, PlanPreview.tsx) already wrap
 *      `markdownComponents` in `useMemo`, so the prop is referentially stable.
 *   2. `useMemo` around the <Markdown> element caches the parsed tree keyed on
 *      the only inputs that change its output (`content`, `markdownComponents`),
 *      so any re-render that still slips through does not re-parse.
 *
 * Note: there is no in-bubble loader mode — live agent progress is surfaced
 * by the <AgentProgressIndicator /> pill rendered above the chat input
 * (ChatInput.tsx).
 */
const MarkdownMessageRendererComponent: FC<MarkdownMessageRendererProps> = ({
  content,
  markdownComponents,
  messageSubtype,
}) => {
  const className =
    messageSubtype === 'call_summary'
      ? 'bot-markdown-content-call-summary'
      : 'bot-markdown-content';

  // `messageSubtype` only drives the wrapper className (below), not the parsed
  // tree, so it is intentionally excluded from the dependency list.
  const rendered = useMemo(
    () => (
      <Markdown
        remarkPlugins={[remarkGfm]}
        // Bypass react-markdown's built-in href sanitizer so the synthetic
        // `cite:` / `cite-group:` citation schemes survive to the `a` override.
        // rehypeSanitize below is the real safety gate (its `protocols.href`
        // allow-list still governs which schemes render).
        urlTransform={url => url}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, messageSanitizeSchema]]}
        components={{
          ...markdownComponents,
          span: MentionAwareSpan,
        }}
      >
        {content}
      </Markdown>
    ),
    [content, markdownComponents],
  );

  return <div className={`${className} min-w-0`}>{rendered}</div>;
};

export const MarkdownMessageRenderer = memo(MarkdownMessageRendererComponent);
