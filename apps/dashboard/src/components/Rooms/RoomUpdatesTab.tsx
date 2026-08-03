import { ReactElement, useMemo } from 'react';
import { Hash, Sparkles, UserPlus, type LucideIcon } from 'lucide-react';
import { RoomMemberStatus, type RoomMember, type RoomRecap, type RoomSource } from '@xyne/shared';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { formatUpdatedAt } from './Rooms.utils';

interface RoomUpdate {
  id: string;
  timestamp: number;
  icon: LucideIcon;
  title: string;
  detail: string;
  userId?: string;
}

function UpdateRow({ update }: { update: RoomUpdate }): ReactElement {
  const user = useUser(update.userId ?? '');
  const Icon = update.icon;
  const detail =
    update.userId && user ? `${update.detail} ${getUserDisplayName(user)}` : update.detail;

  return (
    <div className='flex items-start gap-3 py-3 border-t border-border first:border-t-0'>
      <span className='size-8 rounded-lg bg-muted text-muted-foreground inline-flex items-center justify-center shrink-0'>
        <Icon size={15} />
      </span>
      <div className='min-w-0 flex-1'>
        <p className='text-sm font-medium text-foreground'>{update.title}</p>
        <p className='text-xs text-muted-foreground mt-0.5'>{detail}</p>
      </div>
      <span className='whitespace-nowrap text-xs tabular-nums text-muted-foreground'>
        {formatUpdatedAt(update.timestamp)}
      </span>
    </div>
  );
}

interface RoomUpdatesTabProps {
  recaps: readonly RoomRecap[];
  sources: readonly RoomSource[];
  members: readonly RoomMember[];
}

export function RoomUpdatesTab({ recaps, sources, members }: RoomUpdatesTabProps): ReactElement {
  const updates = useMemo((): RoomUpdate[] => {
    const items: RoomUpdate[] = [];

    for (const recap of recaps) {
      if (recap.deletedAt) continue;
      items.push({
        id: `recap-${recap.id}`,
        timestamp: recap.createdAt,
        icon: Sparkles,
        title: 'New recap generated',
        detail: 'The curation agent published a new briefing.',
      });
    }

    for (const source of sources) {
      items.push({
        id: `source-${source.id}`,
        timestamp: source.createdAt,
        icon: Hash,
        title: 'Source added',
        detail: `${source.label} was added by`,
        userId: source.addedBy,
      });
    }

    for (const member of members) {
      if (member.status !== RoomMemberStatus.APPROVED) continue;
      items.push({
        id: `member-${member.id}`,
        timestamp: member.joinedAt,
        icon: UserPlus,
        title: 'Member joined',
        detail: 'Now in the room:',
        userId: member.userId,
      });
    }

    return items.sort((a, b) => b.timestamp - a.timestamp);
  }, [recaps, sources, members]);

  return (
    <div data-slot='room-updates-tab' className='flex flex-col gap-4'>
      <p className='text-sm text-muted-foreground [text-wrap:pretty]'>
        Summaries, source changes, and membership changes — newest first.
      </p>
      <section className='rounded-2xl border border-border bg-background p-4'>
        {updates.length === 0 ? (
          <p className='text-sm text-muted-foreground py-4 text-center'>No activity yet.</p>
        ) : (
          updates.map(update => <UpdateRow key={update.id} update={update} />)
        )}
      </section>
    </div>
  );
}
