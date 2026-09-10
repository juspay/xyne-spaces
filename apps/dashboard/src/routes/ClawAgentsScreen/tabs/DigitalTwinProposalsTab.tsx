import { ReactElement, useMemo, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { cn } from '@/utils/classNames';
import {
  useApproveDigitalTwinCluster,
  useClawDigitalTwinProposals,
} from '@/hooks/useClawDigitalTwin';
import { CandidateRow } from '@/components/ClawAgents/digitalTwin/CandidateRow';
import { SUBSYSTEM_ICONS, subsystemLabel } from '@/components/ClawAgents/digitalTwin/subsystems';

const DigitalTwinProposalsTab = (): ReactElement => {
  const { data: groups, isLoading, isError } = useClawDigitalTwinProposals();
  const approveCluster = useApproveDigitalTwinCluster();

  // Optimistic removal — approved/rejected rows disappear immediately, and the
  // subsequent proposals refetch (triggered by the mutations) confirms it.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [removedSubsystems, setRemovedSubsystems] = useState<Set<string>>(new Set());
  const [bulkActing, setBulkActing] = useState<string | null>(null);

  const removeCandidate = (id: string): void => setRemovedIds(prev => new Set(prev).add(id));

  const visibleGroups = useMemo(
    () =>
      (groups ?? [])
        .filter(g => !removedSubsystems.has(g.subsystem))
        .map(g => ({ ...g, candidates: g.candidates.filter(c => !removedIds.has(c.id)) }))
        .filter(g => g.candidates.length > 0),
    [groups, removedIds, removedSubsystems],
  );

  const totalPending = visibleGroups.reduce((sum, g) => sum + g.candidates.length, 0);

  const approveGroup = async (subsystem: string): Promise<void> => {
    setBulkActing(subsystem);
    try {
      const { count } = await approveCluster.mutateAsync({ subsystem });
      toast.success(`Approving ${count ?? 'all'} — saving to Hindsight`);
      setRemovedSubsystems(prev => new Set(prev).add(subsystem));
    } finally {
      setBulkActing(null);
    }
  };

  const approveEverything = async (): Promise<void> => {
    const subsystems = visibleGroups.map(g => g.subsystem);
    if (subsystems.length === 0) return;
    setBulkActing('__all__');
    try {
      await Promise.all(subsystems.map(s => approveCluster.mutateAsync({ subsystem: s })));
      toast.success(`Approving all ${totalPending} proposals — saving to Hindsight`);
      setRemovedSubsystems(prev => {
        const next = new Set(prev);
        subsystems.forEach(s => next.add(s));
        return next;
      });
    } finally {
      setBulkActing(null);
    }
  };

  if (isLoading) {
    return (
      <div className='flex flex-col gap-3'>
        {[0, 1].map(i => (
          <div key={i} className='overflow-hidden rounded-xl border border-border bg-card'>
            <div className='flex items-center gap-2.5 border-b border-border bg-muted/40 px-3.5 py-2.5'>
              <Skeleton className='size-7 rounded-full' />
              <Skeleton className='h-3 w-24 rounded' />
            </div>
            {Array.from({ length: i === 0 ? 3 : 2 }).map((_, j) => (
              <div
                key={j}
                className='flex items-center gap-2.5 border-b border-border px-3.5 py-3 last:border-b-0'
              >
                <div className='min-w-0 flex-1 space-y-1.5'>
                  <Skeleton className='h-2.5 w-[85%] rounded' />
                  <Skeleton className='h-2.5 w-[55%] rounded' />
                </div>
                <Skeleton className='size-[30px] rounded-full' />
                <Skeleton className='size-[30px] rounded-full' />
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className='rounded-lg border border-border p-4 text-center text-xs text-destructive'>
        Failed to load proposals
      </div>
    );
  }

  if (visibleGroups.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-12 text-center'>
        <p className='text-[13px] text-muted-foreground'>No proposals pending</p>
        <p className='text-xs text-muted-foreground'>
          The daily curator adds new candidates after 21:00 UTC each night.
        </p>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-between px-0.5'>
        <span className='text-xs tabular-nums text-muted-foreground'>
          {totalPending} proposal{totalPending !== 1 ? 's' : ''} pending
        </span>
        <button
          type='button'
          onClick={() => void approveEverything()}
          data-track-category='Claw Agents'
          data-track-name='Digital Twin approve all proposals'
          disabled={bulkActing !== null}
          className='flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-85 active:scale-95 disabled:opacity-50'
        >
          {bulkActing === '__all__' ? (
            <Loader2 className='size-3 animate-spin' />
          ) : (
            <Check className='size-3' />
          )}
          Approve all
        </button>
      </div>

      {visibleGroups.map(group => {
        const Icon = SUBSYSTEM_ICONS[group.subsystem];
        return (
          <div
            key={group.subsystem}
            className='overflow-hidden rounded-xl border border-border bg-card'
          >
            <div className='flex items-center gap-2.5 border-b border-border bg-muted/40 px-3.5 py-2.5'>
              <div className='flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground'>
                {Icon && <Icon className='size-3.5' />}
              </div>
              <span className='text-xs font-semibold text-foreground'>
                {subsystemLabel(group.subsystem)}
              </span>
              <span className='flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[10px] font-bold tabular-nums text-muted-foreground'>
                {group.candidates.length}
              </span>
              <Tooltip
                side='left'
                content={`Approve all ${group.candidates.length} in ${subsystemLabel(group.subsystem)}`}
              >
                <button
                  type='button'
                  onClick={() => void approveGroup(group.subsystem)}
                  data-track-category='Claw Agents'
                  data-track-name='Digital Twin approve subsystem proposals'
                  disabled={bulkActing !== null}
                  className={cn(
                    'ml-auto flex items-center gap-1 rounded-full border border-emerald-600/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 transition hover:bg-muted active:scale-95 disabled:opacity-50 dark:text-emerald-400',
                  )}
                >
                  {bulkActing === group.subsystem ? (
                    <Loader2 className='size-3 animate-spin' />
                  ) : (
                    <Check className='size-3' />
                  )}
                  Approve all
                </button>
              </Tooltip>
            </div>

            <div className='divide-y divide-border'>
              {group.candidates.map(candidate => (
                <CandidateRow
                  key={candidate.id}
                  candidate={candidate}
                  onApproved={removeCandidate}
                  onRejected={removeCandidate}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default DigitalTwinProposalsTab;
