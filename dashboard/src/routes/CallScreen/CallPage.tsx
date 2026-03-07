import { useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { roomActor } from '../../machines/roomMachine';
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
  const zero = useZero();
  const { isMobile } = usePlatform();
  const joinAttempted = useRef(false);

  useEffect(() => {
    if (callId && !joinAttempted.current) {
      joinAttempted.current = true;

      // Send JOIN_CALL event - backend API handles both regular and scheduled calls
      roomActor.send({ type: 'JOIN_CALL', callId, zero, viewMode: isMobile ? 'full' : 'mini' });

      // Redirect to home - GlobalCallOverlay will render the call UI
      void navigate('/', { replace: true });
    } else if (!callId) {
      // Invalid call link - redirect to home
      void navigate('/', { replace: true });
    }
  }, [callId, searchParams, zero, navigate]);

  // No UI needed - GlobalCallOverlay handles all loading/error states
  return null;
}
