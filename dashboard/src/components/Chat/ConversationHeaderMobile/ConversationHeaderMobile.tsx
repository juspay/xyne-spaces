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
import { ChannelScopeType, Channel, ChannelUserStatus } from '@xyne/shared';
import { ChevronRight, Search, Settings, Star, UserRoundPlus, Users } from 'lucide-react';
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

interface ConversationHeaderMobileProps {
  channelId: string;
  previousChannelId?: string | null;
  channel: Channel;
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
  const { displayName } = useChannelDisplayName(channel, context.userID);
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
  return (
    <div className='relative w-full p-2 bg-transparent z-10'>
      <div className='absolute top-0 left-0 right-0 z-0 h-16 bg-gradient-to-b from-background to-transparent touch-none' />
      <div className='relative flex items-center gap-x-2'>
        <button
          onClick={() => {
            void navigate(baseRoute);
          }}
          className='flex items-center justify-center  rounded-[999px] border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5]'
          style={{
            width: ROOT_SIZE,
            height: ROOT_SIZE,
            // background: 'linear-gradient(135deg, #FFFFFF 0%, #FFFFFF 100%)',
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
          className={`absolute text-left z-50 overflow-clip border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5]`}
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
              <small className='text-muted-foreground text-xs'>
                {channel.participantCount} members
              </small>
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
                <UserRoundPlus className='size-4' />
                <span className='text-sm font-medium text-foreground'>Add</span>
              </button>
              <button
                onClick={handleStarToggle}
                className={cn(
                  'w-full border flex items-center justify-center gap-2 rounded-lg py-1.5 px-2 h-[34px] transition-all duration-100',
                  channelUserStatus?.isStarred
                    ? 'bg-[#FBEFD9] border-[#FBEFD9]'
                    : 'bg-background border-border',
                )}
                data-track-category='CHANNELS_MOBILE_VIEW'
                data-track-name='TOGGLE_STAR_MOBILE'
                data-track-metadata={JSON.stringify({
                  channelId: channel.id,
                  isStarred: channelUserStatus?.isStarred,
                })}
              >
                <Star
                  className='size-4'
                  fill={(channelUserStatus?.isStarred ?? false) ? '#FACC14' : 'none'}
                  stroke={(channelUserStatus?.isStarred ?? false) ? '#FACC14' : '#3B4145'}
                />
                <span className='text-sm font-medium text-foreground'>
                  {(channelUserStatus?.isStarred ?? false) ? 'Unstar' : 'Star'}
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
                <Search className='size-4' />
                <span className='text-sm font-medium text-foreground'>Search</span>
              </button>
            </div>
            <div className='space-y-1 pt-2'>
              {channelTabs?.map((tab: ConversationTabListType) => (
                <button
                  key={tab.label}
                  className='w-full text-left px-2 h-10 flex items-center justify-start gap-2 rounded-md transition-all duration-100'
                  style={{
                    backgroundColor:
                      activeTab === tab.label.toLowerCase() ? '#F2F2F3' : 'transparent',
                  }}
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
                  <Users className='size-4' />
                </span>
                <span className='text-sm font-medium text-foreground'>
                  {channelScopeType === ChannelScopeType.DM ? 'Profile' : 'Members'}
                </span>
                <span className='text-sm font-medium text-foreground ml-auto'>
                  {channel.participantCount}
                </span>
                <span>
                  <ChevronRight className='size-4' />
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
                  <Settings className='size-4' />
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
              {...(channel.participantCount !== undefined && {
                participantCount: channel.participantCount,
              })}
              callDisplayName={displayName}
              isMember={!!channelUserStatus}
              className='rounded-full border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5]'
            />
          </div>
        </div>
        <button
          onClick={() => {
            xyneAIActor.send({ type: 'OPEN', channelId: channel.id });
          }}
          style={{ width: ROOT_SIZE, height: ROOT_SIZE }}
          className='absolute right-0 top-0 rounded-full flex items-center justify-center border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5]'
          data-track-category='CHANNELS_MOBILE_VIEW'
          data-track-name='OPEN_XYNE_AI_MOBILE'
          data-track-metadata={JSON.stringify({ channelId: channel.id })}
        >
          <svg
            xmlns='http://www.w3.org/2000/svg'
            width='17'
            height='17'
            viewBox='0 0 17 17'
            fill='none'
          >
            <g filter='url(#filter0_ii_2440_92537)'>
              <path
                d='M7.57441 15.8759C7.57287 13.1907 7.18228 11.5734 6.26007 10.5931C5.34838 9.62413 3.73528 9.09014 0.756805 9.09014C0.33862 9.09014 0.000354246 8.75144 0 8.33333C0 7.91493 0.338401 7.57441 0.756805 7.57441C3.73531 7.57441 5.34839 7.04044 6.26007 6.0714C7.18206 5.09108 7.57292 3.47374 7.57441 0.788603C7.57441 0.778162 7.57441 0.767274 7.57441 0.756805C7.57465 0.33857 7.9151 0 8.33333 0C8.75127 0.000354114 9.0899 0.338789 9.09014 0.756805C9.09014 0.767828 9.09014 0.779725 9.09014 0.790723C9.0918 3.47445 9.48295 5.09125 10.4045 6.0714C11.3161 7.04035 12.9298 7.57431 15.9077 7.57441C16.3261 7.57441 16.6667 7.91493 16.6667 8.33333C16.6663 8.75144 16.3259 9.09014 15.9077 9.09014C12.9298 9.09023 11.3161 9.6242 10.4045 10.5931C9.48252 11.5734 9.09167 13.191 9.09014 15.8759C9.09013 15.8865 9.09013 15.8993 9.09014 15.9099C9.08943 16.3275 8.75097 16.6663 8.33333 16.6667C7.91539 16.6667 7.57512 16.3277 7.57441 15.9099C7.57441 15.8993 7.57441 15.8865 7.57441 15.8759Z'
                fill='white'
              />
              <path
                d='M7.57441 15.8759C7.57287 13.1907 7.18228 11.5734 6.26007 10.5931C5.34838 9.62413 3.73528 9.09014 0.756805 9.09014C0.33862 9.09014 0.000354246 8.75144 0 8.33333C0 7.91493 0.338401 7.57441 0.756805 7.57441C3.73531 7.57441 5.34839 7.04044 6.26007 6.0714C7.18206 5.09108 7.57292 3.47374 7.57441 0.788603C7.57441 0.778162 7.57441 0.767274 7.57441 0.756805C7.57465 0.33857 7.9151 0 8.33333 0C8.75127 0.000354114 9.0899 0.338789 9.09014 0.756805C9.09014 0.767828 9.09014 0.779725 9.09014 0.790723C9.0918 3.47445 9.48295 5.09125 10.4045 6.0714C11.3161 7.04035 12.9298 7.57431 15.9077 7.57441C16.3261 7.57441 16.6667 7.91493 16.6667 8.33333C16.6663 8.75144 16.3259 9.09014 15.9077 9.09014C12.9298 9.09023 11.3161 9.6242 10.4045 10.5931C9.48252 11.5734 9.09167 13.191 9.09014 15.8759C9.09013 15.8865 9.09013 15.8993 9.09014 15.9099C9.08943 16.3275 8.75097 16.6663 8.33333 16.6667C7.91539 16.6667 7.57512 16.3277 7.57441 15.9099C7.57441 15.8993 7.57441 15.8865 7.57441 15.8759Z'
                fill='#FF4E4F'
              />
            </g>
            <defs>
              <filter
                id='filter0_ii_2440_92537'
                x='0'
                y='0'
                width='16.666'
                height='17.4396'
                filterUnits='userSpaceOnUse'
                colorInterpolationFilters='sRGB'
              >
                <feFlood floodOpacity='0' result='BackgroundImageFix' />
                <feBlend mode='normal' in='SourceGraphic' in2='BackgroundImageFix' result='shape' />
                <feColorMatrix
                  in='SourceAlpha'
                  type='matrix'
                  values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
                  result='hardAlpha'
                />
                <feOffset dy='0.386471' />
                <feGaussianBlur stdDeviation='0.378362' />
                <feComposite in2='hardAlpha' operator='arithmetic' k2='-1' k3='1' />
                <feColorMatrix type='matrix' values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.5 0' />
                <feBlend mode='normal' in2='shape' result='effect1_innerShadow_2440_92537' />
                <feColorMatrix
                  in='SourceAlpha'
                  type='matrix'
                  values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
                  result='hardAlpha'
                />
                <feOffset dy='0.772943' />
                <feGaussianBlur stdDeviation='1.26121' />
                <feComposite in2='hardAlpha' operator='arithmetic' k2='-1' k3='1' />
                <feColorMatrix type='matrix' values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.5 0' />
                <feBlend
                  mode='normal'
                  in2='effect1_innerShadow_2440_92537'
                  result='effect2_innerShadow_2440_92537'
                />
              </filter>
            </defs>
          </svg>
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
        <AddPeopleForm channelId={channel.id} />
      </Drawer>
    </div>
  );
};

export default ConversationHeaderMobile;
