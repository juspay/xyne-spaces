import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { Plus, Trash2 } from 'lucide-react';
import { AttributionConfidence, BaseTicketType } from '@xyne/shared';
import { useZero } from '../../../hooks/useZero';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { Button } from '../../../components/ui/Button';
import { Combobox } from '../../../components/ui/Combobox/Combobox';
import type { ReleaseMappingFormProps, Phase } from '../RCAScreen.types';

const confidenceOptions = [
  { label: 'Low', value: AttributionConfidence.LOW },
  { label: 'Medium', value: AttributionConfidence.MEDIUM },
  { label: 'High', value: AttributionConfidence.HIGH },
];

export const ReleaseMappingForm = ({
  ticketId,
  releaseAttributions,
  attributedSubTickets,
  isSubmitting,
  onPhaseChange,
}: ReleaseMappingFormProps) => {
  const zero = useZero();
  const [releaseSearch, setReleaseSearch] = useState('');
  const debouncedReleaseSearch = useDebouncedValue(releaseSearch, 300);
  const [selectedReleaseId, setSelectedReleaseId] = useState('');
  const [selectedAppReleaseId, setSelectedAppReleaseId] = useState('');
  const [appReleaseSearch, setAppReleaseSearch] = useState('');
  const [selectedRootCauseTicketId, setSelectedRootCauseTicketId] = useState('');
  const [rootCauseTicketSearch, setRootCauseTicketSearch] = useState('');
  const debouncedRootCauseTicketSearch = useDebouncedValue(rootCauseTicketSearch, 300);
  const [confidence, setConfidence] = useState<AttributionConfidence>(AttributionConfidence.LOW);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [releaseSubTicketMappings] = useCachedQuery(
    queries.subTicketsForTicket({ ticketId: selectedReleaseId }),
    { enabled: !!selectedReleaseId },
  );

  const [releaseTicketsData] = useCachedQuery(
    queries.releaseTicketsSearch({
      search: debouncedReleaseSearch.trim() ? debouncedReleaseSearch.trim() : undefined,
      limit: 10,
    }),
  );

  const [rootCauseTicketsData] = useCachedQuery(
    queries.ticketsSearch({
      search: debouncedRootCauseTicketSearch.trim()
        ? debouncedRootCauseTicketSearch.trim()
        : undefined,
      limit: 10,
    }),
  );

  const releaseIds = useMemo(
    () =>
      Array.from(
        new Set(
          releaseAttributions
            .map(attribution => attribution.releaseId)
            .filter((id): id is string => !!id),
        ),
      ),
    [releaseAttributions],
  );

  const rootCauseTicketIds = useMemo(
    () =>
      Array.from(
        new Set(
          releaseAttributions
            .map(attribution => attribution.rootCauseTicketId)
            .filter((id): id is string => !!id),
        ),
      ),
    [releaseAttributions],
  );

  const [releaseTicketsById] = useCachedQuery(queries.ticketsByIds({ ticketIds: releaseIds }), {
    enabled: releaseIds.length > 0,
  });

  const [rootCauseTicketsById] = useCachedQuery(
    queries.ticketsByIds({ ticketIds: rootCauseTicketIds }),
    { enabled: rootCauseTicketIds.length > 0 },
  );

  const [selectedReleaseTicketById] = useCachedQuery(
    queries.ticketsByIds({ ticketIds: selectedReleaseId ? [selectedReleaseId] : [] }),
    { enabled: !!selectedReleaseId },
  );

  const [selectedRootCauseTicketById] = useCachedQuery(
    queries.ticketsByIds({
      ticketIds: selectedRootCauseTicketId ? [selectedRootCauseTicketId] : [],
    }),
    { enabled: !!selectedRootCauseTicketId },
  );

  // Get release ticket IDs that are sub-tickets (have a parent ticket)
  const releaseTicketIds = useMemo(
    () => (releaseTicketsData ?? []).map(ticket => ticket.id),
    [releaseTicketsData],
  );

  const [subTicketMappings] = useCachedQuery(
    queries.subTicketsByMappedTicketIds({ mappedTicketIds: releaseTicketIds }),
    { enabled: releaseTicketIds.length > 0 },
  );

  const releaseTicketOptions = useMemo(() => {
    const subTicketIds = new Set(
      (subTicketMappings ?? []).map(st => st.mappedTicketId).filter(Boolean),
    );
    return (releaseTicketsData ?? []).filter(
      ticket => ticket.ticketType === BaseTicketType.Release && !subTicketIds.has(ticket.id),
    );
  }, [releaseTicketsData, subTicketMappings]);

  const releaseTicketMap = useMemo(() => {
    const map = new Map<string, (typeof releaseTicketOptions)[number]>();
    (releaseTicketsById ?? []).forEach(ticket => map.set(ticket.id, ticket));
    (selectedReleaseTicketById ?? []).forEach(ticket => map.set(ticket.id, ticket));
    releaseTicketOptions.forEach(ticket => map.set(ticket.id, ticket));
    return map;
  }, [releaseTicketOptions, releaseTicketsById, selectedReleaseTicketById]);

  const rootCauseTicketMap = useMemo(() => {
    const map = new Map<string, (typeof rootCauseTicketsData)[number]>();
    (rootCauseTicketsData ?? []).forEach(ticket => map.set(ticket.id, ticket));
    (selectedRootCauseTicketById ?? []).forEach(ticket => map.set(ticket.id, ticket));
    (rootCauseTicketsById ?? []).forEach(ticket => map.set(ticket.id, ticket));
    return map;
  }, [rootCauseTicketsData, selectedRootCauseTicketById, rootCauseTicketsById]);

  const attributedSubTicketMap = useMemo(
    () => new Map(attributedSubTickets.map(subTicket => [subTicket.id, subTicket])),
    [attributedSubTickets],
  );

  const releaseItems = useMemo(
    () =>
      releaseTicketOptions.map(ticket => ({
        label: ticket.xyneId
          ? `${ticket.xyneId} · ${ticket.title || 'Release ticket'}`
          : ticket.title || 'Release ticket',
        value: ticket.id,
      })),
    [releaseTicketOptions],
  );

  const rootCauseTicketItems = useMemo(
    () =>
      (rootCauseTicketsData ?? []).map(ticket => ({
        label: ticket.xyneId
          ? `${ticket.xyneId} · ${ticket.title || 'Ticket'}`
          : ticket.title || 'Ticket',
        value: ticket.id,
      })),
    [rootCauseTicketsData],
  );

  const selectedReleaseItem = useMemo(() => {
    const ticket = releaseTicketMap.get(selectedReleaseId);
    if (!ticket) return null;
    return {
      label: ticket.xyneId
        ? `${ticket.xyneId} · ${ticket.title || 'Release ticket'}`
        : ticket.title || 'Release ticket',
      value: ticket.id,
    };
  }, [releaseTicketMap, selectedReleaseId]);

  const selectedRootCauseTicketItem = useMemo(() => {
    const ticket = rootCauseTicketMap.get(selectedRootCauseTicketId);
    if (!ticket) return null;
    return {
      label: ticket.xyneId
        ? `${ticket.xyneId} · ${ticket.title || 'Ticket'}`
        : ticket.title || 'Ticket',
      value: ticket.id,
    };
  }, [rootCauseTicketMap, selectedRootCauseTicketId]);

  const appReleaseItems = useMemo(() => {
    const subTickets =
      releaseSubTicketMappings?.map(mapping => mapping.subTicket).filter(Boolean) ?? [];
    const options = subTickets.map(subTicket => ({
      label: subTicket?.title || 'Application release',
      value: subTicket?.id || '',
    }));
    return options;
  }, [releaseSubTicketMappings]);

  const filteredAppReleaseItems = useMemo(() => {
    const query = appReleaseSearch.trim().toLowerCase();
    if (!query) return appReleaseItems;
    return appReleaseItems.filter(item => item.label.toLowerCase().includes(query));
  }, [appReleaseSearch, appReleaseItems]);

  const selectedAppReleaseItem = useMemo(
    () => appReleaseItems.find(item => item.value === selectedAppReleaseId) ?? null,
    [appReleaseItems, selectedAppReleaseId],
  );

  const selectedConfidenceItem = useMemo(
    () => confidenceOptions.find(option => option.value === confidence) ?? null,
    [confidence],
  );

  const handleAddMapping = async (): Promise<void> => {
    if (!selectedReleaseId) {
      toast.error('Select a release ticket to link');
      return;
    }

    const isDuplicate = releaseAttributions.some(
      attribution =>
        attribution.releaseId === selectedReleaseId &&
        (attribution.releaseApplicationId ?? null) === (selectedAppReleaseId || null) &&
        (attribution.rootCauseTicketId ?? null) === (selectedRootCauseTicketId || null),
    );
    if (isDuplicate) {
      toast.error('This release is already linked.');
      return;
    }

    setIsSaving(true);
    try {
      const mutationResult = zero.mutate(
        mutators.releaseAttribution.create({
          id: uuidv4(),
          ticketId,
          releaseId: selectedReleaseId,
          releaseApplicationId: selectedAppReleaseId || null,
          rootCauseTicketId: selectedRootCauseTicketId || null,
          confidence,
          timestamp: Date.now(),
        }),
      );
      const serverResult = await mutationResult.server;
      if (serverResult.type === 'error') {
        toast.error(serverResult.error.message || 'Failed to add release');
        return;
      }

      toast.success('Release linked to RCA');
      setSelectedAppReleaseId('');
      setSelectedRootCauseTicketId('');
      setConfidence(AttributionConfidence.LOW);
      setAppReleaseSearch('');
      setRootCauseTicketSearch('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add release');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteMapping = async (id: string): Promise<void> => {
    if (deletingId) return;
    setDeletingId(id);
    try {
      const mutationResult = zero.mutate(mutators.releaseAttribution.delete({ id }));
      const serverResult = await mutationResult.server;
      if (serverResult.type === 'error') {
        toast.error(serverResult.error.message || 'Failed to remove release mapping');
        return;
      }
      toast.success('Release mapping removed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove release mapping');
    } finally {
      setDeletingId(null);
    }
  };

  const handleContinue = (): void => {
    onPhaseChange('rca' as Phase);
  };

  return (
    <div className='h-full overflow-y-auto'>
      <div className='bg-white shadow-sm border border-gray-200 rounded-xl overflow-hidden'>
        {/* Header Section */}
        <div className='px-8 py-6 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-3'>
              <div className='h-10 w-10 rounded-lg bg-indigo-600 flex items-center justify-center'>
                <svg
                  className='h-5 w-5 text-white'
                  fill='none'
                  viewBox='0 0 24 24'
                  stroke='currentColor'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12'
                  />
                </svg>
              </div>
              <div>
                <h2 className='text-xl font-bold text-gray-900'>Attribution</h2>
                <p className='text-sm text-gray-500'>Optional: Add release tickets to this issue</p>
              </div>
            </div>
          </div>
        </div>

        {/* Form Section */}
        <div className='p-8 space-y-6'>
          <div className='space-y-1.5 w-full max-w-2xl'>
            <Combobox
              label='Release Ticket *'
              placeholder='Search release tickets'
              queryString={selectedReleaseItem?.label ?? releaseSearch}
              onInputValueChange={value => {
                if (value === '' && selectedReleaseItem) return;
                setReleaseSearch(value);
                if (selectedReleaseItem && value !== selectedReleaseItem.label) {
                  setSelectedReleaseId('');
                }
              }}
              items={releaseItems}
              value={selectedReleaseItem}
              onValueChange={value => {
                setSelectedReleaseId(value ?? '');
                setReleaseSearch('');
                setSelectedAppReleaseId('');
                setAppReleaseSearch('');
              }}
            />
          </div>

          <div className='space-y-1.5 w-full max-w-2xl'>
            <Combobox
              label='Application Release (optional)'
              placeholder={
                selectedReleaseId ? 'Search application releases' : 'Select a release ticket first'
              }
              queryString={selectedAppReleaseItem?.label ?? appReleaseSearch}
              onInputValueChange={value => {
                if (!selectedReleaseId) return;
                if (value === '' && selectedAppReleaseItem) return;
                setAppReleaseSearch(value);
                if (selectedAppReleaseItem && value !== selectedAppReleaseItem.label) {
                  setSelectedAppReleaseId('');
                }
              }}
              items={selectedReleaseId ? filteredAppReleaseItems : []}
              value={selectedAppReleaseItem}
              onValueChange={value => {
                setSelectedAppReleaseId(value ?? '');
                setAppReleaseSearch('');
              }}
            />
          </div>

          <div className='space-y-1.5 w-full max-w-2xl'>
            <Combobox
              label='Root Cause Ticket (optional)'
              placeholder='Search tickets'
              queryString={selectedRootCauseTicketItem?.label ?? rootCauseTicketSearch}
              onInputValueChange={value => {
                if (value === '' && selectedRootCauseTicketItem) return;
                setRootCauseTicketSearch(value);
                if (selectedRootCauseTicketItem && value !== selectedRootCauseTicketItem.label) {
                  setSelectedRootCauseTicketId('');
                }
              }}
              items={rootCauseTicketItems}
              value={selectedRootCauseTicketItem}
              onValueChange={value => {
                setSelectedRootCauseTicketId(value ?? '');
                setRootCauseTicketSearch('');
              }}
            />
          </div>

          <div className='space-y-1.5 w-full max-w-2xl'>
            <Combobox
              label='Confidence'
              placeholder='Select confidence'
              queryString={selectedConfidenceItem?.label ?? ''}
              onInputValueChange={() => {}}
              items={confidenceOptions}
              value={selectedConfidenceItem}
              onValueChange={value =>
                setConfidence((value as AttributionConfidence) ?? AttributionConfidence.LOW)
              }
            />
          </div>

          <Button
            type='button'
            className='gap-1'
            onClick={() => void handleAddMapping()}
            disabled={isSubmitting || isSaving}
          >
            <Plus className='h-4 w-4' />
            Add Release
          </Button>

          {/* Linked Releases Section */}
          <div className='pt-6 border-t border-gray-100'>
            <h4 className='text-base font-semibold text-gray-900 mb-4'>Linked Releases</h4>
            {releaseAttributions.length === 0 ? (
              <div className='text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-200'>
                <svg
                  className='h-10 w-10 text-gray-300 mx-auto mb-2'
                  fill='none'
                  viewBox='0 0 24 24'
                  stroke='currentColor'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={1.5}
                    d='M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12'
                  />
                </svg>
                <p className='text-sm text-gray-500'>No releases linked yet.</p>
              </div>
            ) : (
              <div className='space-y-3'>
                {releaseAttributions.map(attribution => {
                  const releaseTicket = releaseTicketMap.get(attribution.releaseId);
                  const appRelease = attribution.releaseApplicationId
                    ? attributedSubTicketMap.get(attribution.releaseApplicationId)
                    : null;
                  const rootCauseTicket = attribution.rootCauseTicketId
                    ? rootCauseTicketMap.get(attribution.rootCauseTicketId)
                    : null;
                  const releaseLabel = releaseTicket
                    ? releaseTicket.xyneId
                      ? `${releaseTicket.xyneId} · ${releaseTicket.title || 'Release ticket'}`
                      : releaseTicket.title || 'Release ticket'
                    : 'Release ticket';
                  const appLabel = appRelease?.title || 'Application release';
                  const rootCauseLabel = rootCauseTicket
                    ? rootCauseTicket.xyneId
                      ? `${rootCauseTicket.xyneId} · ${rootCauseTicket.title || 'Ticket'}`
                      : rootCauseTicket.title || 'Ticket'
                    : 'Ticket';

                  return (
                    <div key={attribution.id} className='border border-gray-200 rounded-lg p-4'>
                      <div className='flex items-start justify-between gap-3'>
                        <div className='space-y-2'>
                          <p className='text-sm font-semibold text-gray-900'>{releaseLabel}</p>
                          <div className='text-xs text-gray-600 space-y-1'>
                            {appLabel && (
                              <div>
                                <span className='font-medium'>App Release:</span> {appLabel}
                              </div>
                            )}
                            {rootCauseTicket && (
                              <div>
                                <span className='font-medium'>Root Cause Ticket:</span>{' '}
                                {rootCauseLabel}
                              </div>
                            )}
                            <div>
                              <span className='font-medium'>Confidence:</span>{' '}
                              {attribution.confidence}
                            </div>
                          </div>
                        </div>
                        <Button
                          type='button'
                          size='iconSm'
                          variant='ghost'
                          className='text-red-600 hover:text-red-700 hover:bg-red-50'
                          onClick={() => void handleDeleteMapping(attribution.id)}
                          loading={deletingId === attribution.id}
                          disabled={isSubmitting || deletingId !== null}
                          aria-label='Remove release mapping'
                        >
                          {deletingId !== attribution.id && <Trash2 className='h-3.5 w-3.5' />}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className='flex justify-end border-t border-gray-200 pt-6'>
            <Button type='button' onClick={handleContinue} disabled={isSubmitting}>
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
