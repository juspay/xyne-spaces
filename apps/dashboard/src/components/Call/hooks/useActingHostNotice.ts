import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

/**
 * Local-only toast when I gain or lose temporary acting-host status (every host-only
 * action, not just transcription). Only for the participant whose status changed —
 * others see it in the UI copy (host badges, "only X can…" notes).
 */
export function useActingHostNotice(isActingHost: boolean, hostName: string | null): void {
  const prevIsActingHost = useRef(isActingHost);

  useEffect(() => {
    const was = prevIsActingHost.current;
    prevIsActingHost.current = isActingHost;
    if (was === isActingHost) return;

    if (isActingHost) {
      toast.info("You're standing in as host", {
        id: 'acting-host-notice',
        description:
          "The host isn't in this call — you have host controls (mute, remove, transcription, end call) until they join.",
        duration: 7000,
        closeButton: true,
      });
    } else {
      toast.dismiss('acting-host-notice');
      toast.info('The host is back', {
        id: 'acting-host-returned',
        description: `${hostName ?? 'The host'} rejoined — host controls are theirs again.`,
        duration: 6000,
        closeButton: true,
      });
    }
  }, [isActingHost, hostName]);
}
