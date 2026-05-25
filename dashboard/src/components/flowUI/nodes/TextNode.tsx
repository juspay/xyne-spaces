import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { FlowComponent } from '@xyne/shared';
import { cn } from '../../../utils/classNames';
import {
  MentionRenderer,
  ChannelMentionRenderer,
  GroupMentionRenderer,
} from '../../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { GenericMentionHoverPopover } from '../../ui/GenericMentionPopover/GenericMentionPopover';
import { useChannel } from '../../../hooks/useChannels';
import { useCustomEmojis } from '../../../hooks/useCustomEmojis';

// ---------------------------------------------------------------------------
// Inline content parser
//
// Parses a content string with mixed mrkdwn tokens and Xyne mention tokens.
// Recognised tokens (in priority order):
//
//   <userid:ID>          → MentionRenderer
//   <channelid:ID>       → ChannelMentionRenderer
//   <groupid:ID:alias>   → GroupMentionRenderer
//   *bold*               → <strong>
//   _italic_             → <em>
//   ~strike~             → <s>
//   `code`               → <code> badge
//   <u>…</u>             → <u>
//   <https://…|label>    → <a> with label
//   <https://…>          → <a> bare URL
//   plain text           → <span>
// ---------------------------------------------------------------------------

type InlinePart =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'strike'; value: string }
  | { type: 'underline'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; label: string }
  | { type: 'user'; value: string }
  | { type: 'channel'; value: string }
  | { type: 'broadcast'; range: string }
  | { type: 'group'; value: string; name: string; alias: string }
  | { type: 'emoji'; name: string };

// Order of alternations is match priority.
// Groups:
//  1,2,3 → mention type/id/alias
//  4     → bold
//  5     → italic
//  6     → strike
//  7     → inline code
//  8     → underline
//  9,10  → labeled link
//  11    → bare slack link (<url>)
//  12    → plain bare URL (https?://...)
//  13    → emoji shortcode
const INLINE_RE =
  /<(userid|channelid|groupid|broadcast):([.\w-]+)(?::([^>]+))?>|(?:^|(?<=[\s({[]))\*([^*\n]+)\*(?=[\s)}\].,;:!?/-]|$)|(?:^|(?<=[\s({[]))_([^_\n]+)_(?=[\s)}\].,;:!?/-]|$)|(?:^|(?<=[\s({[]))~([^~\n]+)~(?=[\s)}\].,;:!?/-]|$)|(?:^|(?<=[\s({[]))`([^`\n]+)`(?=[\s)}\].,;:!?/-]|$)|<u>([^<]+)<\/u>|<(https?:[^|>]+)\|([^>]+)>|<(https?:[^>\s]+)>|(https?:\/\/[^\s<>,"]+)|:([a-zA-Z0-9_+-]{1,50}):/g;
function parseInlineContent(content: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let lastIndex = 0;
  INLINE_RE.lastIndex = 0; // reset stateful regex

  let match: RegExpExecArray | null;
  while ((match = INLINE_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: content.slice(lastIndex, match.index) });
    }

    if (match[1]) {
      const mentionType = match[1] as 'userid' | 'channelid' | 'groupid' | 'broadcast';
      const id = match[2] ?? '';
      const alias = match[3];
      if (mentionType === 'userid') parts.push({ type: 'user', value: id });
      else if (mentionType === 'channelid') parts.push({ type: 'channel', value: id });
      else if (mentionType === 'broadcast') parts.push({ type: 'broadcast', range: id });
      else parts.push({ type: 'group', value: id, name: alias ?? id, alias: alias ?? '' });
    } else if (match[4] !== undefined) {
      parts.push({ type: 'bold', value: match[4] });
    } else if (match[5] !== undefined) {
      parts.push({ type: 'italic', value: match[5] });
    } else if (match[6] !== undefined) {
      parts.push({ type: 'strike', value: match[6] });
    } else if (match[7] !== undefined) {
      parts.push({ type: 'code', value: match[7] });
    } else if (match[8] !== undefined) {
      parts.push({ type: 'underline', value: match[8] });
    } else if (match[9] !== undefined && match[10] !== undefined) {
      parts.push({ type: 'link', href: match[9], label: match[10] });
    } else if (match[11] !== undefined) {
      parts.push({ type: 'link', href: match[11], label: match[11] });
    } else if (match[12] !== undefined) {
      parts.push({ type: 'link', href: match[12], label: match[12] });
    } else if (match[13] !== undefined) {
      parts.push({ type: 'emoji', name: match[13] });
    }

    lastIndex = INLINE_RE.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push({ type: 'text', value: content.slice(lastIndex) });
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Block-level segment parser
//
// Splits a mrkdwn string into logical rendering blocks before inline parsing:
//
//   ```                → code fence open
//   ...code lines...
//   ```                → code fence close  → BlockSegment 'codeblock'
//
//   - item text        → bullet line       → BlockSegment 'bullets' (consecutive)
//
//   everything else    → paragraph lines   → BlockSegment 'paragraph'
// ---------------------------------------------------------------------------

type BlockSegment =
  | { type: 'paragraph'; lines: string[] }
  | { type: 'codeblock'; code: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'ordered'; items: string[] };

function parseBlockSegments(content: string): BlockSegment[] {
  const lines = content.split('\n');
  const segments: BlockSegment[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    // Code fence: line is exactly ``` (optionally with a language hint)
    if (/^```/.test(trimmed)) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test((lines[i] ?? '').trim())) {
        codeLines.push(lines[i] ?? '');
        i++;
      }
      i++; // skip closing ```
      segments.push({ type: 'codeblock', code: codeLines.join('\n') });
      continue;
    }

    // Bullet line: starts with "- ", "* ", or "• " (allow leading whitespace)
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*[-*•]\s+/, ''));
        i++;
      }
      segments.push({ type: 'bullets', items });
      continue;
    }

    // Ordered list line: starts with "1. ", "2. ", etc. (allow leading whitespace)
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      segments.push({ type: 'ordered', items });
      continue;
    }

    // Paragraph: accumulate until we hit a fence, bullet, or ordered list
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      !/^```/.test((lines[i] ?? '').trim()) &&
      !/^\s*[-*•]\s+/.test(lines[i] ?? '') &&
      !/^\s*\d+\.\s+/.test(lines[i] ?? '')
    ) {
      paraLines.push(lines[i] ?? '');
      i++;
    }
    if (paraLines.length > 0) {
      segments.push({ type: 'paragraph', lines: paraLines });
    }
  }

  return segments;
}

// ---------------------------------------------------------------------------

interface TextNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

// Wrapper that resolves channel name via hook (must be a component to use hooks)
const FlowChannelMention: React.FC<{ channelId: string }> = ({ channelId }) => {
  const navigate = useNavigate();
  const channel = useChannel(channelId);
  const channelName = channel?.name || channelId;
  // Channel visibility: check if channel has isPrivate field, otherwise default to false
  const isPrivate = (channel as Record<string, unknown> | undefined)?.['isPrivate'] === true;

  return (
    <ChannelMentionRenderer
      channelId={channelId}
      channelName={channelName}
      isPrivate={isPrivate}
      navigate={navigate}
    />
  );
};

export const TextNode: React.FC<TextNodeProps> = ({ node, children }) => {
  const { data: customEmojis } = useCustomEmojis();
  const emojiMap = React.useMemo(() => {
    const map = new Map<string, string>();
    customEmojis?.forEach(e => e.names.forEach(n => map.set(n, e.imgUrl)));
    return map;
  }, [customEmojis]);

  const props = node.props as
    | {
        content: string;
        variant?: 'default' | 'muted' | 'success' | 'warning' | 'danger' | 'accent';
        size?: 'xs' | 'sm' | 'base' | 'lg' | 'xl';
        bold?: boolean;
        italic?: boolean;
        codeBlock?: boolean;
      }
    | undefined;

  const sizeClasses: Record<string, string> = {
    xs: 'text-xs',
    sm: 'text-xs',
    base: 'text-sm',
    lg: 'text-base',
    xl: 'text-lg',
    // legacy aliases used by older components
    md: 'text-sm',
  };

  const variantClasses: Record<string, string> = {
    default: 'text-foreground',
    muted: 'text-muted-foreground',
    success: 'text-[var(--status-success)]',
    warning: 'text-[var(--status-pending)]',
    danger: 'text-destructive',
    accent: 'text-[var(--action-primary)]',
  };

  if (!props?.content) return null;

  if (props.codeBlock) {
    return (
      <pre
        className={cn(
          sizeClasses[props.size ?? 'base'],
          'my-1 overflow-x-auto rounded bg-muted px-3 py-2 font-mono leading-relaxed text-foreground whitespace-pre-wrap [font-variant-ligatures:none]',
        )}
        style={node.style}
      >
        {props.content}
      </pre>
    );
  }

  const renderPart = (part: InlinePart, key: number): React.ReactNode => {
    switch (part.type) {
      case 'user':
        return <MentionRenderer key={key} userId={part.value} />;
      case 'channel':
        return <FlowChannelMention key={key} channelId={part.value} />;
      case 'broadcast': {
        const broadcastData =
          part.range === 'here'
            ? { icon: '👋', title: 'Here Mention', subtitle: 'Notifies all online members' }
            : {
                icon: '📢',
                title: 'Channel Mention',
                subtitle: 'Notifies all members in this channel',
              };
        return (
          <GenericMentionHoverPopover key={key} data={broadcastData}>
            <span
              data-mention=''
              data-mention-type={part.range}
              className='chat-input-special-mention'
            >
              @{part.range}
            </span>
          </GenericMentionHoverPopover>
        );
      }
      case 'group':
        return (
          <GroupMentionRenderer
            key={key}
            groupId={part.value}
            groupName={part.name}
            alias={part.alias}
          />
        );
      case 'bold':
        return (
          <strong key={key}>
            {parseInlineContent(part.value).map((p, i) => renderPart(p, i))}
          </strong>
        );
      case 'italic':
        return <em key={key}>{parseInlineContent(part.value).map((p, i) => renderPart(p, i))}</em>;
      case 'strike':
        return <s key={key}>{parseInlineContent(part.value).map((p, i) => renderPart(p, i))}</s>;
      case 'underline':
        return <u key={key}>{parseInlineContent(part.value).map((p, i) => renderPart(p, i))}</u>;
      case 'code':
        return (
          <code
            key={key}
            className='bg-muted text-muted-foreground px-1 py-0.5 rounded text-xs font-mono'
          >
            {part.value}
          </code>
        );
      case 'link':
        return (
          <a
            key={key}
            href={part.href}
            target='_blank'
            rel='noopener noreferrer'
            className='text-[var(--link-color)] underline hover:text-[var(--link-hover-color)] break-all'
          >
            {part.label}
          </a>
        );
      case 'emoji': {
        const imgUrl = emojiMap.get(part.name);
        if (imgUrl) {
          return (
            <img
              key={key}
              src={imgUrl}
              alt={`:${part.name}:`}
              title={part.name}
              data-emoji='true'
              className='inline-emoji inline-block w-5 h-5 object-contain align-middle'
            />
          );
        }
        // Not a custom emoji — leave as raw shortcode text
        return <span key={key}>:{part.name}:</span>;
      }
      default:
        return <span key={key}>{(part as { value: string }).value}</span>;
    }
  };

  const textClasses = cn(
    sizeClasses[props.size ?? 'base'],
    variantClasses[props.variant ?? 'default'],
    props.bold && 'font-semibold',
    props.italic && 'italic',
    'leading-relaxed',
  );

  // Render a single paragraph's lines inline with <br />.
  const renderParagraphLines = (lines: string[], keyPrefix: string) =>
    lines.map((line, lineIndex) => (
      <React.Fragment key={`${keyPrefix}-${lineIndex}`}>
        {lineIndex > 0 && <br />}
        {parseInlineContent(line).map((part, partIndex) => renderPart(part, partIndex))}
      </React.Fragment>
    ));

  const segments = parseBlockSegments(props.content);

  // If only one paragraph segment, keep the original single-<p> output for
  // backwards compatibility with existing callers that style the wrapper.
  const firstSeg = segments[0];
  if (segments.length === 1 && firstSeg?.type === 'paragraph') {
    return (
      <p className={textClasses} style={node.style}>
        {renderParagraphLines(firstSeg.lines, 'p0')}
        {children}
      </p>
    );
  }

  return (
    <div className={cn(textClasses, 'flex flex-col gap-1')} style={node.style}>
      {segments.map((seg, segIdx) => {
        if (seg.type === 'codeblock') {
          return (
            <pre
              key={segIdx}
              className='bg-muted text-foreground rounded p-2 text-xs font-mono overflow-x-auto whitespace-pre-wrap [font-variant-ligatures:none]'
            >
              <code>{seg.code}</code>
            </pre>
          );
        }
        if (seg.type === 'bullets') {
          return (
            <ul key={segIdx} className='list-disc pl-6 my-2'>
              {seg.items.map((item, itemIdx) => (
                <li key={itemIdx} className='my-1'>
                  {parseInlineContent(item).map((part, partIndex) => renderPart(part, partIndex))}
                </li>
              ))}
            </ul>
          );
        }
        if (seg.type === 'ordered') {
          return (
            <ol key={segIdx} className='list-decimal pl-6 my-2'>
              {seg.items.map((item, itemIdx) => (
                <li key={itemIdx} className='my-1'>
                  {parseInlineContent(item).map((part, partIndex) => renderPart(part, partIndex))}
                </li>
              ))}
            </ol>
          );
        }
        // paragraph
        return <p key={segIdx}>{renderParagraphLines(seg.lines, `seg${segIdx}`)}</p>;
      })}
      {children}
    </div>
  );
};
