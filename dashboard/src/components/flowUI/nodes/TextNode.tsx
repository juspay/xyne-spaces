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

interface TextNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

// Wrapper component for channel mentions that resolves channel info via hook
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

type MentionPart =
  | { type: 'text'; value: string }
  | { type: 'user'; value: string }
  | { type: 'channel'; value: string }
  | { type: 'group'; value: string; name: string; alias: string };

// Parse text and split into regular text, user mentions, channel mentions, and group mentions
// Supported formats:
//   <userid:USERID>          — user mention
//   <channelid:CHANID>       — channel mention
//   <groupid:GROUPID>        — group mention
//   <groupid:GROUPID:alias>  — group mention with alias
const parseMentions = (content: string): MentionPart[] => {
  const mentionRegex = /<(userid|channelid|groupid):([\w-]+)(?::([^>]+))?>/g;
  const parts: MentionPart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(content)) !== null) {
    // Add text before the mention
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: content.slice(lastIndex, match.index) });
    }

    const mentionType = match[1] as 'userid' | 'channelid' | 'groupid';
    const mentionValue = match[2];
    const mentionAlias = match[3]; // Only used for group mentions

    if (mentionValue) {
      if (mentionType === 'userid') {
        parts.push({ type: 'user', value: mentionValue });
      } else if (mentionType === 'channelid') {
        parts.push({ type: 'channel', value: mentionValue });
      } else if (mentionType === 'groupid') {
        parts.push({
          type: 'group',
          value: mentionValue,
          name: mentionAlias || mentionValue,
          alias: mentionAlias || '',
        });
      }
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    parts.push({ type: 'text', value: content.slice(lastIndex) });
  }

  return parts;
};

export const TextNode: React.FC<TextNodeProps> = ({ node, children }) => {
  const props = node.props as
    | {
        content: string;
        variant?: 'default' | 'muted' | 'accent';
        size?: 'sm' | 'md' | 'lg';
      }
    | undefined;

  const sizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };

  const variantClasses = {
    default: 'text-foreground',
    muted: 'text-muted-foreground',
    accent: 'text-action-primary',
  };

  if (!props?.content) return null;

  const parts = parseMentions(props.content);

  return (
    <p
      className={cn(
        sizeClasses[props.size || 'md'],
        variantClasses[props.variant || 'default'],
        'leading-relaxed',
      )}
      style={node.style}
    >
      {parts.map((part, index) =>
        part.type === 'user' ? (
          <MentionRenderer key={index} userId={part.value} />
        ) : part.type === 'channel' ? (
          <FlowChannelMention key={index} channelId={part.value} />
        ) : part.type === 'group' ? (
          <GroupMentionRenderer
            key={index}
            groupId={part.value}
            groupName={part.name}
            alias={part.alias}
          />
        ) : (
          <span key={index}>{part.value}</span>
        ),
      )}
      {children}
    </p>
  );
};
