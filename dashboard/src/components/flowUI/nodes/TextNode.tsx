import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { FlowComponent } from '@xyne/shared';
import { cn } from '../../../utils/classNames';
import {
  MentionRenderer,
  ChannelMentionRenderer,
  GroupMentionRenderer,
} from '../../Chat/RenderMessageWithHTML/RenderMessageWithHTML';
import { useChannel } from '../../../hooks/useChannels';

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
//   `code`               → <code> badge
//   <https://…|label>    → <a> with label
//   <https://…>          → <a> bare URL
//   plain text           → <span>
// ---------------------------------------------------------------------------

type InlinePart =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; label: string }
  | { type: 'user'; value: string }
  | { type: 'channel'; value: string }
  | { type: 'group'; value: string; name: string; alias: string };

// Order of alternations is match priority.
const INLINE_RE =
  /<(userid|channelid|groupid):([\w.-]+)(?::([^>]+))?>|\*([^*\n]+)\*|_([^_\n]+)_|`([^`\n]+)`|<(https?:[^|>\s]+)\|([^>]+)>|<(https?:[^>\s]+)>/g;

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
      const mentionType = match[1] as 'userid' | 'channelid' | 'groupid';
      const id = match[2] ?? '';
      const alias = match[3];
      if (mentionType === 'userid') parts.push({ type: 'user', value: id });
      else if (mentionType === 'channelid') parts.push({ type: 'channel', value: id });
      else parts.push({ type: 'group', value: id, name: alias ?? id, alias: alias ?? '' });
    } else if (match[4] !== undefined) {
      parts.push({ type: 'bold', value: match[4] });
    } else if (match[5] !== undefined) {
      parts.push({ type: 'italic', value: match[5] });
    } else if (match[6] !== undefined) {
      parts.push({ type: 'code', value: match[6] });
    } else if (match[7] !== undefined && match[8] !== undefined) {
      parts.push({ type: 'link', href: match[7], label: match[8] });
    } else if (match[9] !== undefined) {
      parts.push({ type: 'link', href: match[9], label: match[9] });
    }

    lastIndex = INLINE_RE.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push({ type: 'text', value: content.slice(lastIndex) });
  }
  return parts;
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
  const props = node.props as
    | {
        content: string;
        variant?: 'default' | 'muted' | 'success' | 'warning' | 'danger' | 'accent';
        size?: 'xs' | 'sm' | 'base' | 'lg' | 'xl';
        bold?: boolean;
        italic?: boolean;
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
    success: 'text-green-600',
    warning: 'text-yellow-600',
    danger: 'text-red-600',
    accent: 'text-action-primary',
  };

  if (!props?.content) return null;

  const renderPart = (part: InlinePart, key: number): React.ReactNode => {
    switch (part.type) {
      case 'user':
        return <MentionRenderer key={key} userId={part.value} />;
      case 'channel':
        return <FlowChannelMention key={key} channelId={part.value} />;
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
        return <strong key={key}>{part.value}</strong>;
      case 'italic':
        return <em key={key}>{part.value}</em>;
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
            className='text-blue-600 underline hover:text-blue-800 break-all'
          >
            {part.label}
          </a>
        );
      default:
        return <span key={key}>{(part as { value: string }).value}</span>;
    }
  };

  // Render multi-line content inline with <br /> so the component stays a
  // single <p> (no nested block elements).
  const lines = props.content.split('\n');

  return (
    <p
      className={cn(
        sizeClasses[props.size ?? 'base'],
        variantClasses[props.variant ?? 'default'],
        props.bold && 'font-semibold',
        props.italic && 'italic',
        'leading-relaxed',
      )}
      style={node.style}
    >
      {lines.map((line, lineIndex) => (
        <React.Fragment key={lineIndex}>
          {lineIndex > 0 && <br />}
          {parseInlineContent(line).map((part, partIndex) => renderPart(part, partIndex))}
        </React.Fragment>
      ))}
      {children}
    </p>
  );
};
