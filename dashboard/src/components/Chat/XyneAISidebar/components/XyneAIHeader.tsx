import { ReactElement, useState } from 'react';
import { Settings, Activity, Brain, SquarePen, X } from 'lucide-react';
import { xyneAIActor } from '../../../../machines/xyneAIMachine';
import { ChatHistory } from '../../../icons/xyne-ai';
import { SettingsModal } from './SettingsModal';

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
}: XyneAIHeaderProps): ReactElement => {
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const mobileActionButtonClass =
    'flex p-4 justify-center items-center gap-2 rounded-full border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-accent aspect-square';

  const handleClose = (): void => {
    if (onClose) {
      onClose();
    } else {
      xyneAIActor.send({ type: 'CLOSE' });
    }
  };

  if (isMobile) {
    return (
      <>
        <div className='h-14 mt-[14px] px-4 flex items-center justify-between gap-2 self-stretch'>
          {/* Left: New Chat Icon + Title */}
          <div className='flex items-center gap-2'>
            <button
              onClick={onNewChat}
              className={mobileActionButtonClass}
              title='New chat'
              data-track-category='XyneAI'
              data-track-name='NEW_CHAT'
            >
              <SquarePen size={16} className='w-4 h-4 text-current' />
            </button>
            <div className='text-muted-foreground text-base font-medium'>
              {!hideTitle && (hideMemoriesAndActivity ? title : 'New chat')}
            </div>
          </div>

          {/* Right: Settings, User Activity, Chat History, and Close Icons */}
          <div className='flex items-center gap-2'>
            <button
              onClick={() => setIsSettingsModalOpen(true)}
              className={mobileActionButtonClass}
              title='Custom instructions'
              data-track-category='XYNE_AI'
              data-track-name='OpenCustomInstructions'
            >
              <Settings size={16} className='w-4 h-4' />
            </button>
            {!hideMemoriesAndActivity && (
              <button
                onClick={onShowMemories}
                className={mobileActionButtonClass}
                title='Memories'
                data-track-category='XyneAI'
                data-track-name='SHOW_MEMORIES_MOBILE'
              >
                <Brain size={16} className='w-4 h-4' />
              </button>
            )}
            {!hideMemoriesAndActivity && (
              <button
                onClick={onShowUserActivity}
                className={mobileActionButtonClass}
                title='Your activity'
                data-track-category='XyneAI'
                data-track-name='SHOW_USER_ACTIVITY_MOBILE'
              >
                <Activity size={16} className='w-4 h-4' />
              </button>
            )}
            {!hideHistory && (
              <button
                onClick={onShowHistory}
                className={mobileActionButtonClass}
                title='Chat history'
                data-track-category='XyneAI'
                data-track-name='SHOW_HISTORY_MOBILE'
              >
                <ChatHistory color='currentColor' />
              </button>
            )}
            <button
              onClick={handleClose}
              className={mobileActionButtonClass}
              title='Close'
              data-track-category='XyneAI'
              data-track-name='CLOSE_MOBILE'
            >
              <X size={16} className='w-4 h-4 text-current' />
            </button>
          </div>
        </div>

        {/* Settings Modal */}
        <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} />
      </>
    );
  }

  return (
    <>
      <div className='h-14 p-4 flex items-center justify-between gap-2 self-stretch border-border'>
        <div className="text-foreground text-base font-semibold font-['Inter']">
          {!hideTitle && title}
        </div>
        <div className='flex items-center gap-2'>
          {/* New Chat Icon */}
          <button
            onClick={onNewChat}
            className='p-2 rounded-lg border border-border flex justify-center items-center gap-2.5 overflow-hidden hover:bg-accent transition-colors text-foreground'
            title='New chat'
            data-track-category='XyneAI'
            data-track-name='NEW_CHAT_DESKTOP'
          >
            <SquarePen size={16} className='text-current' />
          </button>
          {/* Chat History Icon */}
          {!hideHistory && (
            <button
              onClick={onShowHistory}
              className='p-2 rounded-lg border border-border flex justify-center items-center gap-2.5 overflow-hidden hover:bg-accent transition-colors text-foreground'
              title='Chat history'
              data-track-category='XyneAI'
              data-track-name='SHOW_HISTORY_DESKTOP'
            >
              <ChatHistory color='currentColor' />
            </button>
          )}
          {/* Memories Icon */}
          {!hideMemoriesAndActivity && (
            <button
              onClick={onShowMemories}
              className='p-2 rounded-lg border border-border flex justify-center items-center gap-2.5 overflow-hidden hover:bg-accent transition-colors'
              title='Memories'
              data-track-category='XyneAI'
              data-track-name='SHOW_MEMORIES_DESKTOP'
            >
              <Brain size={16} />
            </button>
          )}
          {/* User Activity Icon */}
          {!hideMemoriesAndActivity && (
            <button
              onClick={onShowUserActivity}
              className='p-2 rounded-lg border border-border flex justify-center items-center gap-2.5 overflow-hidden hover:bg-accent transition-colors text-foreground'
              title='Your activity'
              data-track-category='XyneAI'
              data-track-name='SHOW_USER_ACTIVITY_DESKTOP'
            >
              <Activity size={16} />
            </button>
          )}
          {/* Settings Icon */}
          <button
            onClick={() => setIsSettingsModalOpen(true)}
            className='p-2 rounded-lg border border-border flex justify-center items-center gap-2.5 overflow-hidden hover:bg-accent transition-colors text-foreground'
            title='Settings'
            data-track-category='XYNE_AI'
            data-track-name='OpenSettings'
          >
            <Settings size={16} />
          </button>
          {/* Close Icon */}
          <button
            onClick={handleClose}
            className='p-2 rounded-lg border border-border flex justify-center items-center gap-2.5 overflow-hidden hover:bg-accent transition-colors text-foreground'
            data-track-category='XyneAI'
            data-track-name='CLOSE_DESKTOP'
          >
            <X size={16} className='text-current' />
          </button>
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} />
    </>
  );
};
