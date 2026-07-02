import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useZero } from './useZero';
import { mutators } from '../zero/mutators';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';
import { useChannel } from './useChannels';
import { useAuthContextValues } from './useAuth';

function GateToast({
  toastId,
  userName,
  channelLabel,
  canAdd,
  onAddAssign,
}: {
  toastId: string | number;
  userName: string;
  channelLabel: string;
  canAdd: boolean;
  onAddAssign: () => void;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        toast.dismiss(toastId);
      }
    };
    const t = window.setTimeout(() => document.addEventListener('mousedown', handlePointerDown), 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [toastId]);

  return (
    <div ref={ref} className='relative flex w-full flex-col gap-2'>
      <button
        type='button'
        aria-label='Close'
        onClick={() => toast.dismiss(toastId)}
        className='absolute right-0 top-0 rounded p-0.5 text-zinc-400 hover:text-white'
        data-track-category='Tickets'
        data-track-name='CloseAssignGateToast'
      >
        <X className='h-3.5 w-3.5' />
      </button>
      <div className='pr-6 text-sm text-white'>
        <span className='font-semibold'>{userName}</span> isn&apos;t in {channelLabel}
      </div>
      <div className='text-xs text-white/80'>
        {canAdd
          ? 'Add them to the channel to assign this ticket.'
          : `You need to be a member of ${channelLabel} to add them.`}
      </div>
      <div className='mt-1 flex items-center justify-end gap-2'>
        <button
          type='button'
          onClick={() => toast.dismiss(toastId)}
          className='rounded-md px-2.5 py-1 text-xs font-medium text-zinc-300 hover:text-white'
          data-track-category='Tickets'
          data-track-name='DismissAssignGate'
        >
          Dismiss
        </button>
        {canAdd && (
          <button
            type='button'
            onClick={onAddAssign}
            className='rounded-md bg-white px-2.5 py-1 text-xs font-medium text-black hover:bg-zinc-200'
            data-track-category='Tickets'
            data-track-name='AddToChannelAndAssign'
          >
            Add &amp; assign
          </button>
        )}
      </div>
    </div>
  );
}

interface GatedAssignParams {
  userId: string;
  userName: string;
  assign: () => void;
}

export interface ChannelAssignGate {
  shouldGate: boolean;
  memberIds: Set<string>;
  gatedAssign: (params: GatedAssignParams) => void;
}
export function useChannelAssignGate(channelId: string | undefined): ChannelAssignGate {
  const zero = useZero();
  const { userID: currentUserId } = useAuthContextValues();

  const gatingEnabled = !!channelId;
  const channel = useChannel(channelId || '');
  const channelLabel = channel?.name ? `#${channel.name}` : 'this channel';
  const [participants] = useCachedQuery(
    queries.channelParticipants({ channelId: channelId || '' }),
    { enabled: gatingEnabled },
  );
  const memberIds = useMemo(() => new Set((participants ?? []).map(p => p.userId)), [participants]);
  const shouldGate = gatingEnabled && participants !== undefined;
  const currentUserIsMember = memberIds.has(currentUserId);

  const gatedAssign = ({ userId, userName, assign }: GatedAssignParams): void => {
    if (!shouldGate || memberIds.has(userId)) {
      assign();
      return;
    }

    const addThenAssign = (toastId: string | number): void => {
      if (!channelId) return;
      const now = Date.now();
      void zero.mutate(
        mutators.channel.addParticipants({
          channelId,
          userIds: [userId],
          timestamp: now,
          participantIds: { [userId]: uuidv4() },
          userStatusIds: { [userId]: uuidv4() },
        }),
      );
      assign();
      toast.dismiss(toastId);
      toast(`Added ${userName} to ${channelLabel} — ticket assigned`);
    };

    toast.custom(
      toastId => (
        <GateToast
          toastId={toastId}
          userName={userName}
          channelLabel={channelLabel}
          canAdd={currentUserIsMember}
          onAddAssign={() => addThenAssign(toastId)}
        />
      ),

      { duration: Infinity, style: { borderRadius: '0.75rem' } },
    );
  };

  return { shouldGate, memberIds, gatedAssign };
}
