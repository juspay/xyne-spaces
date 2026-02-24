import React, { useEffect, useMemo, useState } from 'react';
import { Select } from '@base-ui/react/select';
import { Check, ChevronDown, Hash } from 'lucide-react';
import { toast } from 'sonner';
import { Channel, ChannelAddUserPolicy, ChannelScopeType, ChannelVisibility } from '@xyne/shared';
import { useZero } from '@rocicorp/zero/react'; // eslint-disable-line local-rules/no-rocicorp-use-zero
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import { useClipboard } from '../../../hooks/useClipboard';
import { useUsers } from '../../../hooks/useUsers';

const POLICY_OPTIONS = [
  { value: ChannelAddUserPolicy.EVERYONE, label: 'Everyone' },
  { value: ChannelAddUserPolicy.ADMINS_ONLY, label: 'Admins only' },
];

interface ChannelSettingsProps {
  channel: Channel;
  isAdmin: boolean;
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
      <Select.Trigger className='flex w-full items-center justify-between rounded-[8px] border border-[#E4E6E7] bg-white px-3 py-2 text-sm text-[#505B62] select-none disabled:cursor-not-allowed disabled:opacity-70 focus:outline-none focus:ring-1 focus:ring-primary focus:border-transparent hover:bg-[#FAFAFA] data-[popup-open]:ring-1 data-[popup-open]:ring-primary'>
        <Select.Value placeholder='Select policy' />
        <Select.Icon className='flex'>
          <ChevronDown className='h-4 w-4 text-[#505B62]' />
        </Select.Icon>
      </Select.Trigger>
      <Select.Positioner sideOffset={4} alignItemWithTrigger={false} className='z-[100]'>
        <Select.Popup className='w-[var(--anchor-width)] rounded-[8px] border border-[#E4E6E7] bg-white shadow-md py-1'>
          {POLICY_OPTIONS.map(option => (
            <Select.Item
              key={option.value}
              value={option.value}
              className='grid grid-cols-[1rem_1fr] items-center gap-2 px-3 py-2 text-sm text-[#505B62] outline-none data-[highlighted]:bg-[#FAFAFA] cursor-pointer'
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

export const ChannelSettings: React.FC<ChannelSettingsProps> = ({ channel, isAdmin }) => {
  const zero = useZero();
  const { copy } = useClipboard();
  const allUsers = useUsers();
  const usersById = useMemo(() => new Map(allUsers.map(u => [u.id, u])), [allUsers]);

  const currentPolicy = channel.addUserPolicy ?? ChannelAddUserPolicy.EVERYONE;
  const [selectedPolicy, setSelectedPolicy] = useState<ChannelAddUserPolicy>(currentPolicy);

  useEffect(() => {
    setSelectedPolicy(currentPolicy);
  }, [currentPolicy]);

  const isDefaultChannel = channel.scopeType === ChannelScopeType.DEFAULT;
  const isPrivateChannel = channel.visibility === ChannelVisibility.PRIVATE;

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

  if (!isDefaultChannel) {
    return (
      <div className='p-4'>
        <p className='text-sm text-gray-600'>Settings are only available for default channels.</p>
      </div>
    );
  }

  return (
    <div className='flex flex-col h-[392px] bg-[#FAFAFA]'>
      <div className='p-4 overflow-y-auto space-y-3'>
        {/* Permission card */}
        <div className='bg-white p-[12px] rounded-[12px] border border-[#F2F2F3]'>
          <div className='flex flex-col gap-y-2'>
            <p className='text-sm font-medium text-[#181B1D]'>Who can add users</p>
            <PolicySelect
              value={selectedPolicy}
              onValueChange={handlePolicyChange}
              disabled={!isAdmin}
            />
            {!isAdmin && (
              <p className='text-sm text-[#505B62]'>
                You don&apos;t have permission to change this setting.
              </p>
            )}
          </div>
        </div>

        {/* Copy actions card */}
        <div className='bg-white rounded-[12px] border border-[#F2F2F3] overflow-hidden'>
          <button
            type='button'
            onClick={() => void handleCopyNames()}
            className='w-full px-[12px] py-[10px] text-left text-sm font-medium text-[#181B1D] transition-colors hover:bg-[#FAFAFA]'
          >
            <span className='inline-flex items-center gap-2'>Copy member names</span>
          </button>

          <div className='h-px bg-[#F2F2F3]' />

          <button
            type='button'
            onClick={() => void handleCopyEmails()}
            className='w-full px-[12px] py-[10px] text-left text-sm font-medium text-[#181B1D] transition-colors hover:bg-[#FAFAFA]'
          >
            <span className='inline-flex items-center gap-2'>Copy member email addresses</span>
          </button>
        </div>

        {/* Private -> public card */}
        {isPrivateChannel && (
          <div className='bg-white p-[12px] rounded-[12px] border border-[#F2F2F3]'>
            <div className='flex items-start gap-3'>
              <Hash className='mt-0.5 h-5 w-5 text-[#505B62]' />
              <div className='flex flex-col gap-y-2 min-w-0'>
                <p className='text-sm font-medium text-[#181B1D]'>Change to a public channel</p>
                {isAdmin ? (
                  <>
                    <p className='text-sm text-[#505B62]'>
                      Anyone in your workspace will be able to find and join this channel.
                    </p>
                    <button
                      type='button'
                      onClick={handleMakePublic}
                      className='mt-1 inline-flex items-center self-start rounded-[8px] border border-[#E4E6E7] bg-white px-3 py-1.5 text-sm font-medium text-[#181B1D] hover:bg-[#FAFAFA]'
                    >
                      Change to public
                    </button>
                  </>
                ) : (
                  <p className='text-sm text-[#505B62]'>
                    You don&apos;t have permission to change this channel to public
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChannelSettings;
