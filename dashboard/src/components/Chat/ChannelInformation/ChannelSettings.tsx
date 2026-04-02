import React, { useEffect, useMemo, useState } from 'react';
import { Select } from '@base-ui/react/select';
import { Check, ChevronDown, Hash, Archive, ArchiveRestore } from 'lucide-react';
import { toast } from 'sonner';
import { ChannelAddUserPolicy, ChannelScopeType, ChannelVisibility } from '@xyne/shared';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import { useClipboard } from '../../../hooks/useClipboard';
import { useUsers } from '../../../hooks/useUsers';
import { VisibleChannel } from '../../../machines/stateMachine';
import { Dialog } from '../../ui/Dialog';
import Button from '../../ui/Button';
import { useNavigate } from 'react-router-dom';
import { stateMachineActor } from '../../../machines/stateMachine';

const POLICY_OPTIONS = [
  { value: ChannelAddUserPolicy.EVERYONE, label: 'Everyone' },
  { value: ChannelAddUserPolicy.ADMINS_ONLY, label: 'Admins only' },
];

interface ChannelSettingsProps {
  channel: VisibleChannel;
  isAdmin: boolean;
  previousChannelId?: string | null | undefined;
  onClose?: () => void;
}

interface PolicySelectProps {
  value: ChannelAddUserPolicy;
  onValueChange: (value: ChannelAddUserPolicy) => void;
  disabled: boolean;
}

const PolicySelect: React.FC<PolicySelectProps> = ({ value, onValueChange, disabled }) => {
  return (
    <Select.Root
      value={value}
      onValueChange={v => {
        if (Object.values(ChannelAddUserPolicy).includes(v as ChannelAddUserPolicy)) {
          onValueChange(v as ChannelAddUserPolicy);
        } else {
          console.error('Invalid policy value received:', v);
        }
      }}
      disabled={disabled}
    >
      <Select.Trigger className='flex w-full items-center justify-between rounded-[8px] border border-border bg-background px-3 py-2 text-sm text-muted-foreground select-none disabled:cursor-not-allowed disabled:opacity-70 focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent hover:bg-accent data-[popup-open]:ring-1 data-[popup-open]:ring-primary'>
        <Select.Value placeholder='Select policy' />
        <Select.Icon className='flex'>
          <ChevronDown className='h-4 w-4 text-muted-foreground' />
        </Select.Icon>
      </Select.Trigger>
      <Select.Positioner sideOffset={4} alignItemWithTrigger={false} className='z-[100]'>
        <Select.Popup className='w-[var(--anchor-width)] rounded-[8px] border border-border bg-card shadow-md py-1'>
          {POLICY_OPTIONS.map(option => (
            <Select.Item
              key={option.value}
              value={option.value}
              className='grid grid-cols-[1rem_1fr] items-center gap-2 px-3 py-2 text-sm text-muted-foreground outline-none data-[highlighted]:bg-accent cursor-pointer'
            >
              <Select.ItemIndicator>
                <Check className='h-3.5 w-3.5 text-primary' />
              </Select.ItemIndicator>
              <Select.ItemText className='col-start-2'>{option.label}</Select.ItemText>
            </Select.Item>
          ))}
        </Select.Popup>
      </Select.Positioner>
    </Select.Root>
  );
};

export const ChannelSettings: React.FC<ChannelSettingsProps> = ({
  channel,
  isAdmin,
  previousChannelId,
  onClose,
}) => {
  const zero = useZero();
  const navigate = useNavigate();
  const { copy } = useClipboard();
  const allUsers = useUsers();
  const usersById = useMemo(() => new Map(allUsers.map(u => [u.id, u])), [allUsers]);

  const currentPolicy = channel.channelStats?.addUserPolicy ?? ChannelAddUserPolicy.EVERYONE;
  const [selectedPolicy, setSelectedPolicy] = useState<ChannelAddUserPolicy>(currentPolicy);
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [showUnarchiveDialog, setShowUnarchiveDialog] = useState(false);

  useEffect(() => {
    setSelectedPolicy(currentPolicy);
  }, [currentPolicy]);

  const isDefaultChannel = channel.scopeType === ChannelScopeType.DEFAULT;
  const isPrivateChannel = channel.visibility === ChannelVisibility.PRIVATE;
  const isArchived = channel.isArchived;

  const fetchParticipants = () => zero.run(queries.channelParticipants({ channelId: channel.id }));

  const handleCopyNames = async (): Promise<void> => {
    const participants = await fetchParticipants();
    const names = participants
      .map(p => usersById.get(p.userId)?.name)
      .filter(Boolean)
      .join(', ');

    const success = await copy(names);
    if (success) {
      toast.success('Copied names to clipboard');
    } else {
      toast.error('Failed to copy names to clipboard');
    }
  };

  const handleCopyEmails = async (): Promise<void> => {
    const participants = await fetchParticipants();
    const emails = participants
      .map(p => usersById.get(p.userId)?.email)
      .filter(Boolean)
      .join(', ');

    const success = await copy(emails);
    if (success) {
      toast.success('Copied emails to clipboard');
    } else {
      toast.error('Failed to copy emails to clipboard');
    }
  };

  const handlePolicyChange = (policy: ChannelAddUserPolicy): void => {
    if (!isAdmin) return;

    const previousPolicy = selectedPolicy;
    setSelectedPolicy(policy);

    try {
      zero.mutate(
        mutators.channel.updateAddUserPolicy({
          channelId: channel.id,
          policy,
        }),
      );
    } catch {
      setSelectedPolicy(previousPolicy);
      toast.error('Failed to update add user policy');
    }
  };

  const handleMakePublic = (): void => {
    try {
      zero.mutate(
        mutators.channel.makeChannelPublic({
          channelId: channel.id,
        }),
      );
    } catch {
      toast.error('Failed to make channel public');
    }
  };

  const handleUnarchiveChannel = (): void => {
    stateMachineActor.send({ type: 'UNARCHIVE_CHANNEL', channelId: channel.id });
    zero.mutate(mutators.channel.unarchiveChannel({ channelId: channel.id }));
    setShowUnarchiveDialog(false);
    toast.success(`#${channel.name} has been unarchived`);
    onClose?.();
  };

  const handleArchiveChannel = (): void => {
    let targetPath = '/chat/dir';
    if (previousChannelId && previousChannelId !== channel.id) {
      targetPath = `/chat/dir/${previousChannelId}`;
    }

    void navigate(targetPath, { replace: true });
    stateMachineActor.send({ type: 'ARCHIVE_CHANNEL', channelId: channel.id });

    zero.mutate(mutators.channel.archiveChannel({ channelId: channel.id }));
    setShowArchiveDialog(false);
    toast.success(`#${channel.name} has been archived`);
    onClose?.();
  };

  if (!isDefaultChannel) {
    return (
      <div className='p-4'>
        <p className='text-sm text-muted-foreground'>
          Settings are only available for default channels.
        </p>
      </div>
    );
  }

  return (
    <div className='flex flex-col h-[392px] bg-muted'>
      <div className='p-4 overflow-y-auto space-y-3'>
        {/* Permission card */}
        <div className='bg-card p-[12px] rounded-[12px] border border-border'>
          <div className='flex flex-col gap-y-2'>
            <p className='text-sm font-medium text-foreground'>Who can add users</p>
            <PolicySelect
              value={selectedPolicy}
              onValueChange={handlePolicyChange}
              disabled={!isAdmin}
            />
            {!isAdmin && (
              <p className='text-sm text-muted-foreground'>
                You don&apos;t have permission to change this setting.
              </p>
            )}
          </div>
        </div>

        {/* Copy actions card */}
        <div className='bg-card rounded-[12px] border border-border overflow-hidden'>
          <button
            type='button'
            onClick={() => void handleCopyNames()}
            className='w-full px-[12px] py-[10px] text-left text-sm font-medium text-foreground transition-colors hover:bg-accent'
            data-track-category='CHANNEL_SETTINGS'
            data-track-name='CopyMemberNames'
            data-track-metadata={JSON.stringify({ channelId: channel.id, isAdmin })}
          >
            <span className='inline-flex items-center gap-2'>Copy member names</span>
          </button>

          <div className='h-px bg-border' />

          <button
            type='button'
            onClick={() => void handleCopyEmails()}
            className='w-full px-[12px] py-[10px] text-left text-sm font-medium text-foreground transition-colors hover:bg-accent'
            data-track-category='CHANNEL_SETTINGS'
            data-track-name='CopyMemberEmails'
            data-track-metadata={JSON.stringify({ channelId: channel.id, isAdmin })}
          >
            <span className='inline-flex items-center gap-2'>Copy member email addresses</span>
          </button>
        </div>

        {/* Private -> public card */}
        {isPrivateChannel && (
          <div className='bg-card p-[12px] rounded-[12px] border border-border'>
            <div className='flex items-start gap-3'>
              <Hash className='mt-0.5 h-5 w-5 text-muted-foreground' />
              <div className='flex flex-col gap-y-2 min-w-0'>
                <p className='text-sm font-medium text-foreground'>Change to a public channel</p>
                {isAdmin ? (
                  <>
                    <p className='text-sm text-muted-foreground'>
                      Anyone in your workspace will be able to find and join this channel.
                    </p>
                    <button
                      type='button'
                      onClick={handleMakePublic}
                      className='mt-1 inline-flex items-center self-start rounded-[8px] border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent'
                      data-track-category='CHANNEL_SETTINGS'
                      data-track-name='MakeChannelPublic'
                      data-track-metadata={JSON.stringify({ channelId: channel.id })}
                    >
                      Change to public
                    </button>
                  </>
                ) : (
                  <p className='text-sm text-muted-foreground'>
                    You don&apos;t have permission to change this channel to public
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Unarchive channel card */}
        {isAdmin && isArchived && (
          <div className='bg-card p-[12px] rounded-[12px] border border-border'>
            <div className='flex items-start gap-3'>
              <ArchiveRestore className='mt-0.5 h-5 w-5 text-muted-foreground' />
              <div className='flex flex-col gap-y-2 min-w-0'>
                <p className='text-sm font-medium text-foreground'>Unarchive this channel</p>
                <p className='text-sm text-muted-foreground'>
                  This will restore the channel to the sidebar and allow new messages to be sent.
                </p>
                <button
                  type='button'
                  onClick={() => setShowUnarchiveDialog(true)}
                  className='mt-1 inline-flex items-center self-start rounded-[8px] border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent'
                  data-track-category='CHANNEL_SETTINGS'
                  data-track-name='UnarchiveChannel'
                  data-track-metadata={JSON.stringify({ channelId: channel.id })}
                >
                  Unarchive channel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Archive channel card */}
        {isAdmin && !isArchived && (
          <div className='bg-card p-[12px] rounded-[12px] border border-border'>
            <div className='flex items-start gap-3'>
              <Archive className='mt-0.5 h-5 w-5 text-muted-foreground' />
              <div className='flex flex-col gap-y-2 min-w-0'>
                <p className='text-sm font-medium text-foreground'>Archive this channel</p>
                <p className='text-sm text-muted-foreground'>
                  Archived channels are hidden from the channel list but remain browsable and
                  searchable. You can unarchive it later.
                </p>
                <button
                  type='button'
                  onClick={() => setShowArchiveDialog(true)}
                  className='mt-1 inline-flex items-center self-start rounded-[8px] border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-100 dark:bg-red-950 dark:border-red-800 dark:text-red-400'
                  data-track-category='CHANNEL_SETTINGS'
                  data-track-name='ArchiveChannel'
                  data-track-metadata={JSON.stringify({ channelId: channel.id })}
                >
                  Archive channel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Unarchive Confirmation Dialog */}
      {showUnarchiveDialog && (
        <Dialog
          open={showUnarchiveDialog}
          onOpenChange={setShowUnarchiveDialog}
          title='Unarchive Channel'
        >
          <div className='p-6'>
            <div className='flex items-center gap-3 mb-4'>
              <div className='p-2 rounded-full bg-green-100'>
                <ArchiveRestore className='w-6 h-6 text-green-600' />
              </div>
              <h3 className='text-lg font-semibold'>Unarchive #{channel.name}?</h3>
            </div>
            <p className='text-sm text-muted-foreground mb-6'>
              The channel will be restored to the sidebar and members will be able to send messages
              again.
            </p>
            <div className='flex justify-end gap-3'>
              <Button variant='secondary' onClick={() => setShowUnarchiveDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleUnarchiveChannel}
                className='bg-green-600 text-white hover:bg-green-700'
              >
                Unarchive Channel
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Archive Confirmation Dialog */}
      {showArchiveDialog && (
        <Dialog
          open={showArchiveDialog}
          onOpenChange={setShowArchiveDialog}
          title='Archive Channel'
        >
          <div className='p-6'>
            <div className='flex items-center gap-3 mb-4'>
              <div className='p-2 rounded-full bg-amber-100'>
                <Archive className='w-6 h-6 text-amber-600' />
              </div>
              <h3 className='text-lg font-semibold'>Archive #{channel.name}?</h3>
            </div>
            <p className='text-sm text-muted-foreground mb-6'>
              The channel will be hidden from the sidebar, but its contents will still be browsable
              and available in search.
            </p>
            <div className='flex justify-end gap-3'>
              <Button variant='secondary' onClick={() => setShowArchiveDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleArchiveChannel}
                className='bg-amber-600 text-white hover:bg-amber-700'
              >
                Archive Channel
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
};

export default ChannelSettings;
