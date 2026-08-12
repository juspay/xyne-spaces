import { ReactElement, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  AlertTriangle,
  Brain,
  Check,
  CheckDouble,
  ChevronDown,
  Loader2,
} from '@/components/ClawAgents/digitalTwin/icons';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import {
  useApproveDigitalTwinCluster,
  useClawDigitalTwinProposals,
} from '@/hooks/useClawDigitalTwin';
import { CandidateRow } from '@/components/ClawAgents/digitalTwin/CandidateRow';
import {
  normalizeSubsystem,
  subsystemIcon,
  subsystemLabel,
  subsystemRank,
} from '@/components/ClawAgents/digitalTwin/subsystems';

interface GroupConfirmation {
  subsystem: string;
  count: number;
  label: string;
}

interface Outcome {
  message: string;
  error: boolean;
}

const MOTION_EASE = [0.22, 1, 0.36, 1] as const;

const reviewSubsystemLabel = (subsystem: string): string =>
  normalizeSubsystem(subsystem) === 'style' ? 'Communication' : subsystemLabel(subsystem);

const DigitalTwinProposalsTab = (): ReactElement => {
  const proposalQuery = useClawDigitalTwinProposals();
  const approveCluster = useApproveDigitalTwinCluster();
  const reduceMotion = useReducedMotion();
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [removedSubsystems, setRemovedSubsystems] = useState<Set<string>>(new Set());
  const [collapsedSubsystems, setCollapsedSubsystems] = useState<Set<string>>(new Set());
  const [bulkActing, setBulkActing] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<GroupConfirmation | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const groups = useMemo(() => proposalQuery.data?.groups ?? [], [proposalQuery.data?.groups]);
  const failedSubsystems = proposalQuery.data?.failedSubsystems ?? [];
  const visibleGroups = useMemo(
    () =>
      groups
        .filter(group => !removedSubsystems.has(group.subsystem))
        .map(group => ({
          ...group,
          candidates: group.candidates.filter(candidate => !removedIds.has(candidate.id)),
        }))
        .filter(group => group.candidates.length > 0)
        .sort(
          (a, b) =>
            subsystemRank(a.subsystem) - subsystemRank(b.subsystem) ||
            subsystemLabel(a.subsystem).localeCompare(subsystemLabel(b.subsystem)),
        ),
    [groups, removedIds, removedSubsystems],
  );
  const totalPending = visibleGroups.reduce((sum, group) => sum + group.candidates.length, 0);

  const remove = (id: string): void => setRemovedIds(previous => new Set(previous).add(id));
  const restore = (id: string): void => {
    setRemovedIds(previous => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
  };

  const showOutcome = (message: string, error = false): void => setOutcome({ message, error });

  const toggleGroup = (subsystem: string): void => {
    setCollapsedSubsystems(previous => {
      const next = new Set(previous);
      if (next.has(subsystem)) next.delete(subsystem);
      else next.add(subsystem);
      return next;
    });
  };

  const approveGroup = async (subsystem: string): Promise<void> => {
    const group = visibleGroups.find(item => item.subsystem === subsystem);
    const count = group?.candidates.length ?? 0;
    setBulkActing(subsystem);
    try {
      const result = await approveCluster.mutateAsync({ subsystem });
      setRemovedSubsystems(previous => new Set(previous).add(subsystem));
      const approved = result.count ?? count;
      showOutcome(
        `Added ${approved} memor${approved === 1 ? 'y' : 'ies'} from ${reviewSubsystemLabel(subsystem)}.`,
      );
      toast.success(`${approved} proposals approved`);
    } catch {
      showOutcome(
        `Could not approve ${reviewSubsystemLabel(subsystem)}. Nothing was removed; try again.`,
        true,
      );
    } finally {
      setBulkActing(null);
    }
  };

  if (proposalQuery.isLoading) {
    return (
      <div className='flex flex-col gap-4'>
        <Skeleton className='h-5 w-2/3' />
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className='h-11 w-full rounded-2xl' />
        ))}
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-4'>
      <p className='max-w-[68ch] pl-3 text-sm font-[450] leading-[1.3] text-muted-foreground'>
        Review one suggestion at a time. Nothing becomes memory until you approve it.
      </p>

      {outcome && (
        <div
          role={outcome.error ? 'alert' : 'status'}
          className={
            outcome.error
              ? 'flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive'
              : 'flex items-start gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-foreground'
          }
        >
          {outcome.error ? (
            <AlertTriangle className='mt-0.5 size-4 shrink-0' />
          ) : (
            <Check className='mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-300' />
          )}
          <p className='min-w-0 flex-1'>{outcome.message}</p>
          <button
            type='button'
            className='min-h-8 text-xs font-medium underline underline-offset-4'
            onClick={() => setOutcome(null)}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin dismiss review outcome'
          >
            Dismiss
          </button>
        </div>
      )}

      {proposalQuery.isError && (
        <div role='alert' className='rounded-xl border border-destructive/30 bg-destructive/5 p-4'>
          <p className='text-sm font-semibold text-destructive'>The review queue did not load.</p>
          <p className='mt-1 text-sm text-muted-foreground'>{proposalQuery.error.message}</p>
          <Button
            variant='outline'
            size='sm'
            className='mt-3'
            onClick={() => void proposalQuery.refetch()}
          >
            Try again
          </Button>
        </div>
      )}

      {failedSubsystems.length > 0 && (
        <div
          role='status'
          className='flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3'
        >
          <AlertTriangle className='size-5 text-amber-700 dark:text-amber-300' />
          <p className='min-w-0 flex-1 text-sm text-foreground'>
            {failedSubsystems.map(subsystemLabel).join(', ')} could not be loaded. The rest of your
            queue is still shown.
          </p>
          <Button variant='ghost' size='sm' onClick={() => void proposalQuery.refetch()}>
            Retry missing areas
          </Button>
        </div>
      )}

      {!proposalQuery.isError && totalPending === 0 && (
        <div className='flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-8 py-12 text-center'>
          <Brain className='size-7 text-muted-foreground' />
          <h2 className='mt-4 text-base font-semibold text-foreground'>
            Nothing is waiting for you
          </h2>
          <p className='mt-1 max-w-[58ch] text-sm text-muted-foreground'>
            New suggestions appear here after the Twin finds lasting knowledge in the work it is
            allowed to read.
          </p>
        </div>
      )}

      {!proposalQuery.isError && totalPending > 0 && (
        <motion.div layout={reduceMotion ? false : 'position'} className='dt-review-groups'>
          {visibleGroups.map(group => {
            const expanded = !collapsedSubsystems.has(group.subsystem);
            const GroupIcon = subsystemIcon(group.subsystem) ?? Brain;
            const count = group.candidates.length;
            return (
              <motion.section
                layout={reduceMotion ? false : 'position'}
                key={group.subsystem}
                className='dt-review-group'
              >
                <button
                  type='button'
                  className='dt-review-group-toggle'
                  aria-expanded={expanded}
                  aria-controls={`review-group-${group.subsystem}`}
                  onClick={() => toggleGroup(group.subsystem)}
                  data-track-category='Claw Agents'
                  data-track-name='Digital Twin toggle proposal category'
                >
                  <span className='dt-review-group-label'>
                    <GroupIcon className='size-4 shrink-0' />
                    <span>{reviewSubsystemLabel(group.subsystem)}</span>
                    {!expanded && <span className='dt-review-group-count'>{count}</span>}
                  </span>
                  <motion.span
                    className='inline-flex shrink-0 text-muted-foreground'
                    animate={{ rotate: expanded ? 180 : 0 }}
                    transition={{ duration: reduceMotion ? 0 : 0.18, ease: MOTION_EASE }}
                  >
                    <ChevronDown className='size-4' />
                  </motion.span>
                </button>

                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div
                      key='content'
                      id={`review-group-${group.subsystem}`}
                      className='dt-review-group-content'
                      initial={reduceMotion ? false : { opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                      transition={{ duration: reduceMotion ? 0 : 0.2, ease: MOTION_EASE }}
                    >
                      <div className='dt-review-group-toolbar'>
                        <p>
                          {count} Proposal{count === 1 ? '' : 's'} Pending
                        </p>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='h-7 rounded-[10px] px-2 font-[450] text-primary hover:bg-primary/10 hover:text-primary'
                          disabled={bulkActing !== null}
                          onClick={() =>
                            setConfirmation({
                              subsystem: group.subsystem,
                              count,
                              label: `Approve all ${count} in ${reviewSubsystemLabel(group.subsystem)}`,
                            })
                          }
                          data-track-category='Claw Agents'
                          data-track-name='Digital Twin approve proposal category'
                        >
                          {bulkActing === group.subsystem ? (
                            <Loader2 className='size-4 animate-spin' />
                          ) : (
                            <CheckDouble className='size-4' />
                          )}
                          Approve all
                        </Button>
                      </div>

                      <div className='dt-review-proposal-list'>
                        {group.candidates.map(candidate => (
                          <CandidateRow
                            key={candidate.id}
                            candidate={candidate}
                            total={totalPending}
                            onApproved={remove}
                            onRejected={remove}
                            onRestore={restore}
                            onOutcome={showOutcome}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.section>
            );
          })}
        </motion.div>
      )}

      <ConfirmDialog
        surface='digital-twin'
        open={confirmation !== null}
        onOpenChange={open => {
          if (!open) setConfirmation(null);
        }}
        title={confirmation?.label ?? 'Approve proposals?'}
        description={
          confirmation
            ? `This will add exactly ${confirmation.count} memor${confirmation.count === 1 ? 'y' : 'ies'} to your Twin immediately. There is no undo for category approval.`
            : undefined
        }
        confirmLabel={confirmation ? `Approve ${confirmation.count}` : 'Approve'}
        loading={bulkActing !== null}
        onConfirm={() => {
          const current = confirmation;
          setConfirmation(null);
          if (current) void approveGroup(current.subsystem);
        }}
      />
    </div>
  );
};

export default DigitalTwinProposalsTab;
