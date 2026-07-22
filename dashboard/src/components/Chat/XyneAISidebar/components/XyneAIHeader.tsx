import { ReactElement, ReactNode, useState } from 'react';
import { Brain } from 'lucide-react';
import {
  ThreeDotsMenuVertical,
  PencilEditBox,
  MultipleCrossCancelDefault,
  ChevronDown,
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
import { xyneAIActor } from '../../../../machines/xyneAIMachine';
import { SettingsModal } from './SettingsModal';
import { AgentInfoModal } from './AgentInfoModal';
import type { AccessibleClawAgent } from '../../../../services/clawAgentListService';

interface XyneAIHeaderProps {
  onNewChat: () => void;
  onShowHistory: () => void;
  onShowUserActivity: () => void;
  onShowMemories: () => void;
  isMobile?: boolean;
  onClose?: () => void;
  title?: string;
  hideMemoriesAndActivity?: boolean;
  hideTitle?: boolean;
  hideHistory?: boolean;
  selectedAgent?: AccessibleClawAgent | null;
  onShowDebugger?: (() => void) | undefined;
  isCompact?: boolean;
  isTight?: boolean;
}

export const XyneAIHeader = ({
  onNewChat,
  onShowHistory,
  onShowUserActivity,
  onShowMemories,
  isMobile = false,
  onClose,
  title = 'Ask AI',
  hideMemoriesAndActivity = false,
  hideTitle = false,
  hideHistory = false,
  selectedAgent,
  onShowDebugger,
  isCompact = false,
  isTight = false,
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
  const showMemoriesAndActivity = !hideMemoriesAndActivity && !isCompact;
  const overflowMenuItems: ReactNode = (
    <>
      {selectedAgent && (
        <DropdownMenuItem
          className='gap-2'
          onClick={() => setIsAgentInfoModalOpen(true)}
          data-track-category='XYNE_AI'
          data-track-name='OpenAgentInfo'
        >
          <InformationCircle size={16} className='shrink-0' />
          <span className='flex-1'>Agent info</span>
        </DropdownMenuItem>
      )}
      {!hideHistory && (
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
          onClick={onShowMemories}
          data-track-category='XyneAI'
          data-track-name='SHOW_MEMORIES'
        >
          <Brain size={16} className='shrink-0' />
          <span className='flex-1'>Memories</span>
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
        data-track-category='XYNE_AI'
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
                {overflowMenuItems}
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
            <button
              onClick={handleClose}
              className={mwebActionPillClass}
              title='Close'
              data-track-category='XyneAI'
              data-track-name='CLOSE_MOBILE'
            >
              <MultipleCrossCancelDefault size={16} />
            </button>
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

  const headerButtonClass =
    'flex items-center justify-center p-[8px] rounded-[8px] size-[28px] hover:bg-accent transition-colors text-foreground shrink-0';

  return (
    <>
      <div className='min-h-14 py-3 pr-3 flex items-center gap-[4px] self-stretch border-border'>
        {/* Left: title + chevron */}
        <div className='flex-1 min-w-0 px-[12px] flex items-center gap-[6px]'>
          {!hideTitle && (
            <>
              <span
                className={`min-w-0 whitespace-nowrap text-foreground font-bold font-['Inter'] tracking-[-0.32px] leading-[28px] ${
                  isTight ? 'text-sm' : 'text-base'
                }`}
              >
                {title}
              </span>
              <ChevronDown size={16} className='shrink-0 opacity-60' />
            </>
          )}
        </div>

        {/* Right: overflow menu, new chat, close */}
        <div className='flex items-center gap-[4px]'>
          {/* Overflow menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={headerButtonClass}
                title='More'
                data-track-category='XyneAI'
                data-track-name='OPEN_HEADER_MENU_DESKTOP'
              >
                <ThreeDotsMenuVertical size={16} className='opacity-60' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='end'
              onCloseAutoFocus={e => e.preventDefault()}
              className='min-w-[180px]'
            >
              {overflowMenuItems}
            </DropdownMenuContent>
          </DropdownMenu>
          {/* New Chat */}
          <button
            onClick={onNewChat}
            className={headerButtonClass}
            title='New chat'
            data-track-category='XyneAI'
            data-track-name='NEW_CHAT_DESKTOP'
          >
            <PencilEditBox size={16} className='opacity-60' />
          </button>
          {/* Close */}
          <button
            onClick={handleClose}
            className={headerButtonClass}
            title='Close'
            data-track-category='XyneAI'
            data-track-name='CLOSE_DESKTOP'
          >
            <MultipleCrossCancelDefault size={16} className='opacity-60' />
          </button>
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
