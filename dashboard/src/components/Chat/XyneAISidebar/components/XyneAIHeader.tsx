import { ReactElement, useState } from 'react';
import { Settings, Activity, Brain } from 'lucide-react';
import { xyneAIActor } from '../../../../machines/xyneAIMachine';
import { ChatHistory } from '../../../icons/xyne-ai';
import { SettingsModal } from './SettingsModal';

interface XyneAIHeaderProps {
  onNewChat: () => void;
  onShowHistory: () => void;
  onShowUserActivity: () => void;
  onShowMemories: () => void;
  isMobile?: boolean;
}

export const XyneAIHeader = ({
  onNewChat,
  onShowHistory,
  onShowUserActivity,
  onShowMemories,
  isMobile = false,
}: XyneAIHeaderProps): ReactElement => {
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  const handleClose = (): void => {
    // Send close event to xstate machine
    xyneAIActor.send({ type: 'CLOSE' });
  };

  if (isMobile) {
    return (
      <>
        <div className='h-14 mt-[14px] px-4 flex items-center justify-between gap-2 self-stretch'>
          {/* Left: New Chat Icon + Title */}
          <div className='flex items-center gap-2'>
            <button
              onClick={onNewChat}
              className='flex p-4 justify-center items-center gap-2 rounded-full border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5] aspect-square'
              title='New chat'
              data-track-category='XyneAI'
              data-track-name='NEW_CHAT'
            >
              <img
                src='/svgs/icons/new-chat.svg'
                alt='New chat'
                width='16'
                height='16'
                className='w-4 h-4'
              />
            </button>
            <div className='text-muted-foreground text-base font-medium'>New chat</div>
          </div>

          {/* Right: Settings, User Activity, Chat History, and Close Icons */}
          <div className='flex items-center gap-2'>
            <button
              onClick={() => setIsSettingsModalOpen(true)}
              className='flex p-4 justify-center items-center gap-2 rounded-full border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5] aspect-square'
              title='Custom instructions'
              data-track-category='XYNE_AI'
              data-track-name='OpenCustomInstructions'
            >
              <Settings size={16} className='w-4 h-4' />
            </button>
            <button
              onClick={onShowMemories}
              className='flex p-4 justify-center items-center gap-2 rounded-full border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5] aspect-square'
              title='Memories'
              data-track-category='XyneAI'
              data-track-name='SHOW_MEMORIES_MOBILE'
            >
              <Brain size={16} className='w-4 h-4' />
            </button>
            <button
              onClick={onShowUserActivity}
              className='flex p-4 justify-center items-center gap-2 rounded-full border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5] aspect-square'
              title='Your activity'
              data-track-category='XyneAI'
              data-track-name='SHOW_USER_ACTIVITY_MOBILE'
            >
              <Activity size={16} className='w-4 h-4' />
            </button>
            <button
              onClick={onShowHistory}
              className='flex p-4 justify-center items-center gap-2 rounded-full border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5] aspect-square'
              title='Chat history'
              data-track-category='XyneAI'
              data-track-name='SHOW_HISTORY_MOBILE'
            >
              <ChatHistory />
            </button>
            <button
              onClick={handleClose}
              className='flex p-4 justify-center items-center gap-2 rounded-full border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5] aspect-square'
              title='Close'
              data-track-category='XyneAI'
              data-track-name='CLOSE_MOBILE'
            >
              <img
                src='/svgs/icons/close.svg'
                alt='Close'
                width='16'
                height='16'
                className='w-4 h-4'
              />
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
        <div className="text-foreground text-base font-semibold font-['Inter']">Ask AI</div>
        <div className='flex items-center gap-2'>
          {/* New Chat Icon */}
          <button
            onClick={onNewChat}
            className='p-2 rounded-lg outline outline-1 outline-offset-[-1px] outline-input flex justify-center items-center gap-2.5 overflow-hidden hover:bg-accent transition-colors'
            title='New chat'
            data-track-category='XyneAI'
            data-track-name='NEW_CHAT_DESKTOP'
          >
            <img src='/svgs/icons/new-chat.svg' alt='New chat' width='16' height='16' />
          </button>
          {/* Chat History Icon */}
          <button
            onClick={onShowHistory}
            className='p-2 rounded-lg outline outline-1 outline-offset-[-1px] outline-input flex justify-center items-center gap-2.5 overflow-hidden hover:bg-accent transition-colors'
            title='Chat history'
            data-track-category='XyneAI'
            data-track-name='SHOW_HISTORY_DESKTOP'
          >
            <ChatHistory />
          </button>
          {/* Memories Icon */}
          <button
            onClick={onShowMemories}
            className='p-2 rounded-lg outline outline-1 outline-offset-[-1px] outline-input flex justify-center items-center gap-2.5 overflow-hidden hover:bg-accent transition-colors'
            title='Memories'
            data-track-category='XyneAI'
            data-track-name='SHOW_MEMORIES_DESKTOP'
          >
            <Brain size={16} />
          </button>
          {/* User Activity Icon */}
          <button
            onClick={onShowUserActivity}
            className='p-2 rounded-lg outline outline-1 outline-offset-[-1px] outline-input flex justify-center items-center gap-2.5 overflow-hidden hover:bg-accent transition-colors'
            title='Your activity'
            data-track-category='XyneAI'
            data-track-name='SHOW_USER_ACTIVITY_DESKTOP'
          >
            <Activity size={16} />
          </button>
          {/* Settings Icon */}
          <button
            onClick={() => setIsSettingsModalOpen(true)}
            className='p-2 rounded-lg outline outline-1 outline-offset-[-1px] outline-input flex justify-center items-center gap-2.5 overflow-hidden hover:bg-accent transition-colors'
            title='Settings'
            data-track-category='XYNE_AI'
            data-track-name='OpenSettings'
          >
            <Settings size={16} />
          </button>
          {/* Close Icon */}
          <button
            onClick={handleClose}
            className='p-2 rounded-lg outline outline-1 outline-offset-[-1px] outline-input flex justify-center items-center gap-2.5 overflow-hidden hover:bg-accent transition-colors'
            data-track-category='XyneAI'
            data-track-name='CLOSE_DESKTOP'
          >
            <img src='/svgs/icons/close.svg' alt='Close' width='16' height='16' />
          </button>
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} />
    </>
  );
};
