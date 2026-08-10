import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Copy, Phone, Users } from 'lucide-react';
import { useSelector } from '@xstate/react';
import { toast } from 'sonner';
import {
  CallStatus,
  InvitationResponse,
  MessageArtifactStatus,
  buildSlashCommandArtifactFlowMessage,
  getSlashCommandArtifactDiagnosticKey,
  parseSlashCommandArtifactMessage,
  slashCommandArtifactPropsSchema,
  type FlowComponent,
  type SlashCommandArtifactBannerSideEffect,
  type SlashCommandArtifactProps,
  type SlashCommandArtifactSideEffect,
} from '@xyne/shared';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useCallDuration } from '../../hooks/useCalls';
import { useCallJoinOrInitiate } from '../../hooks/useCallJoinOrInitiate';
import { useUser } from '../../hooks/useUsers';
import { useAuthContext } from '../../providers/AuthProvider';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { formatTimeAmPm } from '../../utils/dateUtils';
import { formatElapsedTime } from '../../utils/recordingUtils';
import { Event, logger } from '../../utils/logger';
import { callLobbyService } from '../../services/Call/callLobbyService';
import { roomActor } from '../../machines/roomMachine';
import { queries } from '../../zero/queries';
import { useFlow } from '../flowUI/FlowContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

export type SlashCommandArtifactType = 'sev2';

export interface SlashCommandArtifactDefinition {
  type: SlashCommandArtifactType;
  command: {
    id: string;
    name: string;
    description: string;
    category: string;
    badge: string;
    kind: 'slash-command-artifact';
    slashCommandArtifactType: SlashCommandArtifactType;
  };
  activity: {
    actionLabel: string;
  };
  sideEffects: SlashCommandArtifactSideEffect[];
}

export const SEV2_COMMAND_NAME = 'sev2';

export const SLASH_COMMAND_ARTIFACT_DEFINITIONS: Record<
  SlashCommandArtifactType,
  SlashCommandArtifactDefinition
> = {
  sev2: {
    type: 'sev2',
    command: {
      id: 'builtin-sev2',
      name: SEV2_COMMAND_NAME,
      description: 'Declare a SEV2 incident in this conversation',
      category: 'Incident',
      badge: 'Incident',
      kind: 'slash-command-artifact',
      slashCommandArtifactType: 'sev2',
    },
    activity: {
      actionLabel: 'declared a SEV2 in',
    },
    sideEffects: [
      {
        type: 'banner',
        badge: 'SEV2',
        title: 'Active incident',
        viewActionLabel: 'View incident',
        tone: 'orange',
        status: 'active',
        activity: {
          audience: 'channel',
        },
      },
    ],
  },
};

export const SEV2_COMMAND = SLASH_COMMAND_ARTIFACT_DEFINITIONS.sev2.command;

const isSlashCommandArtifactType = (value: string): value is SlashCommandArtifactType =>
  Object.prototype.hasOwnProperty.call(SLASH_COMMAND_ARTIFACT_DEFINITIONS, value);

export interface ParsedSupportedSlashCommandArtifact {
  type: SlashCommandArtifactType;
  props: SlashCommandArtifactProps;
  definition: SlashCommandArtifactDefinition;
  body: string;
}

export const getSlashCommandArtifact = (
  content: string | null | undefined,
): ParsedSupportedSlashCommandArtifact | null => {
  const parsed = parseSlashCommandArtifactMessage(content);
  if (!parsed || !isSlashCommandArtifactType(parsed.props.command)) return null;
  return {
    type: parsed.props.command,
    props: parsed.props,
    definition: SLASH_COMMAND_ARTIFACT_DEFINITIONS[parsed.props.command],
    body: parsed.body,
  };
};

export const getSlashCommandArtifactType = (
  content: string | null | undefined,
): SlashCommandArtifactType | null => getSlashCommandArtifact(content)?.type ?? null;

export const isSev2SlashCommandArtifactMessage = (content: string | null | undefined): boolean =>
  getSlashCommandArtifactType(content) === 'sev2';

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

export const buildSev2SlashCommandArtifactFlowMessage = (
  bodyHtml: string,
  screenId: string,
): string =>
  buildSlashCommandArtifactFlowMessage({
    command: 'sev2',
    body: messageHtmlToFlowText(bodyHtml),
    sideEffects: SLASH_COMMAND_ARTIFACT_DEFINITIONS.sev2.sideEffects,
    screenId,
  });

export const stripSev2SlashCommandFromHtml = (html: string): string => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();

  while (node) {
    const value = node.textContent ?? '';
    if (value.trim()) {
      node.textContent = value.replace(/^\s*\/sev2(?:\s+|$)/i, '');
      break;
    }
    node = walker.nextNode();
  }

  return doc.body.innerHTML;
};

export const getSev2SlashCommandArtifactPreviewText = (content: string): string | null => {
  const artifact = getSlashCommandArtifact(content);
  if (artifact?.type !== 'sev2') return null;
  const body = artifact.body.replace(/\s+/g, ' ').trim();
  return body ? `SEV2 · ${body}` : 'SEV2 incident';
};

interface Sev2SlashCommandArtifactProps {
  children: React.ReactNode;
  messageId?: string;
  conversationId?: string;
  channelId?: string;
  senderId?: string;
  createdAt?: number;
  surface?: 'channel' | 'thread';
  bannerSideEffect?: SlashCommandArtifactBannerSideEffect;
}

export const Sev2SlashCommandArtifact: React.FC<Sev2SlashCommandArtifactProps> = ({
  children,
  messageId,
  conversationId,
  channelId,
  senderId,
  createdAt,
  surface,
  bannerSideEffect,
}) => {
  const sender = useUser(senderId ?? '');
  const { user } = useAuthContext();
  const [messageArtifact] = useCachedQuery(
    queries.slashCommandArtifactByMessageId({ messageId: messageId ?? '' }),
  );
  const canonicalBannerSideEffect = useMemo(
    () =>
      messageArtifact && bannerSideEffect
        ? {
            ...bannerSideEffect,
            status:
              messageArtifact.status === MessageArtifactStatus.ACTIVE
                ? ('active' as const)
                : ('completed' as const),
            callExternalId: messageArtifact.callExternalId ?? undefined,
          }
        : undefined,
    [bannerSideEffect, messageArtifact],
  );
  const effectiveBannerSideEffect = canonicalBannerSideEffect ?? bannerSideEffect;
  const currentCallId = useSelector(roomActor, state => state.context.externalId);
  const { initiateCall, joinCall, isInCall } = useCallJoinOrInitiate();
  const [isCopying, setIsCopying] = useState(false);
  const lastStateDiagnosticSignature = useRef<string | null>(null);

  const latestCall = messageArtifact?.call;
  const lifecycleCompleted = effectiveBannerSideEffect?.status === 'completed';
  const activeCall =
    !lifecycleCompleted && latestCall?.status === CallStatus.ACTIVE ? latestCall : undefined;
  const endedCall = latestCall && latestCall.status !== CallStatus.ACTIVE ? latestCall : undefined;
  const activeCallExternalIdFallback =
    !latestCall &&
    effectiveBannerSideEffect?.status === 'active' &&
    effectiveBannerSideEffect.callExternalId
      ? effectiveBannerSideEffect.callExternalId
      : undefined;
  const activeCallExternalId = activeCall?.externalId ?? activeCallExternalIdFallback;
  const hasActiveCall = !!activeCallExternalId;
  const showEndedState =
    !hasActiveCall &&
    (lifecycleCompleted || (!!latestCall && latestCall.status !== CallStatus.ACTIVE));
  const isInSev2Call = hasActiveCall && currentCallId === activeCallExternalId;
  const activeDuration = useCallDuration(activeCall?.startedAt, !!activeCall);
  const senderName = getUserDisplayName(sender) || 'Someone';
  const activeResponderCount =
    activeCall?.participants?.filter(
      participant => participant.response === InvitationResponse.ACCEPTED,
    ).length ?? 0;
  const joinedCount = endedCall
    ? (endedCall.participantCount ??
      endedCall.participants?.filter(
        participant => participant.joinedAt !== null && participant.joinedAt !== undefined,
      ).length ??
      0)
    : 0;
  const endedDuration = endedCall?.endedAt
    ? formatElapsedTime(Math.max(0, endedCall.endedAt - endedCall.startedAt))
    : '';

  const startNewCall = (): void => {
    if (!channelId || !user?.id || isInCall) {
      logger.warn(Event.SLASH_COMMAND_ARTIFACT_INVARIANT_FAILED, {
        artifactKey: getSlashCommandArtifactDiagnosticKey(messageId),
        reason: 'start_call_context_unavailable',
        hasChannelContext: !!channelId,
        hasUserContext: !!user?.id,
        userAlreadyInCall: isInCall,
      });
      return;
    }
    logger.info(Event.SLASH_COMMAND_ARTIFACT_ACTION, {
      action: showEndedState ? 'start_new_call' : 'start_call',
      artifactKey: getSlashCommandArtifactDiagnosticKey(messageId),
      channelKey: getSlashCommandArtifactDiagnosticKey(channelId),
    });
    initiateCall({
      channelId,
      // Targeting only the initiator starts a normal call without ringing the channel.
      targetUserIds: [user.id],
      ...(conversationId && { conversationId }),
      ...(messageId && { artifactMessageId: messageId }),
    });
  };

  const handlePrimaryCallAction = (): void => {
    if (activeCallExternalId) {
      if (!isInSev2Call) {
        logger.info(Event.SLASH_COMMAND_ARTIFACT_ACTION, {
          action: 'join_call_from_card',
          artifactKey: getSlashCommandArtifactDiagnosticKey(messageId),
          callKey: getSlashCommandArtifactDiagnosticKey(activeCallExternalId),
        });
        joinCall({ callId: activeCallExternalId });
      }
      return;
    }
    startNewCall();
  };

  const handleCopyCallLink = async (): Promise<void> => {
    if (!activeCallExternalId || isCopying) return;
    setIsCopying(true);
    try {
      const inviteUrl = await callLobbyService.getInviteUrl(activeCallExternalId);
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

  const resolvedState = hasActiveCall ? 'active' : showEndedState ? 'completed' : 'pending';
  const artifactKey = getSlashCommandArtifactDiagnosticKey(messageId);
  const trackingMetadata = JSON.stringify({
    slashCommandArtifactType: 'sev2',
    artifactKey,
    conversationKey: getSlashCommandArtifactDiagnosticKey(conversationId),
    channelKey: getSlashCommandArtifactDiagnosticKey(channelId),
  });

  useEffect(() => {
    const diagnosticSignature = JSON.stringify({
      resolvedState,
      surface: surface ?? 'unknown',
      canonicalStatus: canonicalBannerSideEffect?.status ?? 'missing',
      snapshotStatus: bannerSideEffect?.status ?? 'missing',
      canonicalCallKey: getSlashCommandArtifactDiagnosticKey(
        canonicalBannerSideEffect?.callExternalId,
      ),
      snapshotCallKey: getSlashCommandArtifactDiagnosticKey(bannerSideEffect?.callExternalId),
      callRecordStatus: latestCall?.status ?? 'missing',
      activeCallResolvedFromLinkedId: !!activeCallExternalIdFallback,
    });
    if (lastStateDiagnosticSignature.current === diagnosticSignature) return;
    lastStateDiagnosticSignature.current = diagnosticSignature;

    logger.info(Event.SLASH_COMMAND_ARTIFACT_STATE_RESOLVED, {
      artifactKey,
      conversationKey: getSlashCommandArtifactDiagnosticKey(conversationId),
      channelKey: getSlashCommandArtifactDiagnosticKey(channelId),
      surface: surface ?? 'unknown',
      resolvedState,
      artifactLifecycleAvailable: !!messageArtifact,
      callLinkAvailable: !!effectiveBannerSideEffect?.callExternalId,
      callRecordAvailable: !!latestCall,
      activeCallResolvedFromLinkedId: !!activeCallExternalIdFallback,
    });

    if (
      canonicalBannerSideEffect &&
      bannerSideEffect &&
      (canonicalBannerSideEffect.status !== bannerSideEffect.status ||
        canonicalBannerSideEffect.callExternalId !== bannerSideEffect.callExternalId)
    ) {
      logger.warn(Event.SLASH_COMMAND_ARTIFACT_INVARIANT_FAILED, {
        artifactKey,
        surface: surface ?? 'unknown',
        reason: 'message_and_render_snapshot_lifecycle_mismatch',
        canonicalStatus: canonicalBannerSideEffect.status,
        snapshotStatus: bannerSideEffect.status,
        callLinkMatches:
          canonicalBannerSideEffect.callExternalId === bannerSideEffect.callExternalId,
      });
    }
  }, [
    artifactKey,
    bannerSideEffect,
    canonicalBannerSideEffect,
    channelId,
    conversationId,
    effectiveBannerSideEffect?.callExternalId,
    activeCallExternalIdFallback,
    latestCall,
    messageArtifact,
    resolvedState,
    surface,
  ]);

  return (
    <section
      className='my-1 flex w-[560px] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm'
      data-slash-command-artifact-message-id={messageId}
    >
      <div className='flex items-center gap-2 px-4 pt-4 text-xs'>
        <span className='rounded border border-orange-200 bg-orange-50 px-2 py-0.5 font-bold text-orange-600 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-400'>
          SEV2
        </span>
        <span className='min-w-0 truncate text-muted-foreground'>
          <span>{senderName}</span> declared an incident
          {createdAt ? ` · ${formatTimeAmPm(createdAt)}` : ''}
        </span>
        {(hasActiveCall || showEndedState) && (
          <span className='ml-auto inline-flex shrink-0 items-center gap-1.5 text-muted-foreground'>
            <Users className='size-3.5' />
            {hasActiveCall
              ? `${activeResponderCount} responder${activeResponderCount === 1 ? '' : 's'}`
              : `${joinedCount} joined the call`}
          </span>
        )}
      </div>

      <div className='px-4 py-3 text-sm leading-6 text-foreground'>{children}</div>

      <div className='flex flex-wrap items-center gap-2 px-4 pb-4'>
        {showEndedState ? (
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
              disabled={isInCall}
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
        ) : (
          <div className='inline-flex overflow-hidden rounded-lg bg-foreground text-background'>
            <button
              type='button'
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                handlePrimaryCallAction();
              }}
              disabled={!hasActiveCall && isInCall}
              className='inline-flex h-10 items-center gap-2 px-4 text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60'
              aria-label={hasActiveCall && !isInSev2Call ? 'Join call' : undefined}
              data-prevent-thread
              data-track-category='SLASH_COMMAND_ARTIFACT'
              data-track-name={hasActiveCall ? 'JOIN_CALL' : 'START_CALL'}
              data-track-metadata={trackingMetadata}
            >
              {hasActiveCall && (
                <span className='size-2.5 animate-pulse rounded-full bg-orange-500' />
              )}
              <Phone className='size-4' />
              {hasActiveCall ? activeDuration || 'Join call' : 'Start call'}
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  onClick={event => event.stopPropagation()}
                  className='flex h-10 w-10 items-center justify-center border-l border-background/20 hover:bg-background/10'
                  aria-label='Call options'
                  data-prevent-thread
                  data-track-category='SLASH_COMMAND_ARTIFACT'
                  data-track-name='OPEN_CALL_OPTIONS'
                  data-track-metadata={trackingMetadata}
                >
                  <ChevronDown className='size-4' />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='start' side='bottom'>
                <DropdownMenuItem
                  disabled={!activeCallExternalId || isCopying}
                  onClick={event => {
                    event.stopPropagation();
                    void handleCopyCallLink();
                  }}
                  data-track-category='SLASH_COMMAND_ARTIFACT'
                  data-track-name='COPY_CALL_LINK'
                  data-track-metadata={trackingMetadata}
                >
                  <Copy className='size-4' />
                  Copy call link
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
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
  if (!parsedProps.success || !isSlashCommandArtifactType(parsedProps.data.command)) return null;

  switch (parsedProps.data.command) {
    case 'sev2': {
      const bannerSideEffect = parsedProps.data.sideEffects.find(
        (sideEffect): sideEffect is SlashCommandArtifactBannerSideEffect =>
          sideEffect.type === 'banner',
      );
      return (
        <Sev2SlashCommandArtifact
          messageId={messageId}
          conversationId={conversationId}
          {...(messageContext?.channelId && { channelId: messageContext.channelId })}
          {...(messageContext?.senderId && { senderId: messageContext.senderId })}
          {...(messageContext?.createdAt !== undefined && { createdAt: messageContext.createdAt })}
          {...(messageContext?.surface && { surface: messageContext.surface })}
          {...(bannerSideEffect && { bannerSideEffect })}
        >
          {children}
        </Sev2SlashCommandArtifact>
      );
    }
  }
};

export type { SlashCommandArtifactBannerSideEffect };
