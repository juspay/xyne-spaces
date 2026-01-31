import { ReactElement } from 'react';
import { xyneAIActor } from '../../../../machines/xyneAIMachine';

interface XyneAIHeaderProps {
  onNewChat: () => void;
  onShowHistory: () => void;
}

export const XyneAIHeader = ({ onNewChat, onShowHistory }: XyneAIHeaderProps): ReactElement => {
  const handleClose = (): void => {
    // Send close event to xstate machine
    xyneAIActor.send({ type: 'CLOSE' });
  };

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
          <img src='/svgs/icons/chat-history.svg' alt='Chat history' width='16' height='16' />
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
