import {
  useState,
  useRef,
  useContext,
  JSX,
  cloneElement,
  RefObject,
  useMemo,
  useEffect,
} from 'react';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { ChannelScopeType, ChannelUserStatus } from '@xyne/shared';
import { ChevronRight, SearchDefault, Settings01, Star, UserPlus, UserTwo } from '@xyne/icons';
import { ConversationTabListType } from '../ConversationPannel/ConversationPannel.utils';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { ConversationTabContext } from '../ConversationTabContext';
import Info, { ChannelTab } from '../Info/Info';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import ChannelIcon from '../ChannelIcon/ChannelIcon';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import Drawer from '../../ui/Drawer';
import AddPeopleForm from '../AddPeopleForm/AddPeopleForm';
import { getTargetUserIdForCall } from '../ConversationHeader/ConversationHeader.utils';
import { useLocation } from 'react-router-dom';
import { useRouteContext } from '../../../hooks/useRouteContext';
import { xyneAIActor } from '../../../machines/xyneAIMachine';
import { cn } from '../../../utils/classNames';
import { CallTriggerModal } from '../../Call/CallTriggerModal/CallTriggerModal';
import { VisibleChannel } from '../../../machines/stateMachine';
import { useUser } from '../../../hooks/useUsers';
import { isOneToOneDMChannel } from '../ChatDirectory/ChatDirectory.utils';
import { isStatusExpired } from '../../../utils/statusUtils';
import { StatusIndicator } from '../../ui/StatusIndicator';
import { XyneAIStar } from '../../icons/xyne-ai';

interface ConversationHeaderMobileProps {
  channelId: string;
  previousChannelId?: string | null;
  channel: VisibleChannel;
  channelUserStatus: ChannelUserStatus;
  channelTabs?: ConversationTabListType[] | undefined;
  activeTab?: string | undefined;
  handleStarToggle: () => void;
}
const ConversationHeaderMobile = ({
  channel,
  previousChannelId,
  channelUserStatus,
  channelTabs,
  activeTab,
  handleStarToggle,
}: ConversationHeaderMobileProps): JSX.Element => {
  const navigate = useNavigate();
  const ROOT_SIZE = 44;
  const GAP_SIZE = 8;
  const context = useAuthContextValues();
  const { displayName, avatarUserId } = useChannelDisplayName(channel, context.userID);
  const dmUser = useUser(avatarUserId || '');

  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [infoDefaultTab, setInfoDefaultTab] = useState<ChannelTab>('about');
  const [isInfoDrawerOpen, setIsInfoDrawerOpen] = useState<boolean>(false);
  const [isAddPeopleDrawerOpen, setIsAddPeopleDrawerOpen] = useState<boolean>(false);
  const { setActiveTab } = useContext(ConversationTabContext);
  const channelScopeType = channel.scopeType;
  const location = useLocation();
  const { baseRoute } = useRouteContext();

  const targetUserId = useMemo(
    () => getTargetUserIdForCall(channel?.scopeType, channel?.name, context.userID),
    [channel?.scopeType, channel?.name, context.userID],
  );

  useClickOutside(containerRef as RefObject<HTMLElement>, () => {
    setIsExpanded(false);
  });

  useEffect(() => {
    setIsExpanded(false);
  }, [location.pathname, location.search]);

  const containerVariants = {
    default: {
      left: ROOT_SIZE + GAP_SIZE,
      top: 0,
      height: ROOT_SIZE,
      width: `calc(100% - ${(ROOT_SIZE + GAP_SIZE) * 3}px)`,
      borderRadius: 44,
    },
    expanded: {
      left: 0,
      top: 0,
      width: '100%',
      height: 'auto',
      borderRadius: 16,
    },
  };
  const isStarred = channelUserStatus?.isStarred ?? false;
  const floatingButtonClass =
    'border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-accent';
  return (
    <div className='relative w-full p-2 bg-transparent z-10'>
      <div className='absolute top-0 left-0 right-0 z-0 h-16 bg-gradient-to-b from-background to-transparent touch-none' />
      <div className='relative flex items-center gap-x-2'>
        <button
          onClick={() => {
            void navigate(baseRoute);
          }}
          className={cn('flex items-center justify-center rounded-full', floatingButtonClass)}
          style={{
            width: ROOT_SIZE,
            height: ROOT_SIZE,
          }}
          data-track-category='CHANNELS_MOBILE_VIEW'
          data-track-name='Back_To_Directory_Mobile'
          data-track-metadata={JSON.stringify({ channelId: channel.id })}
        >
          <svg
            width='7'
            height='12'
            viewBox='0 0 7 12'
            fill='none'
            xmlns='http://www.w3.org/2000/svg'
          >
            <path
              d='M5.83301 10.832L0.833008 5.83203L5.83301 0.832031'
              stroke='currentColor'
              strokeWidth='1.66667'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
          </svg>
        </button>
        <motion.div
          ref={containerRef}
          data-id='conversation-header-mobile-container'
          variants={containerVariants}
          initial='default'
          animate={isExpanded ? 'expanded' : 'default'}
          onClick={() => setIsExpanded(true)}
          className='absolute z-50 overflow-clip border border-border bg-background text-left text-foreground shadow-sm'
          transition={{ type: 'spring', bounce: 0.1, duration: 0.4 }}
          data-track-category='CHANNELS_MOBILE_VIEW'
          data-track-name='EXPAND_HEADER_MOBILE'
          data-track-metadata={JSON.stringify({ channelId: channel.id })}
        >
          <motion.div className='flex items-center gap-2 px-2' style={{ height: ROOT_SIZE }}>
            <div style={{ height: ROOT_SIZE }} className='flex items-center justify-center'>
              <ChannelIcon channel={channel} />
            </div>
            <div style={{ height: ROOT_SIZE }} className='flex flex-col items-start justify-center'>
              <p className='text-sm font-medium whitespace-nowrap overflow-hidden text-foreground'>
                {displayName}
              </p>
              {channel &&
              isOneToOneDMChannel(channel.scopeType) &&
              dmUser?.statusEmoji &&
              (!dmUser.statusExpiryAt || !isStatusExpired(dmUser.statusExpiryAt)) ? (
                <small className='text-muted-foreground text-xs truncate max-w-[200px] flex items-center gap-1'>
                  <StatusIndicator
                    statusEmoji={dmUser.statusEmoji}
                    statusContent={dmUser.statusContent}
                    statusExpiryAt={dmUser.statusExpiryAt}
                    size='sm'
                    showOnHover={false}
                  />
                  {dmUser.statusContent}
                </small>
              ) : (
                <small className='text-muted-foreground text-xs'>
                  {channel.channelStats?.participantCount} members
                </small>
              )}
            </div>
          </motion.div>

          <div className='p-2'>
            <div className='flex items-center justify-between gap-2'>
              <button
                onClick={() => setIsAddPeopleDrawerOpen(true)}
                className='w-full border border-border flex items-center justify-center gap-2 rounded-lg py-1.5 px-2  h-[34px]'
                data-track-category='CHANNELS_MOBILE_VIEW'
                data-track-name='ADD_PEOPLE_MOBILE'
                data-track-metadata={JSON.stringify({ channelId: channel.id })}
              >
                <UserPlus size={16} />
                <span className='text-sm font-medium text-foreground'>Add</span>
              </button>
              <button
                onClick={handleStarToggle}
                data-ph-capture-attribute-track-id='toggle_star_channel'
                className={cn(
                  'w-full border flex items-center justify-center gap-2 rounded-lg py-1.5 px-2 h-[34px] transition-all duration-100',
                  isStarred ? 'bg-muted border-border' : 'bg-background border-border',
                )}
                data-track-category='CHANNELS_MOBILE_VIEW'
                data-track-name='TOGGLE_STAR_MOBILE'
                data-track-metadata={JSON.stringify({
                  channelId: channel.id,
                  isStarred: channelUserStatus?.isStarred,
                })}
              >
                <Star
                  size={16}
                  variant={isStarred ? 'Solid' : 'Stroke'}
                  className={isStarred ? 'text-status-pending' : 'text-muted-foreground'}
                />
                <span className='text-sm font-medium text-foreground'>
                  {isStarred ? 'Unstar' : 'Star'}
                </span>
              </button>
              <button
                onClick={(): void => void navigate('/chat/search')}
                disabled={true}
                className='w-full border border-border flex items-center justify-center gap-2 rounded-lg py-1.5 px-2 h-[34px] disabled:opacity-50 disabled:cursor-not-allowed'
                data-track-category='CHANNELS_MOBILE_VIEW'
                data-track-name='SEARCH_MOBILE'
                data-track-metadata={JSON.stringify({ channelId: channel.id })}
              >
                <SearchDefault size={16} />
                <span className='text-sm font-medium text-foreground'>Search</span>
              </button>
            </div>
            <div className='space-y-1 pt-2'>
              {channelTabs?.map((tab: ConversationTabListType) => (
                <button
                  key={tab.label}
                  className={cn(
                    'w-full text-left px-2 h-10 flex items-center justify-start gap-2 rounded-md transition-all duration-100',
                    activeTab === tab.label.toLowerCase() && 'bg-muted',
                  )}
                  onClick={() => setActiveTab(tab.label.toLowerCase())}
                  data-track-category='CHANNELS_MOBILE_VIEW'
                  data-track-name='SELECT_HEADER_TAB_MOBILE'
                  data-track-metadata={JSON.stringify({ tab: tab.label })}
                >
                  {cloneElement(tab.icon, {
                    color: 'currentColor',
                  } as { color: string })}
                  <span className='text-sm font-medium text-foreground'>{tab.label}</span>
                </button>
              ))}

              <hr className='my-2 border-border' />

              <button
                onClick={() => {
                  setInfoDefaultTab('members');
                  setIsInfoDrawerOpen(true);
                }}
                className='w-full text-left px-2 h-10 flex items-center justify-start gap-2 rounded-md transition-all duration-100'
                data-track-category='CHANNELS_MOBILE_VIEW'
                data-track-name='VIEW_MEMBERS_MOBILE'
                data-track-metadata={JSON.stringify({ channelId: channel.id })}
              >
                <span className='size-4 flex items-center justify-center shrink-0'>
                  <UserTwo size={16} />
                </span>
                <span className='text-sm font-medium text-foreground'>
                  {channelScopeType === ChannelScopeType.DM ? 'Profile' : 'Members'}
                </span>
                <span className='text-sm font-medium text-foreground ml-auto'>
                  {channel.channelStats?.participantCount}
                </span>
                <span>
                  <ChevronRight size={16} />
                </span>
              </button>
              <button
                onClick={() => {
                  setInfoDefaultTab('about');
                  setIsInfoDrawerOpen(true);
                }}
                className='w-full text-left px-2 h-10 flex items-center justify-start gap-2 rounded-md transition-all duration-100'
                data-track-category='CHANNELS_MOBILE_VIEW'
                data-track-name='OPEN_SETTINGS_MOBILE'
                data-track-metadata={JSON.stringify({ channelId: channel.id })}
              >
                <span className='size-4 flex items-center justify-center shrink-0'>
                  <Settings01 size={16} />
                </span>
                <span className='text-sm font-medium text-foreground'>Settings</span>
              </button>
            </div>
          </div>
        </motion.div>
        <div
          style={{ width: ROOT_SIZE, height: ROOT_SIZE, right: ROOT_SIZE + GAP_SIZE }}
          className='absolute top-0'
        >
          <div className='w-full h-full'>
            <CallTriggerModal
              channelId={channel.id}
              {...(targetUserId && { targetUserIds: [targetUserId] })}
              {...(channel.scopeType && { scopeType: channel.scopeType })}
              {...(displayName && { channelName: displayName })}
              {...(channel.channelStats?.participantCount !== undefined && {
                participantCount: channel.channelStats?.participantCount,
              })}
              callDisplayName={displayName}
              isMember={!!channelUserStatus}
              className={cn('rounded-full', floatingButtonClass)}
              disabled={channel.isArchived}
            />
          </div>
        </div>
        <button
          onClick={() => {
            xyneAIActor.send({ type: 'OPEN', channelId: channel.id });
          }}
          style={{ width: ROOT_SIZE, height: ROOT_SIZE }}
          className={cn(
            'absolute right-0 top-0 flex items-center justify-center rounded-full',
            floatingButtonClass,
          )}
          data-track-category='CHANNELS_MOBILE_VIEW'
          data-track-name='OPEN_XYNE_AI_MOBILE'
          data-track-metadata={JSON.stringify({ channelId: channel.id })}
        >
          <XyneAIStar size={17} />
        </button>
      </div>
      <Drawer
        open={isInfoDrawerOpen}
        onOpenChange={setIsInfoDrawerOpen}
        title='About Channel'
        description='View and manage channel details'
      >
        <Info
          channel={channel}
          {...(previousChannelId !== undefined && { previousChannelId })}
          defaultTab={infoDefaultTab}
          onClose={() => setIsInfoDrawerOpen(false)}
        />
      </Drawer>
      <Drawer
        open={isAddPeopleDrawerOpen}
        onOpenChange={setIsAddPeopleDrawerOpen}
        title='Add People'
        description='Add people to the channel'
      >
        <AddPeopleForm channelId={channel.id} onSuccess={() => setIsAddPeopleDrawerOpen(false)} />
      </Drawer>
    </div>
  );
};

export default ConversationHeaderMobile;
