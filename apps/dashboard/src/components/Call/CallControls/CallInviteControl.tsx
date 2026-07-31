import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Share2 } from 'lucide-react';
import { callLobbyService } from '../../../services/Call/callLobbyService';
import { cn } from '../../../utils/classNames';

interface CallInviteControlProps {
  callId: string;
  isExternalUser: boolean;
  buttonClasses: string;
  hasCustomSizing: boolean;
  buttonPadding: number;
  iconSize: number;
}

function CopiedBadge(): ReactElement {
  return (
    <span className='absolute -top-8 sm:-top-10 left-1/2 transform -translate-x-1/2 bg-green-500 text-white text-xs sm:text-sm px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg shadow-lg whitespace-nowrap'>
      Copied!
    </span>
  );
}

export function CallInviteControl({
  callId,
  isExternalUser,
  buttonClasses,
  hasCustomSizing,
  buttonPadding,
  iconSize,
}: CallInviteControlProps): ReactElement {
  const [showCopied, setShowCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const inviteUrlQuery = useQuery({
    queryKey: ['call-invite-url', callId],
    queryFn: () => callLobbyService.getInviteUrl(callId),
    staleTime: Infinity,
    enabled: !!callId,
  });

  useEffect(() => {
    return (): void => clearTimeout(copiedTimerRef.current);
  }, []);

  const copyLink = (url: string | undefined): void => {
    if (!url) return;

    void navigator.clipboard.writeText(url).then(() => {
      setShowCopied(true);
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setShowCopied(false), 2000);
    });
  };

  const customPadding = hasCustomSizing ? { padding: `${buttonPadding}px` } : undefined;
  const iconClassName = hasCustomSizing ? '' : 'w-5 h-5 sm:w-6 sm:h-6';
  const iconStyle = hasCustomSizing
    ? { width: `${iconSize}px`, height: `${iconSize}px` }
    : undefined;
  const inviteUrl = inviteUrlQuery.data;
  const buttonLabel = isExternalUser ? 'Copy call link' : 'Copy invite link';

  return (
    <button
      onClick={() => copyLink(inviteUrl)}
      disabled={!inviteUrl}
      className={cn(
        buttonClasses,
        'relative bg-gray-700 text-white',
        inviteUrl ? 'hover:bg-gray-600' : 'opacity-50 cursor-not-allowed hover:scale-100',
      )}
      style={customPadding}
      title={
        inviteUrl
          ? buttonLabel
          : inviteUrlQuery.isError
            ? 'Invite link unavailable'
            : 'Loading invite link'
      }
      aria-label={buttonLabel}
      data-track-category='CALLS'
      data-track-name='SHARE_CALL_LINK'
      data-track-metadata={JSON.stringify({ callId })}
    >
      <Share2 className={iconClassName} style={iconStyle} />
      {showCopied && <CopiedBadge />}
    </button>
  );
}
