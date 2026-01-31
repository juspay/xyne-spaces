import { ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import { useLoadingAnimationLog } from '../../../hooks/useLoadingAnimationLog';
import { Event } from '../../../utils/logger';

/**
 * ChatRedirect component shows a loading state while the user is being
 * redirected to a channel. The actual redirect logic is handled in ChatDirectory.
 */
const ChatRedirect = (): ReactElement => {
  const location = useLocation();

  useLoadingAnimationLog({
    event: Event.LOADING_ANIMATION_HIDDEN,
    source: 'ChatRedirect: channel navigation',
    message: 'Loading...',
    url: location.pathname,
  });

  return (
    <div className='flex flex-col items-center justify-center h-full touch-action-none'>
      <img src={'/images/empty-chats.png'} alt='Loading chat' width={400} height={500} />
      <p className='text-gray-800 select-none'>Loading...</p>
    </div>
  );
};

ChatRedirect.displayName = 'ChatRedirect';

export default ChatRedirect;
