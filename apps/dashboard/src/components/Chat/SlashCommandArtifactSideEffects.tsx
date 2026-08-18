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
  getSlashCommandArtifactDefinition,
  type SlashCommandArtifactDefinition,
} from '@xyne/shared';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { Event, logger } from '../../utils/logger';
import { queries } from '../../zero/queries';

export type ActiveSlashCommandArtifact = QueryResultType<
  typeof queries.activeSlashCommandArtifacts
>[number];

export interface SlashCommandArtifactBannerItem {
  id: string;
  definition: SlashCommandArtifactDefinition;
  messageId: string;
  conversationId: string;
  channelId: string;
  messagePreview: string;
  messageCreatedAt: number;
  isInitialMessage: boolean;
  activeCallExternalId?: string;
}

export interface SlashCommandArtifactSideEffectContextValue {
  bannerItems: SlashCommandArtifactBannerItem[];
  channelIdsWithActiveSideEffects: ReadonlySet<string>;
  /**
   * Active artifacts keyed by messageId. Cards read their live state from here
   * instead of each opening its own subscription — the same arrangement as
   * userActiveCalls backing every call system message.
   */
  activeArtifactsByMessageId: ReadonlyMap<string, ActiveSlashCommandArtifact>;
}

const SlashCommandArtifactSideEffectContext =
  createContext<SlashCommandArtifactSideEffectContextValue>({
    bannerItems: [],
    channelIdsWithActiveSideEffects: new Set(),
    activeArtifactsByMessageId: new Map(),
  });

/**
 * Resolve active artifact rows into the global banner/dot view-model. Keeping
 * this pure makes lifecycle behavior deterministic and independently testable
 * from Zero/React subscription timing.
 */
export const deriveSlashCommandArtifactSideEffects = (
  activeArtifacts: readonly ActiveSlashCommandArtifact[],
): SlashCommandArtifactSideEffectContextValue => {
  const bannerItems: SlashCommandArtifactBannerItem[] = [];
  const activeArtifactsByMessageId = new Map<string, ActiveSlashCommandArtifact>();

  for (const activeArtifact of activeArtifacts) {
    const definition = getSlashCommandArtifactDefinition(activeArtifact.command);
    if (!definition) continue;

    activeArtifactsByMessageId.set(activeArtifact.messageId, activeArtifact);

    bannerItems.push({
      id: `${activeArtifact.messageId}:banner`,
      definition,
      messageId: activeArtifact.messageId,
      conversationId: activeArtifact.conversationId,
      channelId: activeArtifact.channelId,
      messagePreview: activeArtifact.messagePreview,
      messageCreatedAt: activeArtifact.messageCreatedAt,
      isInitialMessage: activeArtifact.isInitialMessage,
      ...(activeArtifact.callExternalId
        ? { activeCallExternalId: activeArtifact.callExternalId }
        : {}),
    });
  }

  return {
    bannerItems,
    channelIdsWithActiveSideEffects: new Set(bannerItems.map(item => item.channelId)),
    activeArtifactsByMessageId,
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
    const unsupportedArtifactRows = activeArtifacts.filter(
      artifact => !getSlashCommandArtifactDefinition(artifact.command),
    ).length;

    return {
      artifactQueryState: activeArtifactQuery.type,
      artifactRows: activeArtifacts.length,
      unsupportedArtifactRows,
      bannerItemsWithCallLink: value.bannerItems.filter(item => !!item.activeCallExternalId).length,
      resolvedArtifactCards: value.activeArtifactsByMessageId.size,
      resolvedBannerItems: value.bannerItems.length,
      resolvedChannelIndicators: value.channelIdsWithActiveSideEffects.size,
    };
  }, [activeArtifacts, activeArtifactQuery.type, value]);

  useEffect(() => {
    const signature = JSON.stringify(diagnostics);
    if (lastDiagnosticSignature.current === signature) return;
    lastDiagnosticSignature.current = signature;

    logger.info(Event.SLASH_COMMAND_ARTIFACT_SIDE_EFFECTS_RECONCILED, diagnostics);
    if (diagnostics.unsupportedArtifactRows > 0) {
      logger.warn(Event.SLASH_COMMAND_ARTIFACT_INVARIANT_FAILED, {
        reason: 'artifact_subscription_command_unsupported',
        unsupportedArtifactRows: diagnostics.unsupportedArtifactRows,
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

/**
 * Live state for one artifact message. Undefined once its call has ended (the
 * subscription is ACTIVE-only — the card then falls back to the summary baked
 * into the message), or when the viewer is not a participant of its channel.
 */
export const useActiveSlashCommandArtifact = (
  messageId: string | undefined,
): ActiveSlashCommandArtifact | undefined => {
  const { activeArtifactsByMessageId } = useSlashCommandArtifactSideEffects();
  return messageId ? activeArtifactsByMessageId.get(messageId) : undefined;
};
