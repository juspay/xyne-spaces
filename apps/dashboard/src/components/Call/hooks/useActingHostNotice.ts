import { useEffect, useRef } from 'react';
import { useSelector } from '@xstate/react';
import { toast } from 'sonner';
import { roomActor } from '../../../machines/roomMachine';

type ActingHostStatus = 'acting' | 'host-present' | 'none';

/**
 * Local-only toast when I gain or lose acting-host status. "Host is back" shows only
 * while I'm still in the room — leaving the call just dismisses.
 */
export function useActingHostNotice(): void {
  const status = useSelector(roomActor, ({ context }): ActingHostStatus => {
    const me = context.room?.localParticipant.identity;
    if (!me) return 'none';
    if (context.actingHostId === me) return 'acting';
    return context.actingHostId === null ? 'host-present' : 'none';
  });
  const prevStatus = useRef(status);

  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = status;
    if (was === status) return;

    if (status === 'acting') {
      toast.info("You're standing in as host", {
        id: 'acting-host-notice',
        description:
          "The host isn't in this call — you have host controls (mute, remove, transcription, end call) until they join.",
        duration: 7000,
        closeButton: true,
      });
      return;
    }
    if (was !== 'acting') return;

    toast.dismiss('acting-host-notice');
    if (status === 'host-present') {
      toast.info('The host is back', {
        id: 'acting-host-returned',
        description: 'Host controls are theirs again.',
        duration: 6000,
        closeButton: true,
      });
    }
  }, [status]);
}
