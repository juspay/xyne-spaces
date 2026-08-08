import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import type { QueryResultType } from '@rocicorp/zero';
import {
  CallStatus,
  parseSlashCommandArtifactMessage,
  resolveSlashCommandArtifactCallLifecycle,
  type SlashCommandArtifactBannerSideEffect,
} from '@xyne/shared';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { Event, logger } from '../../utils/logger';
import { queries } from '../../zero/queries';

type SlashCommandArtifactCall = QueryResultType<typeof queries.slashCommandArtifactCalls>[number];
type SlashCommandArtifactMessage = QueryResultType<
  typeof queries.userSlashCommandArtifactMessages
>[number];

export interface SlashCommandArtifactBannerItem {
  id: string;
  type: string;
  messageId: string;
  conversationId: string;
  channelId: string;
  channelName: string;
  messagePreview: string;
  declaredBy: string;
  createdAt: number;
  conversationCreatedAt: number;
  isInitialMessage: boolean;
  banner: SlashCommandArtifactBannerSideEffect;
  activeCall?: SlashCommandArtifactCall;
  /** Durable FlowJSON fallback when the calls subscription is delayed or ACL-filtered. */
  activeCallExternalId?: string;
  activeCallStartedAt?: number;
}

export interface SlashCommandArtifactSideEffectContextValue {
  bannerItems: SlashCommandArtifactBannerItem[];
  channelIdsWithActiveSideEffects: ReadonlySet<string>;
  /** Canonical message-row lifecycle used to override stale conversation snapshots. */
  bannerSideEffectsByMessageId: ReadonlyMap<string, SlashCommandArtifactBannerSideEffect>;
}

const SlashCommandArtifactSideEffectContext =
  createContext<SlashCommandArtifactSideEffectContextValue>({
    bannerItems: [],
    channelIdsWithActiveSideEffects: new Set(),
    bannerSideEffectsByMessageId: new Map(),
  });

/**
 * Resolve persisted Flow side effects into the global banner/dot view-model.
 * Keeping this pure makes lifecycle behavior deterministic and independently
 * testable from Zero/React subscription timing.
 */
export const deriveSlashCommandArtifactSideEffects = (
  artifactMessages: readonly SlashCommandArtifactMessage[],
  artifactCalls: readonly SlashCommandArtifactCall[],
): SlashCommandArtifactSideEffectContextValue => {
  const bannerItems: SlashCommandArtifactBannerItem[] = [];
  const bannerSideEffectsByMessageId = new Map<string, SlashCommandArtifactBannerSideEffect>();
  for (const message of artifactMessages) {
    const artifact = parseSlashCommandArtifactMessage(message.content);
    if (!artifact) continue;

    const bannerSideEffects = artifact.props.sideEffects.filter(
      (sideEffect): sideEffect is SlashCommandArtifactBannerSideEffect =>
        sideEffect.type === 'banner',
    );
    const canonicalBanner = bannerSideEffects[0];
    if (canonicalBanner) {
      bannerSideEffectsByMessageId.set(message.messageId, canonicalBanner);
    }

    const conversation = message.conversation;
    const channel = conversation?.channel;
    if (!conversation || !channel) continue;

    const lifecycle = resolveSlashCommandArtifactCallLifecycle(artifactCalls, {
      messageId: message.messageId,
    });

    for (const sideEffect of bannerSideEffects) {
      const persistedCall = sideEffect.callExternalId
        ? artifactCalls.find(call => call.externalId === sideEffect.callExternalId)
        : undefined;
      // FlowJSON is the durable lifecycle. When it carries a specific call id,
      // never let an older call for the same artifact override a restarted one.
      if (sideEffect.status === 'completed') continue;
      if (persistedCall && persistedCall.status !== CallStatus.ACTIVE) continue;
      if (!sideEffect.callExternalId && lifecycle.status === 'completed') continue;
      const activeCall =
        persistedCall?.status === CallStatus.ACTIVE
          ? persistedCall
          : lifecycle.status === 'active'
            ? lifecycle.call
            : undefined;
      const activeCallExternalId =
        activeCall?.externalId ??
        (sideEffect.status === 'active' ? sideEffect.callExternalId : undefined);
      bannerItems.push({
        id: `${message.messageId}:banner`,
        type: artifact.props.command,
        messageId: message.messageId,
        conversationId: message.conversationId,
        channelId: channel.id,
        channelName: channel.name,
        messagePreview: artifact.body.replace(/\s+/g, ' ').trim(),
        declaredBy: getUserDisplayName(message.sender) || 'Someone',
        createdAt: message.createdAt,
        conversationCreatedAt: conversation.createdAt,
        isInitialMessage: conversation.initialMessageId === message.messageId,
        banner: sideEffect,
        ...(activeCall ? { activeCall } : {}),
        ...(activeCallExternalId && { activeCallExternalId }),
        ...(activeCall ? { activeCallStartedAt: activeCall.startedAt } : {}),
      });
    }
  }

  return {
    bannerItems,
    channelIdsWithActiveSideEffects: new Set(bannerItems.map(item => item.channelId)),
    bannerSideEffectsByMessageId,
  };
};

export const SlashCommandArtifactSideEffectProvider = ({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element => {
  const [artifactMessages = [], artifactMessageQuery] = useCachedQuery(
    queries.userSlashCommandArtifactMessages(),
  );
  const [artifactCalls = [], artifactCallQuery] = useCachedQuery(
    queries.slashCommandArtifactCalls(),
  );
  const lastDiagnosticSignature = useRef<string | null>(null);

  const value = useMemo(
    () => deriveSlashCommandArtifactSideEffects(artifactMessages, artifactCalls),
    [artifactCalls, artifactMessages],
  );

  const diagnostics = useMemo(() => {
    let parsedArtifactRows = 0;
    let invalidArtifactRows = 0;
    let activeBannerSideEffects = 0;
    let completedBannerSideEffects = 0;
    let bannerSideEffectsWithCallLink = 0;
    let missingConversationRelations = 0;
    let missingChannelRelations = 0;

    for (const message of artifactMessages) {
      const artifact = parseSlashCommandArtifactMessage(message.content);
      if (!artifact) {
        invalidArtifactRows += 1;
        continue;
      }
      parsedArtifactRows += 1;
      if (!message.conversation) missingConversationRelations += 1;
      else if (!message.conversation.channel) missingChannelRelations += 1;
      for (const sideEffect of artifact.props.sideEffects) {
        if (sideEffect.type !== 'banner') continue;
        if (sideEffect.status === 'completed') completedBannerSideEffects += 1;
        else activeBannerSideEffects += 1;
        if (sideEffect.callExternalId) bannerSideEffectsWithCallLink += 1;
      }
    }

    return {
      messageQueryState: artifactMessageQuery.type,
      callQueryState: artifactCallQuery.type,
      artifactRows: artifactMessages.length,
      parsedArtifactRows,
      invalidArtifactRows,
      activeBannerSideEffects,
      completedBannerSideEffects,
      bannerSideEffectsWithCallLink,
      missingConversationRelations,
      missingChannelRelations,
      callRows: artifactCalls.length,
      activeCallRows: artifactCalls.filter(call => call.status === CallStatus.ACTIVE).length,
      resolvedBannerItems: value.bannerItems.length,
      resolvedChannelIndicators: value.channelIdsWithActiveSideEffects.size,
    };
  }, [artifactCallQuery.type, artifactCalls, artifactMessageQuery.type, artifactMessages, value]);

  useEffect(() => {
    const signature = JSON.stringify(diagnostics);
    if (lastDiagnosticSignature.current === signature) return;
    lastDiagnosticSignature.current = signature;

    logger.info(Event.SLASH_COMMAND_ARTIFACT_SIDE_EFFECTS_RECONCILED, diagnostics);
    if (
      diagnostics.invalidArtifactRows > 0 ||
      diagnostics.missingConversationRelations > 0 ||
      diagnostics.missingChannelRelations > 0
    ) {
      logger.warn(Event.SLASH_COMMAND_ARTIFACT_INVARIANT_FAILED, {
        reason: 'artifact_subscription_rows_incomplete',
        invalidArtifactRows: diagnostics.invalidArtifactRows,
        missingConversationRelations: diagnostics.missingConversationRelations,
        missingChannelRelations: diagnostics.missingChannelRelations,
      });
    }
  }, [diagnostics]);

  return (
    <SlashCommandArtifactSideEffectContext.Provider value={value}>
      {children}
    </SlashCommandArtifactSideEffectContext.Provider>
  );
};

export const useSlashCommandArtifactSideEffects = (): SlashCommandArtifactSideEffectContextValue =>
  useContext(SlashCommandArtifactSideEffectContext);

export const useChannelHasSlashCommandArtifactSideEffect = (channelId: string): boolean => {
  const { channelIdsWithActiveSideEffects } = useSlashCommandArtifactSideEffects();
  return channelIdsWithActiveSideEffects.has(channelId);
};

export const useCanonicalSlashCommandArtifactBannerSideEffect = (
  messageId: string | undefined,
): SlashCommandArtifactBannerSideEffect | undefined => {
  const { bannerSideEffectsByMessageId } = useSlashCommandArtifactSideEffects();
  return messageId ? bannerSideEffectsByMessageId.get(messageId) : undefined;
};
