import { useState, JSX, cloneElement } from 'react';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useZero } from '../../../hooks/useZero';
import { useChannel, useGetChannelUserStatus } from '../../../hooks/useChannels';
import useMeasure from '../../../hooks/useMeasure';
import { Star, Users2, ExternalLink } from 'lucide-react';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import Dialog from '../../ui/Dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { cn } from '../../../utils/classNames';
import { mutators } from '../../../zero/mutators';
import Tooltip from '../../ui/Tooltip';
import Info, { ChannelTab } from '../Info/Info';
import ConversationHeaderMobile from '../ConversationHeaderMobile/ConversationHeaderMobile';
import ChannelIcon from '../ChannelIcon/ChannelIcon';
import { ConversationTabListType } from '../ConversationPannel/ConversationPannel.utils';
import { Button } from '../../ui/Button';
import { CallTrigger } from '../../Call/CallTrigger/CallTrigger';
import { getTargetUserIdForCall } from './ConversationHeader.utils';
import { useUser } from '../../../hooks/useUsers';
import { isDMChannel, isOneToOneDMChannel } from '../ChatDirectory/ChatDirectory.utils';
import { StatusIndicator } from '../../ui/StatusIndicator';
import { xyneAIActor } from '../../../machines/xyneAIMachine';
import { useNavigate } from 'react-router-dom';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { standaloneNavigate } from '../../../utils/electronApp';
import { usePlatform } from '../../../hooks/usePlatform';
import { XyneAIStar } from '../../icons/xyne-ai';
import { trackAskAIOpened } from '../../../services/otel/xyneAIMetrics';

interface ConversationHeaderProps {
  channelId: string;
  previousChannelId?: string | null;
  channelTabs?: ConversationTabListType[];
  activeTab?: string;
  setActiveTab?: (tab: string, e?: React.MouseEvent) => void;
}

const ConversationHeader = ({
  channelId,
  previousChannelId,
  channelTabs,
  activeTab,
  setActiveTab,
}: ConversationHeaderProps): JSX.Element | null => {
  const context = useAuthContextValues();
  const zero = useZero();
  const channel = useChannel(channelId);
  const channelUserStatus = useGetChannelUserStatus(channelId);
  const { displayName, avatarUserId } = useChannelDisplayName(channel, context.userID);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [infoDefaultTab, setInfoDefaultTab] = useState<ChannelTab>('about');
  const navigate = useNavigate();
  const { baseRoute } = useRouteContext();

  // Get user status for DMs
  const isDM = channel && isDMChannel(channel.scopeType);
  const dmUser = useUser(avatarUserId || '');

  const { width } = useMeasure({ observeResize: true });
  const { isMobile } = usePlatform();

  // Get target user ID for 1:1 DM calls
  const targetUserId = getTargetUserIdForCall(channel?.scopeType, channel?.name, context.userID);

  const handleStarToggle = (): void => {
    void zero.mutate(mutators.channel.toggleStarred({ channelId }));
  };

  const handleOpenAllLinks = (e: React.MouseEvent): void => {
    standaloneNavigate(navigate, `${baseRoute}/${channelId}?tab=links&openAllLinks=true`, {
      event: e,
    });
  };

  if (!channel) return null;

  if (isMobile || width < 500)
    return (
      <div className='absolute top-0 left-0 right-0 z-10'>
        <ConversationHeaderMobile
          channelId={channelId}
          {...(previousChannelId !== undefined && { previousChannelId })}
          channel={channel}
          channelUserStatus={channelUserStatus!}
          channelTabs={channelTabs}
          activeTab={activeTab}
          handleStarToggle={handleStarToggle}
        />
      </div>
    );

  return (
    <div className='h-[88px] bg-background border-b border-border'>
      <div className='h-14 p-4 flex items-center justify-between gap-4'>
        <div className='flex items-center gap-2 text-primary'>
          <ChannelIcon channel={channel} />
          <button
            onClick={() => {
              setInfoDefaultTab('about');
              setIsInfoOpen(true);
            }}
            className='text-base font-semibold hover:underline tracking-[-0.17px] flex items-center gap-2'
            data-testid='channel-info-trigger'
          >
            <span className='visual-regression-hide truncate'>{displayName}</span>
            {isDM && (
              <StatusIndicator
                statusEmoji={dmUser?.presenceStatus?.statusEmoji}
                statusContent={dmUser?.presenceStatus?.statusContent}
                statusExpiryAt={dmUser?.presenceStatus?.statusExpiryAt}
                size='md'
                showOnHover={true}
              />
            )}
          </button>
        </div>
        <div className='flex items-center gap-2'>
          <Tooltip content={channelUserStatus?.isStarred ? 'Unstar' : 'Star'}>
            <Button
              variant='outline'
              onClick={handleStarToggle}
              className={cn(
                'flex items-center justify-between gap-2 border border-border rounded-lg !p-2 transition-all duration-100 text-primary',
                channelUserStatus?.isStarred
                  ? 'bg-[#FBEFD9] border-[#FBEFD9]'
                  : 'bg-white border-gray-200',
              )}
            >
              <Star
                className='w-4 h-4 text-gray-800'
                fill={(channelUserStatus?.isStarred ?? false) ? '#FACC14' : 'none'}
                stroke={(channelUserStatus?.isStarred ?? false) ? '#FACC14' : '#3B4145'}
              />
            </Button>
          </Tooltip>
          {channel.participantCount > 1 && !isOneToOneDMChannel(channel.scopeType) && (
            <Tooltip content='View members'>
              <Button
                variant='outline'
                onClick={() => {
                  setInfoDefaultTab('members');
                  setIsInfoOpen(true);
                }}
                className='flex items-center justify-between gap-2 border border-border rounded-lg p-2 text-primary'
              >
                <span className='shrink-0'>
                  <Users2 className='w-4 h-4' />
                </span>
                <span className='h-4 w-[1px] bg-muted-foreground/30 rounded-full'></span>
                <span className='shrink-0'>{channel.participantCount}</span>
              </Button>
            </Tooltip>
          )}
          <Tooltip content='Ask AI'>
            <Button
              variant='outline'
              onClick={() => {
                // Track Ask AI opened event via OTel metrics
                trackAskAIOpened(channel.scopeType);

                // Trigger xstate machine to open XyneAI
                xyneAIActor.send({ type: 'OPEN', channelId });
              }}
              className='flex items-center justify-between gap-2 border border-border rounded-lg !p-2 transition-all duration-100 text-primary bg-white border-gray-200'
            >
              <XyneAIStar />
            </Button>
          </Tooltip>
          {
            <Tooltip content={`Open all Links`}>
              <Button
                variant='outline'
                onClick={handleOpenAllLinks}
                className='flex items-center justify-between gap-2 border border-border rounded-lg !p-2 transition-all duration-100 text-primary bg-white border-gray-200'
              >
                <ExternalLink className='w-4 h-4' />
              </Button>
            </Tooltip>
          }
          <CallTrigger
            channelId={channelId}
            targetUserIds={targetUserId ? [targetUserId] : []}
            scopeType={channel.scopeType}
            channelName={displayName}
            participantCount={channel.participantCount}
            callDisplayName={displayName}
          />
        </div>
      </div>
      <div className='px-4'>
        <Tabs.Root defaultValue={activeTab || 'chat'}>
          <Tabs.List className='flex items-center justify-start overflow-x-auto no-scrollbar'>
            {channelTabs?.map(tab => (
              <Tabs.Trigger key={tab.value} value={tab.value} asChild>
                <button
                  data-testid={`channel-tab-${tab.value}`}
                  onClick={e => setActiveTab?.(tab.value || '', e)}
                  className={cn(
                    'h-8 flex items-center justify-start gap-1.5 px-2 transition-all duration-100 cursor-pointer',
                    activeTab === tab.value
                      ? 'border-b-2 border-primary'
                      : 'border-b-2 border-transparent',
                    activeTab === tab.value ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  <span className='shrink-0'>
                    {cloneElement(tab.icon, { color: 'currentColor' } as { color: string })}
                  </span>
                  <span className={cn('text-sm font-medium')}>{tab.label}</span>
                </button>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs.Root>
      </div>

      <Dialog
        className='max-w-[496px] rounded-2xl overflow-hidden'
        open={isInfoOpen}
        onOpenChange={setIsInfoOpen}
      >
        <Info
          channel={channel}
          {...(previousChannelId !== undefined && { previousChannelId })}
          defaultTab={infoDefaultTab}
          onClose={() => setIsInfoOpen(false)}
        />
      </Dialog>
    </div>
  );
};

export default ConversationHeader;
