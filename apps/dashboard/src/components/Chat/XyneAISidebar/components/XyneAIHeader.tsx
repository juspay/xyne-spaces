import { ReactElement, ReactNode, useState } from 'react';
import {
  ThreeDotsMenuVertical,
  PencilEditBox,
  MultipleCrossCancelDefault,
  ReminderAnticlockwise,
  ClockDefault,
  Activity,
  Settings01,
  InformationCircle,
  Bug,
} from '@xyne/icons';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../../../ui/dropdown-menu';
import { Button } from '../../../ui/Button/Button';
import { xyneAIActor } from '../../../../machines/xyneAIMachine';
import { APP_DRAG_STYLE, APP_NO_DRAG_STYLE } from '../../../../utils/electronApp';
import { SettingsModal } from './SettingsModal';
import { AgentInfoModal } from './AgentInfoModal';
import type { AccessibleClawAgent } from '../../../../services/clawAgentListService';

interface XyneAIHeaderProps {
  onNewChat: () => void;
  onShowHistory: () => void;
  onShowUserActivity: () => void;
  isMobile?: boolean;
  onClose?: () => void;
  title?: string;
  hideMemoriesAndActivity?: boolean;
  hideTitle?: boolean;
  hideHistory?: boolean;
  selectedAgent?: AccessibleClawAgent | null;
  onShowDebugger?: (() => void) | undefined;
  isTight?: boolean;
  hideClose?: boolean;
  dense?: boolean;
}

export const XyneAIHeader = ({
  onNewChat,
  onShowHistory,
  onShowUserActivity,
  isMobile = false,
  onClose,
  title = 'Ask AI',
  hideMemoriesAndActivity = false,
  hideTitle = false,
  hideHistory = false,
  selectedAgent,
  onShowDebugger,
  isTight = false,
  hideClose = false,
  dense = false,
}: XyneAIHeaderProps): ReactElement => {
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isAgentInfoModalOpen, setIsAgentInfoModalOpen] = useState(false);
  const mwebActionPillClass =
    'flex w-8 h-8 justify-center items-center rounded-full border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5] shrink-0';

  const handleClose = (): void => {
    if (onClose) {
      onClose();
    } else {
      xyneAIActor.send({ type: 'CLOSE' });
    }
  };

  // The consolidated overflow menu — every action that used to live as its own
  // header button now renders as a DropdownMenuItem here. Reused by both the
  // desktop and mobile render paths so they stay in sync.
  // `includeHistory` is false on desktop, where chat history has its own header
  // button; mobile has no such button, so it keeps the menu item.
  const showMemoriesAndActivity = !hideMemoriesAndActivity;
  const buildOverflowMenuItems = (includeHistory: boolean): ReactNode => (
    <>
      {selectedAgent && (
        <DropdownMenuItem
          className='gap-2'
          onClick={() => setIsAgentInfoModalOpen(true)}
          data-track-category='XyneAI'
          data-track-name='OpenAgentInfo'
        >
          <InformationCircle size={16} className='shrink-0' />
          <span className='flex-1'>Agent info</span>
        </DropdownMenuItem>
      )}
      {includeHistory && !hideHistory && (
        <DropdownMenuItem
          className='gap-2'
          onClick={onShowHistory}
          data-track-category='XyneAI'
          data-track-name='SHOW_HISTORY'
        >
          <ClockDefault size={16} className='shrink-0' />
          <span className='flex-1'>Chat history</span>
        </DropdownMenuItem>
      )}
      {showMemoriesAndActivity && (
        <DropdownMenuItem
          className='gap-2'
          onClick={onShowUserActivity}
          data-track-category='XyneAI'
          data-track-name='SHOW_USER_ACTIVITY'
        >
          <Activity size={16} className='shrink-0' />
          <span className='flex-1'>Your activity</span>
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className='gap-2'
        onClick={() => setIsSettingsModalOpen(true)}
        data-track-category='XyneAI'
        data-track-name='OpenSettings'
      >
        <Settings01 size={16} className='shrink-0' />
        <span className='flex-1'>Settings</span>
      </DropdownMenuItem>
      {onShowDebugger && (
        <DropdownMenuItem
          className='gap-2'
          onClick={onShowDebugger}
          data-track-category='XyneAI'
          data-track-name='OPEN_DEBUGGER'
        >
          <Bug size={16} className='shrink-0' />
          <span className='flex-1'>Debugger</span>
        </DropdownMenuItem>
      )}
    </>
  );

  if (isMobile) {
    return (
      <>
        <div className='h-14 mt-[14px] px-4 flex items-center justify-between gap-2 self-stretch'>
          {/* Left: Title */}
          <div className='flex min-w-0 items-center gap-2'>
            <div className='truncate text-muted-foreground text-base font-medium'>
              {!hideTitle && (hideMemoriesAndActivity ? title : 'New chat')}
            </div>
          </div>

          {/* Right: overflow menu, new chat, close */}
          <div className='flex items-center gap-2'>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={mwebActionPillClass}
                  title='More'
                  data-track-category='XyneAI'
                  data-track-name='OPEN_HEADER_MENU_MOBILE'
                >
                  <ThreeDotsMenuVertical size={16} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align='end'
                onCloseAutoFocus={e => e.preventDefault()}
                className='min-w-[180px]'
              >
                {buildOverflowMenuItems(true)}
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              onClick={onNewChat}
              className={mwebActionPillClass}
              title='New chat'
              data-track-category='XyneAI'
              data-track-name='NEW_CHAT'
            >
              <PencilEditBox size={16} />
            </button>
            {!hideClose && (
              <button
                onClick={handleClose}
                className={mwebActionPillClass}
                title='Close'
                data-track-category='XyneAI'
                data-track-name='CLOSE_MOBILE'
              >
                <MultipleCrossCancelDefault size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Settings Modal */}
        <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} />

        {/* Agent Info Modal */}
        <AgentInfoModal
          isOpen={isAgentInfoModalOpen}
          onClose={() => setIsAgentInfoModalOpen(false)}
          agent={selectedAgent ?? null}
        />
      </>
    );
  }

  // Same recipe as ConversationHeader's action buttons so the two headers'
  // icons carry identical weight: muted at rest, full strength on hover
  // (see ConversationHeader.tsx).
  const headerButtonClass =
    'h-7 w-7 rounded-lg shrink-0 text-muted-foreground hover:text-foreground';

  return (
    <>
      {/* Padding mirrors ConversationHeader so the two titles line up across
          the panel split (see ConversationHeader.tsx). */}
      <div
        className={`shrink-0 flex items-center justify-between self-stretch border-border pl-2 pr-3 ${
          dense ? 'gap-3 py-2' : 'gap-6 py-3'
        }`}
        style={APP_DRAG_STYLE}
      >
        {/* Left: title */}
        <div className='flex-1 min-w-0 px-1.5 flex items-center gap-2'>
          {!hideTitle && (
            <span
              className={`min-w-0 whitespace-nowrap text-foreground font-semibold font-['Inter'] tracking-[-0.32px] leading-[28px] ${
                isTight ? 'text-sm' : 'text-base'
              }`}
            >
              {title}
            </span>
          )}
        </div>

        {/* Right: new chat, history, overflow menu, close */}
        <div className='flex items-center gap-[4px]' style={APP_NO_DRAG_STYLE}>
          {/* New Chat */}
          <Button
            variant='ghost'
            size='sm'
            onClick={onNewChat}
            className={headerButtonClass}
            title='New chat'
            data-track-category='XyneAI'
            data-track-name='NEW_CHAT_DESKTOP'
          >
            <PencilEditBox size={16} />
          </Button>
          {/* Chat history */}
          {!hideHistory && (
            <Button
              variant='ghost'
              size='sm'
              onClick={onShowHistory}
              className={headerButtonClass}
              title='Chat history'
              data-track-category='XyneAI'
              data-track-name='SHOW_HISTORY'
            >
              <ReminderAnticlockwise size={16} />
            </Button>
          )}
          {/* Overflow menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                size='sm'
                className={headerButtonClass}
                title='More'
                data-track-category='XyneAI'
                data-track-name='OPEN_HEADER_MENU_DESKTOP'
              >
                <ThreeDotsMenuVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='end'
              onCloseAutoFocus={e => e.preventDefault()}
              className='min-w-[180px]'
            >
              {buildOverflowMenuItems(false)}
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Close */}
          {!hideClose && (
            <Button
              variant='ghost'
              size='sm'
              onClick={handleClose}
              className={headerButtonClass}
              title='Close'
              data-track-category='XyneAI'
              data-track-name='CLOSE_DESKTOP'
            >
              <MultipleCrossCancelDefault size={16} />
            </Button>
          )}
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} />

      {/* Agent Info Modal */}
      <AgentInfoModal
        isOpen={isAgentInfoModalOpen}
        onClose={() => setIsAgentInfoModalOpen(false)}
        agent={selectedAgent ?? null}
      />
    </>
  );
};
