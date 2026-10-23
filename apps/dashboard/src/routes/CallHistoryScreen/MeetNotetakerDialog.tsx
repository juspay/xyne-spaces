import { useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Input } from '../../components/ui/Input';
import {
  getMeetNotetakerAvailability,
  meetNotetakerErrorMessage,
  sendMeetNotetaker,
  stopMeetNotetaker,
} from '../../services/clients/meetNotetakerApi';
import { looksLikeMeetLink } from '../../utils/meetNotetaker';

/** Whether the Meet notetaker bot is configured; the entry points hide when it isn't. */
export function useMeetNotetakerEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ['meet-notetaker-availability'],
    queryFn: getMeetNotetakerAvailability,
    staleTime: 10 * 60_000,
    retry: false,
  });
  return !!data;
}

/**
 * "Add Xyne Automatic to a Google Meet": paste a link, the bot joins and the call shows
 * up in the Calls lists with its progress. Opened from the Calls page's start-a-call
 * options.
 */
export function MeetNotetakerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const navigate = useNavigate();
  const [meetingUrl, setMeetingUrl] = useState('');
  const [sending, setSending] = useState(false);
  const isValid = looksLikeMeetLink(meetingUrl);

  const stop = async (callExternalId: string): Promise<void> => {
    try {
      await stopMeetNotetaker(callExternalId);
      toast.success('Xyne Automatic is leaving the meeting');
    } catch (error) {
      toast.error(meetNotetakerErrorMessage(error, "Couldn't stop Xyne Automatic"));
    }
  };

  const send = async (): Promise<void> => {
    try {
      const { call, alreadySentBy } = await sendMeetNotetaker(meetingUrl.trim());
      setMeetingUrl('');
      onOpenChange(false);
      const view = {
        label: 'View call',
        onClick: () => void navigate(`/calls/${call.externalId}/detail`),
      };
      if (!alreadySentBy) {
        // Only whoever sent the bot can stop it.
        toast.success('Xyne Automatic is joining the meeting', {
          action: { label: 'Stop', onClick: () => void stop(call.externalId) },
        });
      } else if (alreadySentBy.isYou) {
        toast.info('Xyne Automatic is already on its way to this meeting', { action: view });
      } else {
        toast.info(
          `Xyne Automatic is already in this meeting, added by ${alreadySentBy.name ?? 'a teammate'}. You'll get the notes too.`,
          { action: view },
        );
      }
    } catch (error) {
      toast.error(meetNotetakerErrorMessage(error, "Couldn't send Xyne Automatic"));
    }
  };

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (!isValid || sending) return;
    setSending(true);
    void send().finally(() => setSending(false));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Add Xyne Automatic to a Google Meet'
      description='Xyne Automatic joins the meeting and takes notes. The transcript and summary show up in Calls.'
      className='rounded-xl sm:max-w-md'
    >
      <form onSubmit={onSubmit} className='flex flex-col gap-3'>
        <Input
          autoFocus
          variant='flat'
          value={meetingUrl}
          onChange={event => setMeetingUrl(event.target.value)}
          placeholder='https://meet.google.com/abc-defg-hij'
          aria-label='Google Meet link'
        />
        <div className='flex justify-end gap-2'>
          <Button type='button' variant='ghost' size='sm' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type='submit'
            size='sm'
            disabled={!isValid}
            loading={sending}
            trackId='send_meet_notetaker'
            data-track-category='CALLS'
            data-track-name='send_meet_notetaker'
          >
            Send Xyne Automatic
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
