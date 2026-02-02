import { ReactElement } from 'react';
import { xyneAIActor } from '../../../../machines/xyneAIMachine';
import { ChatHistory } from '../../../icons/xyne-ai';

interface XyneAIHeaderProps {
  onNewChat: () => void;
  onShowHistory: () => void;
  isMobile?: boolean;
}

export const XyneAIHeader = ({
  onNewChat,
  onShowHistory,
  isMobile = false,
}: XyneAIHeaderProps): ReactElement => {
  const handleClose = (): void => {
    // Send close event to xstate machine
    xyneAIActor.send({ type: 'CLOSE' });
  };

  if (isMobile) {
    return (
      <div className='h-14 mt-[14px] px-4 flex items-center justify-between gap-2 self-stretch'>
        {/* Left: New Chat Icon + Title */}
        <div className='flex items-center gap-2'>
          <button
            onClick={onNewChat}
            className='flex p-4 justify-center items-center gap-2 rounded-full border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5] aspect-square'
            title='New chat'
          >
            <img
              src='/svgs/icons/new-chat.svg'
              alt='New chat'
              width='16'
              height='16'
              className='w-4 h-4'
            />
          </button>
          <div className='text-gray-500 text-base font-medium'>New chat</div>
        </div>

        {/* Right: Chat History Icon + Close Icon */}
        <div className='flex items-center gap-2'>
          <button
            onClick={onShowHistory}
            className='flex p-4 justify-center items-center gap-2 rounded-full border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5] aspect-square'
            title='Chat history'
          >
            <ChatHistory />
          </button>
          <button
            onClick={handleClose}
            className='flex p-4 justify-center items-center gap-2 rounded-full border border-[#FFF] bg-[linear-gradient(180deg,_#FFF_0%,_#FAFAFA_100%)] shadow-[inset_0_4px_6px_0_#F5F5F5,0_0_12px_0_#E5E5E5] aspect-square'
            title='Close'
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
    );
  }

  return (
    <div className='h-14 p-4 flex items-center justify-between gap-2 self-stretch border-gray-200'>
      <div className="text-gray-900 text-base font-semibold font-['Inter']">Ask AI</div>
      <div className='flex items-center gap-2'>
        {/* New Chat Icon */}
        <button
          onClick={onNewChat}
          className='p-2 rounded-lg outline outline-1 outline-offset-[-1px] outline-gray-300 flex justify-center items-center gap-2.5 overflow-hidden hover:bg-gray-100 transition-colors'
          title='New chat'
        >
          <img src='/svgs/icons/new-chat.svg' alt='New chat' width='16' height='16' />
        </button>
        {/* Chat History Icon */}
        <button
          onClick={onShowHistory}
          className='p-2 rounded-lg outline outline-1 outline-offset-[-1px] outline-gray-300 flex justify-center items-center gap-2.5 overflow-hidden hover:bg-gray-100 transition-colors'
          title='Chat history'
        >
          <ChatHistory />
        </button>
        {/* Close Icon */}
        <button
          onClick={handleClose}
          className='p-2 rounded-lg outline outline-1 outline-offset-[-1px] outline-gray-300 flex justify-center items-center gap-2.5 overflow-hidden hover:bg-gray-100 transition-colors'
        >
          <img src='/svgs/icons/close.svg' alt='Close' width='16' height='16' />
        </button>
      </div>
    </div>
  );
};
