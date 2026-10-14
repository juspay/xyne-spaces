import { useAuth } from '@/src/contexts/AuthContext';
import { useQuery } from '@/src/hooks/useQuery';
import { useRingReconcile } from '@/src/notifications/calls/useRingReconcile';
import { queries } from '@/src/zero/queries';

/**
 * Incoming calls ring natively (CallKit on iOS, the full-screen call notification on Android),
 * even with the app open — there is no in-app ringing screen. This keeps that native ring honest:
 * it ends it as soon as Zero says the call is over (answered on another device, declined,
 * cancelled by the caller), even if the dismiss push never arrives. Renders nothing.
 */
export function IncomingCallSync(): null {
  const { user } = useAuth();
  const [activeCalls, activeCallsDetails] = useQuery(queries.userActiveCalls());
  useRingReconcile({
    activeCalls,
    activeCallsComplete: activeCallsDetails.type === 'complete',
    userId: user?.user_id,
  });
  return null;
}
