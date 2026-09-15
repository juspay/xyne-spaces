import { useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { joinCallSwitchingIfNeeded } from '../../machines/roomMachine';
import { useZero } from '../../hooks/useZero';
import { usePlatform } from '../../hooks/usePlatform';
/**
 * CallPage handles deep-linked call URLs (/call/:callId)
 *
 * This component exists solely to support external call links (shared via email, Slack, etc.)
 * It triggers the JOIN_CALL event and immediately redirects to home.
 * The actual call UI is rendered by GlobalCallOverlay.
 * Backend API automatically handles both regular and scheduled calls.
 */
export default function CallPage(): null {
  const { callId } = useParams<{ callId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const zero = useZero();
  const { isMobile } = usePlatform();
  const joinAttempted = useRef(false);

  useEffect(() => {
    if (callId && !joinAttempted.current) {
      joinAttempted.current = true;

      // Set when App.tsx sent a detached window here: the invite URL that was
      // clicked, so a call belonging to another workspace can fall back to the
      // lobby it was shared from rather than a "failed to join" toast.
      const callInviteUrl = (location.state as { callInviteUrl?: string } | null)?.callInviteUrl;

      // Send JOIN_CALL event - backend API handles both regular and scheduled calls
      joinCallSwitchingIfNeeded({
        type: 'JOIN_CALL',
        callId,
        zero,
        viewMode: isMobile ? 'full' : 'mini',
        ...(callInviteUrl && { externalLobbyUrl: callInviteUrl }),
      });

      // Redirect to home - GlobalCallOverlay will render the call UI
      void navigate('/', { replace: true });
    } else if (!callId) {
      // Invalid call link - redirect to home
      void navigate('/', { replace: true });
    }
  }, [callId, searchParams, zero, navigate, location.state]);

  // No UI needed - GlobalCallOverlay handles all loading/error states
  return null;
}
