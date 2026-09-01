import { ReactElement, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CheckTickCircle, FilterFunnel } from '@xyne/icons';
import { AdminSearchField } from '@/routes/AIScreen/library/admin/components/AdminSearchField';
import { TabMessage } from '@/routes/AIScreen/library/admin/components/TabMessage';
import { FilterSelect } from '@/routes/AIScreen/library/admin/components/FilterSelect';
import { Button } from '@/components/ui/Button/index';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  useApproveDigitalTwinCluster,
  useClawDigitalTwinProposals,
} from '@/hooks/useClawDigitalTwin';
import { CandidateRow } from '../components/CandidateRow';
import { SUBSYSTEM_ICONS, SUBSYSTEM_LABELS, subsystemLabel } from '../components/subsystems';
import type { DigitalTwinCandidate } from '@/services/claw/digitalTwinTypes';

const DigitalTwinProposalsTab = (): ReactElement => {
  const { data: groups, isLoading, isError } = useClawDigitalTwinProposals();
  const approveCluster = useApproveDigitalTwinCluster();

  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [bulkActing, setBulkActing] = useState(false);
  const [search, setSearch] = useState('');
  const [subsystemFilter, setSubsystemFilter] = useState('');

  const removeCandidate = (id: string): void => setRemovedIds(prev => new Set(prev).add(id));

  const allCandidates = useMemo(
    () =>
      (groups ?? []).flatMap(g =>
        g.candidates.map(c => ({ ...c, subsystem: c.subsystem || g.subsystem })),
      ),
    [groups],
  );

  const subsystemOptions = useMemo(() => {
    const all = new Set<string>(Object.keys(SUBSYSTEM_LABELS));
    for (const c of allCandidates) all.add(c.subsystem);
    const options = [...all]
      .sort((a, b) => subsystemLabel(a).localeCompare(subsystemLabel(b)))
      .map(subsystem => {
        const IconComponent = SUBSYSTEM_ICONS[subsystem];
        return {
          value: subsystem,
          label: subsystemLabel(subsystem),
          icon: IconComponent ? <IconComponent className='size-4' aria-hidden /> : undefined,
        };
      });
    return [{ value: '', label: 'All subsystems' }, ...options];
  }, [allCandidates]);

  const visible = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allCandidates.filter(c => {
      if (removedIds.has(c.id)) return false;
      if (subsystemFilter && c.subsystem !== subsystemFilter) return false;
      if (!q) return true;
      return (
        (c.editedText ?? c.text).toLowerCase().includes(q) ||
        subsystemLabel(c.subsystem).toLowerCase().includes(q)
      );
    });
  }, [allCandidates, removedIds, subsystemFilter, search]);

  const approveVisible = async (): Promise<void> => {
    if (visible.length === 0) return;
    const bySubsystem = new Map<string, string[]>();
    for (const c of visible) {
      const ids = bySubsystem.get(c.subsystem) ?? [];
      ids.push(c.id);
      bySubsystem.set(c.subsystem, ids);
    }
    setBulkActing(true);
    try {
      await Promise.all(
        [...bySubsystem.entries()].map(([subsystem, candidateIds]) =>
          approveCluster.mutateAsync({ subsystem, candidateIds }),
        ),
      );
      toast.success(`Approving ${visible.length} — saving to Hindsight`);
      setRemovedIds(prev => {
        const next = new Set(prev);
        visible.forEach(c => next.add(c.id));
        return next;
      });
    } finally {
      setBulkActing(false);
    }
  };

  const narrowed = search.trim().length > 0 || subsystemFilter.length > 0;
  const emptyMessage = search.trim()
    ? `No proposals match “${search.trim()}”`
    : subsystemFilter
      ? `No proposals in ${subsystemLabel(subsystemFilter)}`
      : 'No proposals pending';

  return (
    <div className='flex flex-col gap-2.5'>
      <div className='sticky top-0 z-10 -mb-2.5 flex flex-col gap-2.5 bg-background pb-2.5'>
        <AdminSearchField
          value={search}
          onChange={setSearch}
          placeholder='Search proposals'
          ariaLabel='Search proposals'
          trackCategory='Claw Agents'
          trackName='Digital Twin: search proposals'
          className='w-full'
        />

        <div className='flex flex-wrap items-center justify-end gap-2'>
          <FilterSelect
            ariaLabel='Subsystem filter'
            icon={<FilterFunnel className='size-4 shrink-0 text-muted-foreground' aria-hidden />}
            value={subsystemFilter}
            onChange={setSubsystemFilter}
            options={subsystemOptions}
            anchorLabel='All subsystems'
          />
          {visible.length > 0 && (
            <Button
              type='button'
              size='sm'
              onClick={() => void approveVisible()}
              loading={bulkActing}
              disabled={bulkActing}
              data-track-category='Claw Agents'
              data-track-name='Digital Twin approve all proposals'
            >
              {!bulkActing && <CheckTickCircle className='size-4' aria-hidden />}
              Approve all
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <ul className='flex flex-col'>
          {[0, 1, 2, 3].map(i => (
            <li key={i} className='flex items-start gap-3 border-b border-border px-1 py-4'>
              <Skeleton className='size-8 shrink-0 rounded-lg' />
              <div className='min-w-0 flex-1 space-y-2'>
                <Skeleton className='h-3.5 w-[85%] rounded' />
                <Skeleton className='h-3 w-32 rounded' />
              </div>
              <Skeleton className='size-[30px] shrink-0 rounded-full' />
            </li>
          ))}
        </ul>
      ) : isError ? (
        <TabMessage>Couldn’t load proposals.</TabMessage>
      ) : visible.length === 0 ? (
        <TabMessage>
          {emptyMessage}
          {!narrowed && ' — new candidates are added automatically each night.'}
        </TabMessage>
      ) : (
        <ul className='flex flex-col'>
          {visible.map((candidate: DigitalTwinCandidate) => (
            <CandidateRow
              key={candidate.id}
              candidate={candidate}
              onApproved={removeCandidate}
              onRejected={removeCandidate}
              query={search}
            />
          ))}
        </ul>
      )}
    </div>
  );
};

export default DigitalTwinProposalsTab;
