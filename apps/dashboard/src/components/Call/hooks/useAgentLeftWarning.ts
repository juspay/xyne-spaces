import { useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { roomActor } from '../../../machines/roomMachine';

export function useAgentLeftWarning(transcriptionAgentLeft: boolean): void {
  const dismiss = useCallback(() => {
    roomActor.send({ type: 'DISMISS_AGENT_LEFT_WARNING' });
  }, []);

  useEffect(() => {
    if (!transcriptionAgentLeft) return;

    toast.warning('Transcription stopped', {
      id: 'agent-left-warning',
      description:
        "Xyne Automatic has left the call, so anything said from here on won't be transcribed.",
      duration: Infinity,
      closeButton: true,
      onDismiss: dismiss,
      action: {
        label: 'Dismiss',
        onClick: dismiss,
      },
    });
  }, [transcriptionAgentLeft, dismiss]);
}
