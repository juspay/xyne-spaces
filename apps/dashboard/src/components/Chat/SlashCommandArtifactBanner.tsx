import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Phone, TriangleAlert, X } from 'lucide-react';
import { useSelector } from '@xstate/react';
import { useMatches, useNavigate } from 'react-router-dom';
import { getSlashCommandArtifactDiagnosticKey } from '@xyne/shared';
import { useCallJoinOrInitiate } from '../../hooks/useCallJoinOrInitiate';
import { useChannel } from '../../hooks/useChannels';
import { useChannelDisplayName } from '../../hooks/useChannelDisplayName';
import { useAuthContextValues } from '../../hooks/useAuth';
import { useRouteContext } from '../../hooks/useRouteContext';
import { formatElapsedTime as formatMessageAge } from '../../utils/dateUtils';
import { roomActor } from '../../machines/roomMachine';
import { Event, logger } from '../../utils/logger';
import {
  useSlashCommandArtifactSideEffects,
  type SlashCommandArtifactBannerItem,
} from './SlashCommandArtifactSideEffects';
import { buildSlashCommandArtifactRoute } from './SlashCommandArtifacts';
import { isDMChannel } from './ChatDirectory/ChatDirectory.utils';

export const getVisibleSlashCommandArtifactBanners = (
  items: readonly SlashCommandArtifactBannerItem[],
  activeChannelId: string | undefined,
): SlashCommandArtifactBannerItem[] => items.filter(item => item.channelId !== activeChannelId);

export const SlashCommandArtifactBanner = (): React.JSX.Element | null => {
  const navigate = useNavigate();
  const { baseRoute } = useRouteContext();
  const routeMatches = useMatches();
  const activeChannelId = useMemo(
    () =>
      [...routeMatches]
        .reverse()
        .map(match => match.params['channelId'])
        .find((channelId): channelId is string => typeof channelId === 'string'),
    [routeMatches],
  );
  const { bannerItems } = useSlashCommandArtifactSideEffects();
  const [currentBannerId, setCurrentBannerId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const currentCallId = useSelector(roomActor, state => state.context.externalId);
  const { joinCall } = useCallJoinOrInitiate();
  const { userID } = useAuthContextValues();

  const visibleItems = useMemo(
    () => getVisibleSlashCommandArtifactBanners(bannerItems, activeChannelId),
    [activeChannelId, bannerItems],
  );

  useEffect(() => {
    if (visibleItems.length === 0) {
      setCurrentBannerId(null);
      setIsOpen(false);
      return;
    }
    setCurrentBannerId(currentId =>
      currentId && visibleItems.some(item => item.id === currentId)
        ? currentId
        : (visibleItems[0]?.id ?? null),
    );
  }, [visibleItems]);

  const currentIndex = Math.max(
    0,
    visibleItems.findIndex(item => item.id === currentBannerId),
  );
  const item = visibleItems[currentIndex];
  const channel = useChannel(item?.channelId ?? '');
  const { displayName: channelDisplayName } = useChannelDisplayName(channel, userID);
  if (!item) return null;

  const isInThisCall = currentCallId === item.activeCallExternalId;
  const channelLabel = `${channel && isDMChannel(channel.scopeType) ? '' : '#'}${
    channelDisplayName || 'channel'
  }`;
  const showPagination = visibleItems.length > 1;
  const paginate = (direction: -1 | 1): void => {
    const nextIndex = (currentIndex + direction + visibleItems.length) % visibleItems.length;
    const nextItem = visibleItems[nextIndex];
    setCurrentBannerId(nextItem?.id ?? null);
    logger.info(Event.SLASH_COMMAND_ARTIFACT_ACTION, {
      action: direction === -1 ? 'previous_banner' : 'next_banner',
      artifactKey: getSlashCommandArtifactDiagnosticKey(nextItem?.messageId),
      bannerCount: visibleItems.length,
    });
  };

  const viewArtifact = (): void => {
    const path = buildSlashCommandArtifactRoute({
      baseRoute,
      channelId: item.channelId,
      conversationId: item.conversationId,
      messageId: item.messageId,
      isInitialMessage: item.isInitialMessage,
    });
    setIsOpen(false);
    logger.info(Event.SLASH_COMMAND_ARTIFACT_ACTION, {
      action: 'view_artifact',
      artifactKey: getSlashCommandArtifactDiagnosticKey(item.messageId),
      channelKey: getSlashCommandArtifactDiagnosticKey(item.channelId),
      isInitialMessage: item.isInitialMessage,
    });
    void navigate(path, {
      state: {
        activityNavigationNonce: Date.now(),
        linkedItemCreatedAt: item.messageCreatedAt,
      },
    });
  };

  return (
    <>
      <aside className='fixed bottom-[124px] left-[10px] hidden sm:block'>
        <button
          type='button'
          onClick={() => setIsOpen(open => !open)}
          className='relative flex size-10 items-center justify-center rounded-xl border border-orange-300 bg-orange-50 text-orange-600 shadow-lg transition-colors hover:bg-orange-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300 dark:hover:bg-orange-900'
          aria-label={`${visibleItems.length} active slash command artifact${visibleItems.length === 1 ? '' : 's'}`}
          aria-expanded={isOpen}
          aria-controls='slash-command-artifact-banner-popover'
          data-track-category='SLASH_COMMAND_ARTIFACT'
          data-track-name='TOGGLE_BANNER_POPOVER'
        >
          <span className='absolute inset-1 animate-ping rounded-lg border border-orange-400 opacity-40 motion-reduce:animate-none' />
          <TriangleAlert className='relative size-5' strokeWidth={2} />
          <span className='absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full border-2 border-sidebar bg-orange-500 px-1 text-[10px] font-bold text-white'>
            {visibleItems.length > 99 ? '99+' : visibleItems.length}
          </span>
        </button>
      </aside>

      {isOpen && (
        <section
          id='slash-command-artifact-banner-popover'
          role='dialog'
          aria-label={`${item.definition.badge} alert in ${channelLabel}`}
          className='fixed bottom-4 left-[58px] z-[100] hidden h-[110px] w-[344px] max-w-[calc(100vw-70px)] flex-col rounded-2xl border border-orange-300 bg-orange-50 p-3 text-orange-800 shadow-2xl sm:flex dark:border-orange-800 dark:bg-orange-950 dark:text-orange-100'
        >
          <div className='flex min-w-0 items-center gap-2'>
            <span className='relative flex size-2 shrink-0'>
              <span className='absolute inline-flex size-full animate-ping rounded-full bg-orange-500 opacity-60 motion-reduce:animate-none' />
              <span className='relative inline-flex size-2 rounded-full bg-orange-500' />
            </span>
            <span className='shrink-0 rounded-md bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white'>
              {item.definition.badge}
            </span>
            <span className='min-w-0 flex-1 truncate text-sm font-semibold'>{channelLabel}</span>
            <span className='shrink-0 text-xs text-orange-700/80 dark:text-orange-300/80'>
              {formatMessageAge(item.messageCreatedAt)}
            </span>
            <button
              type='button'
              onClick={() => setIsOpen(false)}
              className='-mr-1 flex size-5 shrink-0 items-center justify-center rounded-md text-orange-700/70 hover:bg-orange-100 hover:text-orange-900 dark:text-orange-300/70 dark:hover:bg-orange-900 dark:hover:text-orange-100'
              aria-label='Close slash command artifact alerts'
              data-track-category='SLASH_COMMAND_ARTIFACT'
              data-track-name='CLOSE_BANNER_POPOVER'
            >
              <X className='size-3' />
            </button>
          </div>

          <p className='mt-2 min-w-0 truncate text-sm text-foreground' title={item.messagePreview}>
            {item.messagePreview}
          </p>

          <div className='mt-auto flex items-end justify-between gap-2'>
            <div className='flex min-w-0 items-center gap-2'>
              <button
                type='button'
                onClick={viewArtifact}
                className='flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg border border-orange-300 bg-white/70 px-3 text-xs font-semibold hover:bg-white dark:border-orange-800 dark:bg-orange-950 dark:hover:bg-orange-900'
                data-track-category='SLASH_COMMAND_ARTIFACT'
                data-track-name='VIEW_FROM_BANNER'
                data-track-metadata={JSON.stringify({
                  artifactKey: getSlashCommandArtifactDiagnosticKey(item.messageId),
                  channelKey: getSlashCommandArtifactDiagnosticKey(item.channelId),
                })}
              >
                {item.definition.viewActionLabel}
                <ArrowRight className='size-3' />
              </button>

              {item.activeCallExternalId && (
                <button
                  type='button'
                  onClick={() => {
                    if (!isInThisCall) {
                      setIsOpen(false);
                      logger.info(Event.SLASH_COMMAND_ARTIFACT_ACTION, {
                        action: 'join_call_from_banner',
                        artifactKey: getSlashCommandArtifactDiagnosticKey(item.messageId),
                        callKey: getSlashCommandArtifactDiagnosticKey(item.activeCallExternalId),
                      });
                      joinCall({ callId: item.activeCallExternalId! });
                    }
                  }}
                  disabled={isInThisCall}
                  className='flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg bg-orange-500 px-2.5 text-xs font-semibold text-white hover:bg-orange-600 disabled:cursor-default disabled:opacity-70'
                  data-track-category='SLASH_COMMAND_ARTIFACT'
                  data-track-name='JOIN_CALL_FROM_BANNER'
                  data-track-metadata={JSON.stringify({
                    artifactKey: getSlashCommandArtifactDiagnosticKey(item.messageId),
                    channelKey: getSlashCommandArtifactDiagnosticKey(item.channelId),
                    callKey: getSlashCommandArtifactDiagnosticKey(item.activeCallExternalId),
                  })}
                >
                  <Phone className='size-3' />
                  {isInThisCall ? 'In call' : 'Join call'}
                </button>
              )}
            </div>

            {showPagination && (
              <div className='flex h-[30px] shrink-0 items-center overflow-hidden rounded-lg border border-orange-300 bg-white/60 dark:border-orange-800 dark:bg-orange-950'>
                <button
                  type='button'
                  onClick={() => paginate(-1)}
                  className='flex h-full w-7 items-center justify-center hover:bg-orange-100 dark:hover:bg-orange-900'
                  aria-label='Previous slash command artifact banner'
                  data-track-category='SLASH_COMMAND_ARTIFACT'
                  data-track-name='PREVIOUS_BANNER'
                >
                  <ChevronLeft className='size-3' />
                </button>
                <span className='min-w-8 text-center text-xs font-medium'>
                  {currentIndex + 1} / {visibleItems.length}
                </span>
                <button
                  type='button'
                  onClick={() => paginate(1)}
                  className='flex h-full w-7 items-center justify-center hover:bg-orange-100 dark:hover:bg-orange-900'
                  aria-label='Next slash command artifact banner'
                  data-track-category='SLASH_COMMAND_ARTIFACT'
                  data-track-name='NEXT_BANNER'
                >
                  <ChevronRight className='size-3' />
                </button>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
};
