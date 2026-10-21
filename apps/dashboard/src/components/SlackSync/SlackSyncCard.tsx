import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Info, Lock } from 'lucide-react';
import { toast } from 'sonner';
import Button from '../ui/Button';
import { Combobox } from '../ui/Combobox/Combobox';
import type { DropdownListItemType } from '../ui/Combobox/Combobox.types';
import { Dialog } from '../ui/Dialog';
import { Popover } from '../ui/Popover';
import {
  useChannelSyncStatus,
  useLinkableSlackChannels,
  useRefreshSlackMirror,
} from '../../hooks/useSlackMirror';
import {
  cancelSyncRequest,
  pauseMirrorLink,
  resumeMirrorLink,
  slackMirrorErrorMessage,
  submitSyncRequest,
  unlinkMirrorLink,
  type ChannelSyncStatus,
  type MirrorLink,
  type SyncRequest,
} from '../../services/clients/slackMirrorApi';
import { appLabel, pausedReasonText } from './SlackSync.utils';

interface SlackSyncCardProps {
  channelId: string;
}

/** The channel settings card: ask for a Slack sync, see where the request stands, manage the link. */
export function SlackSyncCard({ channelId }: SlackSyncCardProps): ReactElement | null {
  const { status, isLoading } = useChannelSyncStatus(channelId);

  // If the gateway can't be reached, the card stays out of the way of the rest of the settings.
  if (!isLoading && !status) return null;

  return (
    <div className='bg-card p-[12px] rounded-[12px] border border-border'>
      <div className='flex items-center justify-between gap-2'>
        <p className='text-sm font-medium text-foreground'>Sync with Slack</p>
        <SyncInstructions appName={status?.appName ?? null} />
      </div>
      <div className='mt-2 flex flex-col gap-2'>
        {!status ? (
          <p className='text-sm text-muted-foreground'>Loading…</p>
        ) : status.link ? (
          <LinkedState channelId={channelId} status={status} link={status.link} />
        ) : status.request?.status === 'PENDING' ? (
          <PendingState channelId={channelId} status={status} request={status.request} />
        ) : (
          <RequestForm channelId={channelId} status={status} />
        )}
      </div>
    </div>
  );
}

/** Runs one change, says how it went, and refreshes the card. */
function useCardAction(channelId: string) {
  const refresh = useRefreshSlackMirror();
  return (action: () => Promise<unknown>, done: string) => async (): Promise<void> => {
    try {
      await action();
      toast.success(done);
      await refresh.channel(channelId);
    } catch (error) {
      toast.error(slackMirrorErrorMessage(error, 'Something went wrong. Try again.'));
    }
  };
}

function LinkedState(props: {
  channelId: string;
  status: ChannelSyncStatus;
  link: MirrorLink;
}): ReactElement {
  const { channelId, status, link } = props;
  const run = useCardAction(channelId);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const slackName = status.externalChannel ? `#${status.externalChannel.name}` : 'a Slack channel';

  return (
    <>
      <p className='text-sm text-muted-foreground'>
        {link.status === 'ACTIVE'
          ? `Synced with ${slackName}.`
          : `Sync with ${slackName} is paused. ${pausedReasonText(link.statusReason)}`}
      </p>
      {status.canManage && (
        <div className='flex gap-2'>
          {link.status === 'ACTIVE' ? (
            <Button
              size='sm'
              variant='outline'
              trackId='slack_sync_pause'
              trackAction={run(() => pauseMirrorLink(link.id), 'Slack sync paused')}
            >
              Pause
            </Button>
          ) : (
            <Button
              size='sm'
              variant='outline'
              trackId='slack_sync_resume'
              trackAction={run(() => resumeMirrorLink(link.id), 'Slack sync resumed')}
            >
              Resume
            </Button>
          )}
          <Button
            size='sm'
            variant='outline'
            trackId='slack_sync_unlink_open'
            onClick={() => setConfirmUnlink(true)}
          >
            Unlink
          </Button>
        </div>
      )}
      <Dialog
        open={confirmUnlink}
        onOpenChange={setConfirmUnlink}
        title='Unlink from Slack?'
        description='Messages and members stop syncing both ways. What was already copied stays.'
      >
        <div className='flex justify-end gap-2'>
          <Button variant='outline' onClick={() => setConfirmUnlink(false)}>
            Cancel
          </Button>
          <Button
            variant='destructive'
            trackId='slack_sync_unlink'
            trackAction={async () => {
              await run(() => unlinkMirrorLink(link.id), 'Unlinked from Slack')();
              setConfirmUnlink(false);
            }}
          >
            Unlink
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function PendingState(props: {
  channelId: string;
  status: ChannelSyncStatus;
  request: SyncRequest;
}): ReactElement {
  const { channelId, status, request } = props;
  const run = useCardAction(channelId);
  return (
    <>
      <p className='text-sm text-muted-foreground'>
        Request to sync with #{request.externalName} submitted · waiting for admin approval.
      </p>
      {status.canRequest && (
        <div>
          <Button
            size='sm'
            variant='outline'
            trackId='slack_sync_request_cancel'
            trackAction={run(() => cancelSyncRequest(request.id), 'Request cancelled')}
          >
            Cancel request
          </Button>
        </div>
      )}
    </>
  );
}

function RequestForm(props: { channelId: string; status: ChannelSyncStatus }): ReactElement {
  const { channelId, status } = props;
  const run = useCardAction(channelId);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<DropdownListItemType | null>(null);
  const { channels, isLoading, isFetching, refresh } = useLinkableSlackChannels(
    channelId,
    open && status.connected && status.canRequest,
  );
  const rejected = status.request?.status === 'REJECTED' ? status.request : null;

  const items = useMemo<DropdownListItemType[]>(() => {
    const term = search.trim().toLowerCase();
    return channels
      .filter(channel => !term || channel.name.toLowerCase().includes(term))
      .map(channel => ({
        label: `#${channel.name}`,
        value: channel.id,
        ...(channel.isPrivate && { rightSlot: <Lock className='size-3 text-muted-foreground' /> }),
      }));
  }, [channels, search]);

  if (!status.canRequest) {
    return (
      <p className='text-sm text-muted-foreground'>
        Not synced with Slack. Only channel admins can request a sync.
      </p>
    );
  }

  return (
    <>
      {rejected && (
        <p className='text-sm text-destructive'>
          Your request to sync with #{rejected.externalName} was rejected: {rejected.reason}
        </p>
      )}
      <div className='flex items-start gap-2'>
        <div className='min-w-0 flex-1'>
          <Combobox
            queryString={selected?.label ?? search}
            onInputValueChange={value => {
              if (value === '' && selected) return;
              setSearch(value);
              if (selected && value !== selected.label) setSelected(null);
            }}
            items={items}
            value={selected}
            onValueChange={value => setSelected(items.find(item => item.value === value) ?? null)}
            open={open}
            onOpenChange={setOpen}
            placeholder={isLoading ? 'Loading Slack channels…' : 'Pick a Slack channel'}
            {...(open &&
              !isLoading &&
              items.length === 0 && {
                hintText: 'No Slack channels to pick yet. See ⓘ, or refresh in a minute.',
              })}
          />
        </div>
        <Button
          size='sm'
          disabled={!selected}
          trackId='slack_sync_request_submit'
          trackAction={async () => {
            if (!selected) return;
            await run(
              () => submitSyncRequest(channelId, selected.value),
              'Request sent. An admin will review it.',
            )();
            setSelected(null);
            setSearch('');
          }}
        >
          Request sync
        </Button>
      </div>
      {status.connected && (
        <p className='text-xs text-muted-foreground'>
          Just added {appLabel(status.appName)} to a Slack channel? It can take a minute to show up.{' '}
          <button
            type='button'
            disabled={isFetching}
            onClick={() => void refresh()}
            className='text-primary underline hover:text-primary/80 cursor-pointer disabled:cursor-wait disabled:opacity-60'
            data-track-category='slack-sync'
            data-track-name='refresh-slack-channels'
          >
            {isFetching ? 'Refreshing…' : 'Refresh list'}
          </button>
        </p>
      )}
    </>
  );
}

function SyncInstructions({ appName }: { appName: string | null }): ReactElement {
  const app = appLabel(appName);
  return (
    <Popover
      trigger={
        <button
          type='button'
          aria-label='How Slack sync works'
          className='text-muted-foreground hover:text-foreground cursor-pointer'
          data-track-category='slack-sync'
          data-track-name='open-instructions'
        >
          <Info className='size-4' />
        </button>
      }
      align='end'
      className='w-72 p-3'
    >
      <div className='flex flex-col gap-2 text-sm'>
        <p className='font-medium text-foreground'>How Slack sync works</p>
        <Muted>
          Only channel admins can request a sync, and an organisation admin approves it. Messages,
          threads, files and members then sync both ways.
        </Muted>
        <ol className='list-decimal space-y-1 pl-4 text-muted-foreground'>
          <li>Join the Slack channel.</li>
          <li>Add {app} to it.</li>
          <li>Pick the channel here and click Request sync.</li>
          <li>You&apos;ll get a notification when it&apos;s approved or rejected.</li>
        </ol>
        <Muted>
          <span className='font-medium text-foreground'>Empty list?</span> Either Slack isn&apos;t
          connected for this workspace, or you and {app} aren&apos;t both in a Slack channel
          that&apos;s free to sync.
        </Muted>
      </div>
    </Popover>
  );
}

const Muted = ({ children }: { children: ReactNode }): ReactElement => (
  <p className='text-muted-foreground'>{children}</p>
);
