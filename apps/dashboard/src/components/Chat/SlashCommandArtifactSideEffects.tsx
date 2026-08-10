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
  type SlashCommandArtifactBannerSideEffect,
} from '@xyne/shared';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { Event, logger } from '../../utils/logger';
import { queries } from '../../zero/queries';

type ActiveSlashCommandArtifact = QueryResultType<
  typeof queries.activeSlashCommandArtifacts
>[number];
type SlashCommandArtifactCall = NonNullable<ActiveSlashCommandArtifact['call']>;

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
  /** Durable linked id fallback when the related call is delayed or ACL-filtered. */
  activeCallExternalId?: string;
  activeCallStartedAt?: number;
}

export interface SlashCommandArtifactSideEffectContextValue {
  bannerItems: SlashCommandArtifactBannerItem[];
  channelIdsWithActiveSideEffects: ReadonlySet<string>;
}

const SlashCommandArtifactSideEffectContext =
  createContext<SlashCommandArtifactSideEffectContextValue>({
    bannerItems: [],
    channelIdsWithActiveSideEffects: new Set(),
  });

/**
 * Resolve persisted Flow side effects into the global banner/dot view-model.
 * Keeping this pure makes lifecycle behavior deterministic and independently
 * testable from Zero/React subscription timing.
 */
export const deriveSlashCommandArtifactSideEffects = (
  activeArtifacts: readonly ActiveSlashCommandArtifact[],
): SlashCommandArtifactSideEffectContextValue => {
  const bannerItems: SlashCommandArtifactBannerItem[] = [];
  for (const activeArtifact of activeArtifacts) {
    const message = activeArtifact.message;
    if (!message) continue;

    const artifact = parseSlashCommandArtifactMessage(message.content);
    if (!artifact) continue;

    const bannerSideEffects = artifact.props.sideEffects.filter(
      (sideEffect): sideEffect is SlashCommandArtifactBannerSideEffect =>
        sideEffect.type === 'banner',
    );
    const conversation = message.conversation;
    const channel = conversation?.channel;
    if (!conversation || !channel) continue;

    const linkedCall = activeArtifact.call;
    if (linkedCall && linkedCall.status !== CallStatus.ACTIVE) continue;

    for (const sideEffect of bannerSideEffects) {
      const canonicalSideEffect: SlashCommandArtifactBannerSideEffect = {
        ...sideEffect,
        status: 'active',
        callExternalId: activeArtifact.callExternalId ?? undefined,
      };
      const activeCall = linkedCall?.status === CallStatus.ACTIVE ? linkedCall : undefined;
      const activeCallExternalId =
        activeCall?.externalId ?? activeArtifact.callExternalId ?? undefined;
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
        banner: canonicalSideEffect,
        ...(activeCall ? { activeCall } : {}),
        ...(activeCallExternalId && { activeCallExternalId }),
        ...(activeCall ? { activeCallStartedAt: activeCall.startedAt } : {}),
      });
    }
  }

  return {
    bannerItems,
    channelIdsWithActiveSideEffects: new Set(bannerItems.map(item => item.channelId)),
  };
};

export const SlashCommandArtifactSideEffectProvider = ({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element => {
  const [activeArtifacts = [], activeArtifactQuery] = useCachedQuery(
    queries.activeSlashCommandArtifacts(),
  );
  const lastDiagnosticSignature = useRef<string | null>(null);

  const value = useMemo(
    () => deriveSlashCommandArtifactSideEffects(activeArtifacts),
    [activeArtifacts],
  );

  const diagnostics = useMemo(() => {
    let parsedArtifactRows = 0;
    let invalidArtifactRows = 0;
    let missingMessageRelations = 0;
    let activeBannerSideEffects = 0;
    let completedBannerSideEffects = 0;
    let bannerSideEffectsWithCallLink = 0;
    let missingConversationRelations = 0;
    let missingChannelRelations = 0;
    let linkedCallRows = 0;
    let missingLinkedCallRelations = 0;

    for (const activeArtifact of activeArtifacts) {
      const message = activeArtifact.message;
      if (!message) {
        missingMessageRelations += 1;
        continue;
      }
      const artifact = parseSlashCommandArtifactMessage(message.content);
      if (!artifact) {
        invalidArtifactRows += 1;
        continue;
      }
      parsedArtifactRows += 1;
      if (!message.conversation) missingConversationRelations += 1;
      else if (!message.conversation.channel) missingChannelRelations += 1;
      if (activeArtifact.call) linkedCallRows += 1;
      else if (activeArtifact.callExternalId) missingLinkedCallRelations += 1;
      for (const sideEffect of artifact.props.sideEffects) {
        if (sideEffect.type !== 'banner') continue;
        if (sideEffect.status === 'completed') completedBannerSideEffects += 1;
        else activeBannerSideEffects += 1;
        if (sideEffect.callExternalId) bannerSideEffectsWithCallLink += 1;
      }
    }

    return {
      artifactQueryState: activeArtifactQuery.type,
      artifactRows: activeArtifacts.length,
      parsedArtifactRows,
      invalidArtifactRows,
      missingMessageRelations,
      activeBannerSideEffects,
      completedBannerSideEffects,
      bannerSideEffectsWithCallLink,
      missingConversationRelations,
      missingChannelRelations,
      linkedCallRows,
      missingLinkedCallRelations,
      resolvedBannerItems: value.bannerItems.length,
      resolvedChannelIndicators: value.channelIdsWithActiveSideEffects.size,
    };
  }, [activeArtifacts, activeArtifactQuery.type, value]);

  useEffect(() => {
    const signature = JSON.stringify(diagnostics);
    if (lastDiagnosticSignature.current === signature) return;
    lastDiagnosticSignature.current = signature;

    logger.info(Event.SLASH_COMMAND_ARTIFACT_SIDE_EFFECTS_RECONCILED, diagnostics);
    if (
      diagnostics.invalidArtifactRows > 0 ||
      diagnostics.missingMessageRelations > 0 ||
      diagnostics.missingConversationRelations > 0 ||
      diagnostics.missingChannelRelations > 0
    ) {
      logger.warn(Event.SLASH_COMMAND_ARTIFACT_INVARIANT_FAILED, {
        reason: 'artifact_subscription_rows_incomplete',
        invalidArtifactRows: diagnostics.invalidArtifactRows,
        missingMessageRelations: diagnostics.missingMessageRelations,
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
