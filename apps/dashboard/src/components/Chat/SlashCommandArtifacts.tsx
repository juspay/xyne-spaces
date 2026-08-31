import React, { useEffect, useRef, useState } from 'react';
import { Copy, Phone, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  InvitationResponse,
  SLASH_COMMAND_ARTIFACT_DEFINITIONS,
  buildSlashCommandArtifactFlowMessage,
  getSlashCommandArtifactDefinition,
  getSlashCommandArtifactDiagnosticKey,
  parseSlashCommandArtifactMessage,
  slashCommandArtifactPropsSchema,
  type FlowComponent,
  type SlashCommandArtifactClosed,
  type SlashCommandArtifactDefinition,
  type SlashCommandArtifactEndedCall,
} from '@xyne/shared';
import { useActiveCall, useCallDuration } from '../../hooks/useCalls';
import { useChannelParticipation } from '../../hooks/useChannels';
import { useCallJoinOrInitiate } from '../../hooks/useCallJoinOrInitiate';
import { useUser } from '../../hooks/useUsers';
import { useAuthContext } from '../../providers/AuthProvider';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { formatTimeAmPm } from '../../utils/dateUtils';
import { formatElapsedTime } from '../../utils/recordingUtils';
import { Event, logger } from '../../utils/logger';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { useFlow } from '../flowUI/FlowContext';
import { useActiveSlashCommandArtifact } from './SlashCommandArtifactSideEffects';

/**
 * Composer entry for a slash-command artifact. Presentation and side-effect
 * policy come from the shared registry; this only adds what the command
 * selector needs.
 */
export const getSlashCommandArtifactCommandItem = (
  definition: SlashCommandArtifactDefinition,
): {
  id: string;
  name: string;
  description: string;
  category: string;
  badge: string;
  kind: 'slash-command-artifact';
  slashCommandArtifactCommand: string;
} => ({
  id: `builtin-${definition.command}`,
  name: definition.command,
  description: definition.description,
  category: definition.category,
  badge: definition.badge,
  kind: 'slash-command-artifact',
  slashCommandArtifactCommand: definition.command,
});

/** Every registered artifact command, offered in the composer's `/` selector. */
export const SLASH_COMMAND_ARTIFACT_COMMAND_ITEMS = Object.values(
  SLASH_COMMAND_ARTIFACT_DEFINITIONS,
).map(getSlashCommandArtifactCommandItem);

export interface SlashCommandArtifactDraft {
  definition: SlashCommandArtifactDefinition;
  /** The user typed `/command …` inline instead of picking it from the selector. */
  typedInline: boolean;
}

/**
 * Resolve which artifact — if any — the composer is currently drafting, whether
 * it was picked from the selector or typed inline.
 */
export const detectSlashCommandArtifact = (
  activeCommand: string | null,
  plainText: string,
): SlashCommandArtifactDraft | null => {
  const typedCommand = plainText.trim().match(/^\/([a-z0-9][a-z0-9_-]*)(?:\s|$)/i)?.[1];
  const typedDefinition = getSlashCommandArtifactDefinition(typedCommand?.toLowerCase());
  if (typedDefinition) return { definition: typedDefinition, typedInline: true };

  const activeDefinition = getSlashCommandArtifactDefinition(activeCommand);
  return activeDefinition ? { definition: activeDefinition, typedInline: false } : null;
};

/** The artifact body: the composer text minus any inline `/command` prefix. */
export const getSlashCommandArtifactBodyText = (
  draft: SlashCommandArtifactDraft,
  plainText: string,
): string =>
  draft.typedInline
    ? plainText
        .trim()
        .replace(new RegExp(`^/${draft.definition.command}(?:\\s+|$)`, 'i'), '')
        .trim()
    : plainText.trim();

export const isSlashCommandArtifactMessage = (content: string | null | undefined): boolean =>
  !!parseSlashCommandArtifactMessage(content);

/**
 * Route to the artifact message. The banner and the activity feed share this so
 * the two entry points can never disagree about where an artifact lives.
 */
export const buildSlashCommandArtifactRoute = ({
  baseRoute,
  channelId,
  conversationId,
  messageId,
  isInitialMessage,
}: {
  baseRoute: string;
  channelId: string;
  conversationId: string;
  messageId: string;
  isInitialMessage: boolean;
}): string =>
  `${baseRoute}/${channelId}${isInitialMessage ? '' : `/${conversationId}`}` +
  `#origin=${conversationId}${isInitialMessage ? '' : `&messageId=${messageId}`}`;

const wrapInline = (marker: string, content: string): string =>
  content.trim() ? `${marker}${content}${marker}` : content;

/** Convert composer HTML into the mrkdwn/token format used by Flow text nodes. */
export const messageHtmlToFlowText = (html: string): string => {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const renderNode = (node: Node, listIndex?: number): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();
    const mentionType = element.getAttribute('data-mention-type');
    if (mentionType === 'user') {
      const id = element.getAttribute('data-user-id');
      if (id) return `<userid:${id}>`;
    }
    if (mentionType === 'group') {
      const id = element.getAttribute('data-group-id');
      const alias = element.getAttribute('data-group-alias');
      if (id) return alias ? `<groupid:${id}:${alias}>` : `<groupid:${id}>`;
    }
    if (mentionType === 'channel' || mentionType === 'here') {
      return `<broadcast:${mentionType}>`;
    }
    if (element.hasAttribute('data-channel-mention')) {
      const id = element.getAttribute('data-channel-id');
      if (id) return `<channelid:${id}>`;
    }

    if (tag === 'br') return '\n';
    if (tag === 'img') return element.getAttribute('alt') ?? '';

    const childText = Array.from(element.childNodes)
      .map(child => renderNode(child))
      .join('');

    if (tag === 'strong' || tag === 'b') return wrapInline('*', childText);
    if (tag === 'em' || tag === 'i') return wrapInline('_', childText);
    if (tag === 'del' || tag === 's' || tag === 'strike') return wrapInline('~', childText);
    if (tag === 'u') return childText.trim() ? `<u>${childText}</u>` : childText;
    if (tag === 'code') return wrapInline('`', childText);
    if (tag === 'pre') return `\`\`\`\n${childText}\n\`\`\``;
    if (tag === 'a') {
      const href = element.getAttribute('href');
      return href ? `<${href}|${childText || href}>` : childText;
    }
    if (tag === 'blockquote') {
      return `${childText
        .split('\n')
        .map(line => `> ${line}`)
        .join('\n')}\n`;
    }
    if (tag === 'li') {
      return `${listIndex === undefined ? '- ' : `${listIndex}. `}${childText}\n`;
    }
    if (tag === 'ol') {
      return `${Array.from(element.children)
        .map((child, index) => renderNode(child, index + 1))
        .join('')}\n`;
    }
    if (tag === 'ul') {
      return `${Array.from(element.children)
        .map(child => renderNode(child))
        .join('')}\n`;
    }
    if (/^(p|div|h[1-6])$/.test(tag)) return `${childText}\n`;
    return childText;
  };

  return Array.from(doc.body.childNodes)
    .map(node => renderNode(node))
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export const buildSlashCommandArtifactMessage = (
  command: string,
  bodyHtml: string,
  screenId: string,
): string =>
  buildSlashCommandArtifactFlowMessage({
    command,
    body: messageHtmlToFlowText(bodyHtml),
    screenId,
  });

/** Remove the leading `/command` the user typed, leaving the incident body. */
export const stripSlashCommandFromHtml = (command: string, html: string): string => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  const pattern = new RegExp(`^\\s*/${command}(?:\\s+|$)`, 'i');

  while (node) {
    const value = node.textContent ?? '';
    if (value.trim()) {
      node.textContent = value.replace(pattern, '');
      break;
    }
    node = walker.nextNode();
  }

  return doc.body.innerHTML;
};

interface SlashCommandArtifactCardProps {
  children: React.ReactNode;
  definition: SlashCommandArtifactDefinition;
  /** Summary of the last finished call, baked into the message by the server. */
  endedCallSummary?: SlashCommandArtifactEndedCall;
  /** Set once the author closed the artifact, baked into the message. */
  closedSummary?: SlashCommandArtifactClosed;
  messageId?: string;
  conversationId?: string;
  channelId?: string;
  senderId?: string;
  createdAt?: number;
  surface?: 'channel' | 'thread';
}

export const SlashCommandArtifactCard: React.FC<SlashCommandArtifactCardProps> = ({
  children,
  definition,
  endedCallSummary,
  closedSummary,
  messageId,
  conversationId,
  channelId,
  senderId,
  createdAt,
  surface,
}) => {
  const sender = useUser(senderId ?? '');
  const { user } = useAuthContext();
  const zero = useZero();
  const { confirm, ConfirmDialog } = useConfirmDialog();
  // Live state comes from the shared artifact subscription — no per-card query.
  // It is ACTIVE-only, so a row here means this incident is still open.
  const activeArtifact = useActiveSlashCommandArtifact(messageId);
  // Live call details reuse the app-wide active-call subscription that already
  // backs every "X started a call" message.
  const linkedCall = useActiveCall(activeArtifact?.callExternalId ?? '');
  const { initiateCall, isInCall } = useCallJoinOrInitiate();
  const channelParticipation = useChannelParticipation(channelId ?? '');
  const [isCopying, setIsCopying] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const lastStateDiagnosticSignature = useRef<string | null>(null);

  const activeCallExternalId = linkedCall ? activeArtifact?.callExternalId : undefined;
  const hasActiveCall = !!activeCallExternalId;
  // Both terminal states are read from the message rather than the artifact row:
  // once an incident finishes it leaves the ACTIVE-only subscription, so a live
  // row is what makes the client-authored summaries untrustworthy, not the
  // absence of one.
  const endedCall = activeArtifact ? undefined : endedCallSummary;
  const closed = activeArtifact ? undefined : closedSummary;
  const activeDuration = useCallDuration(linkedCall?.startedAt, hasActiveCall);
  const senderName = getUserDisplayName(sender) || 'Someone';
  const activeResponderCount = hasActiveCall
    ? (linkedCall?.participants?.filter(
        participant => participant.response === InvitationResponse.ACCEPTED,
      ).length ?? 0)
    : 0;
  // Only channel members may act on an incident. A non-member can read the card
  // in a public channel but must not start a call from it — that would relink
  // the artifact to a fresh call and orphan any call already running.
  const canActOnArtifact = !!channelParticipation;
  // Closing is the author's call alone; the mutator and its ACL enforce the same
  // rule server-side, this only decides whether the control is offered.
  const isArtifactOwner = !!senderId && !!user?.id && senderId === user.id;
  const joinedCount = endedCall?.joinedCount ?? 0;
  const endedDuration = endedCall ? formatElapsedTime(endedCall.durationMs) : '';

  const startNewCall = (): void => {
    if (!canActOnArtifact || !channelId || !user?.id || isInCall) {
      logger.warn(Event.SLASH_COMMAND_ARTIFACT_INVARIANT_FAILED, {
        artifactKey: getSlashCommandArtifactDiagnosticKey(messageId),
        reason: 'start_call_context_unavailable',
        canActOnArtifact,
        hasChannelContext: !!channelId,
        hasUserContext: !!user?.id,
        userAlreadyInCall: isInCall,
      });
      return;
    }
    logger.info(Event.SLASH_COMMAND_ARTIFACT_ACTION, {
      action: endedCall ? 'start_new_call' : 'start_call',
      artifactKey: getSlashCommandArtifactDiagnosticKey(messageId),
      channelKey: getSlashCommandArtifactDiagnosticKey(channelId),
    });
    // Deliberately channel-scoped: no conversationId, no targetUserIds. An
    // incident belongs to the whole channel, so every member is invited and sees
    // "Join" on the channel's live-call message rather than "Request to join",
    // and the call's system message lands in the channel instead of the thread
    // the artifact happens to live in.
    initiateCall({
      channelId,
      ...(messageId && { artifactMessageId: messageId }),
    });
  };

  const handleCopyCallLink = async (): Promise<void> => {
    if (!activeCallExternalId || isCopying) return;
    setIsCopying(true);
    try {
      const inviteUrl = linkedCall?.roomLink;
      if (!inviteUrl) throw new Error('Call invite link is unavailable');
      await navigator.clipboard.writeText(inviteUrl);
      logger.info(Event.SLASH_COMMAND_ARTIFACT_ACTION, {
        action: 'copy_call_link',
        artifactKey: getSlashCommandArtifactDiagnosticKey(messageId),
        callKey: getSlashCommandArtifactDiagnosticKey(activeCallExternalId),
      });
      toast.success('Call link copied');
    } catch {
      logger.warn(Event.SLASH_COMMAND_ARTIFACT_INVARIANT_FAILED, {
        reason: 'copy_call_link_failed',
        artifactKey: getSlashCommandArtifactDiagnosticKey(messageId),
        callKey: getSlashCommandArtifactDiagnosticKey(activeCallExternalId),
      });
      toast.error('Could not copy call link');
    } finally {
      setIsCopying(false);
    }
  };

  const handleCloseArtifact = async (): Promise<void> => {
    if (!messageId || !isArtifactOwner || isClosing) return;
    const confirmed = await confirm({
      title: `Close this ${definition.bodyNoun}?`,
      description:
        `The ${definition.badge} alert stops showing for everyone in the channel and no ` +
        'call can be started from it. This cannot be undone.',
      confirmLabel: `Close ${definition.bodyNoun}`,
      variant: 'destructive',
    });
    if (!confirmed) return;

    setIsClosing(true);
    try {
      const result = zero.mutate(
        mutators.messages.closeSlashCommandArtifact({ messageId, timestamp: Date.now() }),
      );
      await result.server;
      logger.info(Event.SLASH_COMMAND_ARTIFACT_ACTION, {
        action: 'close_artifact',
        artifactKey: getSlashCommandArtifactDiagnosticKey(messageId),
        channelKey: getSlashCommandArtifactDiagnosticKey(channelId),
      });
    } catch (error) {
      logger.warn(Event.SLASH_COMMAND_ARTIFACT_INVARIANT_FAILED, {
        reason: 'close_artifact_failed',
        artifactKey: getSlashCommandArtifactDiagnosticKey(messageId),
        error: error instanceof Error ? error.message : String(error),
      });
      toast.error(`Could not close this ${definition.bodyNoun}`);
    } finally {
      setIsClosing(false);
    }
  };

  const resolvedState = hasActiveCall
    ? 'active'
    : closed
      ? 'closed'
      : endedCall
        ? 'completed'
        : 'pending';
  // The author can stand an incident down only while nothing is running: during
  // a call the call itself is the thing to end, and once it has ended or been
  // closed the artifact is already finished.
  const canCloseArtifact = isArtifactOwner && resolvedState === 'pending';
  const artifactKey = getSlashCommandArtifactDiagnosticKey(messageId);
  const trackingMetadata = JSON.stringify({
    slashCommandArtifactCommand: definition.command,
    artifactKey,
    conversationKey: getSlashCommandArtifactDiagnosticKey(conversationId),
    channelKey: getSlashCommandArtifactDiagnosticKey(channelId),
  });

  useEffect(() => {
    const diagnosticSignature = JSON.stringify({
      resolvedState,
      surface: surface ?? 'unknown',
      artifactActive: !!activeArtifact,
      liveCallResolved: !!linkedCall,
    });
    if (lastStateDiagnosticSignature.current === diagnosticSignature) return;
    lastStateDiagnosticSignature.current = diagnosticSignature;

    logger.info(Event.SLASH_COMMAND_ARTIFACT_STATE_RESOLVED, {
      artifactKey,
      conversationKey: getSlashCommandArtifactDiagnosticKey(conversationId),
      channelKey: getSlashCommandArtifactDiagnosticKey(channelId),
      surface: surface ?? 'unknown',
      resolvedState,
      artifactLifecycleAvailable: !!activeArtifact,
      liveCallResolved: !!linkedCall,
    });
  }, [artifactKey, channelId, conversationId, linkedCall, activeArtifact, resolvedState, surface]);

  return (
    <section
      className='my-1 flex w-[560px] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm'
      data-slash-command-artifact-message-id={messageId}
    >
      <div className='flex items-center gap-2 px-4 pt-4 text-xs'>
        <span className='rounded border border-orange-200 bg-orange-50 px-2 py-0.5 font-bold text-orange-600 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-400'>
          {definition.badge}
        </span>
        <span className='min-w-0 truncate text-muted-foreground'>
          <span>{senderName}</span> declared an incident
          {createdAt ? ` · ${formatTimeAmPm(createdAt)}` : ''}
        </span>
        {(hasActiveCall || endedCall) && (
          <span className='ml-auto inline-flex shrink-0 items-center gap-1.5 text-muted-foreground'>
            <Users className='size-3.5' />
            {hasActiveCall
              ? `${activeResponderCount} responder${activeResponderCount === 1 ? '' : 's'}`
              : `${joinedCount} joined the call`}
          </span>
        )}
        {canCloseArtifact && (
          <button
            type='button'
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              void handleCloseArtifact();
            }}
            disabled={isClosing}
            className='-mr-1 ml-auto flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60'
            aria-label={`Close this ${definition.bodyNoun}`}
            title={`Close this ${definition.bodyNoun}`}
            data-prevent-thread
            data-track-category='SLASH_COMMAND_ARTIFACT'
            data-track-name='CLOSE_ARTIFACT'
            data-track-metadata={trackingMetadata}
          >
            <X className='size-4' />
          </button>
        )}
      </div>

      <div className='px-4 py-3 text-sm leading-6 text-foreground'>{children}</div>

      <div className='flex flex-wrap items-center gap-2 px-4 pb-4'>
        {resolvedState === 'closed' ? (
          <div className='inline-flex h-10 items-center gap-2 rounded-lg bg-muted px-3 text-sm font-medium text-muted-foreground'>
            <X className='size-4' />
            <span>Closed by {senderName}</span>
          </div>
        ) : resolvedState === 'completed' ? (
          <>
            <div className='inline-flex h-10 items-center gap-2 rounded-lg bg-muted px-3 text-sm font-medium text-muted-foreground'>
              <Phone className='size-4' />
              <span>
                Call ended{endedDuration ? ` · lasted ${endedDuration}` : ''} · {joinedCount} joined
              </span>
            </div>
            <button
              type='button'
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                startNewCall();
              }}
              disabled={isInCall || !canActOnArtifact}
              className='inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-semibold hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60'
              data-prevent-thread
              data-track-category='SLASH_COMMAND_ARTIFACT'
              data-track-name='START_NEW_CALL'
              data-track-metadata={trackingMetadata}
            >
              <Phone className='size-4' />
              Start a new call
            </button>
          </>
        ) : resolvedState === 'active' ? (
          <>
            {/* Informational only. Joining happens on the channel's live-call
                message, which the channel-scoped call above puts in front of
                every member. */}
            <div
              className='inline-flex h-10 items-center gap-2 rounded-lg bg-muted px-3 text-sm font-medium text-muted-foreground'
              aria-live='polite'
            >
              <span className='size-2.5 animate-pulse rounded-full bg-orange-500 motion-reduce:animate-none' />
              <Phone className='size-4' />
              <span>Call live{activeDuration ? ` · ${activeDuration}` : ''}</span>
            </div>
            <button
              type='button'
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                void handleCopyCallLink();
              }}
              disabled={!linkedCall?.roomLink || isCopying}
              className='inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-semibold hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60'
              data-prevent-thread
              data-track-category='SLASH_COMMAND_ARTIFACT'
              data-track-name='COPY_CALL_LINK'
              data-track-metadata={trackingMetadata}
            >
              <Copy className='size-4' />
              Copy link
            </button>
          </>
        ) : (
          <button
            type='button'
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              startNewCall();
            }}
            disabled={!canActOnArtifact || isInCall}
            className='inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60'
            data-prevent-thread
            data-track-category='SLASH_COMMAND_ARTIFACT'
            data-track-name='START_CALL'
            data-track-metadata={trackingMetadata}
          >
            <Phone className='size-4' />
            Start call
          </button>
        )}
      </div>

      <ConfirmDialog />
    </section>
  );
};

/** One Flow node renderer handles every registered slash-command artifact. */
export const SlashCommandArtifactNode: React.FC<{
  node: FlowComponent;
  children?: React.ReactNode;
}> = ({ node, children }) => {
  const parsedProps = slashCommandArtifactPropsSchema.safeParse(node.props);
  const { messageId, conversationId, messageContext } = useFlow();
  const props = parsedProps.success ? parsedProps.data : null;
  const definition = props ? getSlashCommandArtifactDefinition(props.command) : null;
  if (!props || !definition) return null;

  return (
    <SlashCommandArtifactCard
      definition={definition}
      {...(props.endedCall && { endedCallSummary: props.endedCall })}
      {...(props.closed && { closedSummary: props.closed })}
      messageId={messageId}
      conversationId={conversationId}
      {...(messageContext?.channelId && { channelId: messageContext.channelId })}
      {...(messageContext?.senderId && { senderId: messageContext.senderId })}
      {...(messageContext?.createdAt !== undefined && { createdAt: messageContext.createdAt })}
      {...(messageContext?.surface && { surface: messageContext.surface })}
    >
      {children}
    </SlashCommandArtifactCard>
  );
};
