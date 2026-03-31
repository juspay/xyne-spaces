import { ReactElement, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import TicketHeader, { TicketFilters, ViewMode } from '../../components/Tickets/TicketHeader';
import TicketTable from '../../components/Tickets/TicketTable';

import { LAST_WORKFLOW_PATH_KEY } from '../../components/Tickets/constants';

const TicketsScreen = (): ReactElement => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [shouldRedirect, setShouldRedirect] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('ticket-screen-view-mode');
    return saved === 'list' || saved === 'table' ? saved : 'table';
  });

  useEffect(() => {
    localStorage.setItem('ticket-screen-view-mode', viewMode);
  }, [viewMode]);
  const [filters, setFilters] = useState<TicketFilters>(() => {
    const saved = localStorage.getItem('ticket-screen-filters');
    if (saved) {
      try {
        const parsed: unknown = JSON.parse(saved);
        if (parsed !== null && typeof parsed === 'object' && 'dateRangeFilter' in parsed) {
          const dateRangeFilter = (parsed as { dateRangeFilter: unknown }).dateRangeFilter;
          if (
            dateRangeFilter !== null &&
            typeof dateRangeFilter === 'object' &&
            dateRangeFilter !== undefined
          ) {
            const dr = dateRangeFilter as Record<string, unknown>;
            if (typeof dr['startDate'] === 'string') {
              dr['startDate'] = new Date(dr['startDate']);
            }
            if (typeof dr['endDate'] === 'string') {
              dr['endDate'] = new Date(dr['endDate']);
            }
          }
        }
        return parsed as TicketFilters;
      } catch (e) {
        console.error('Failed to parse filters from local storage', e);
      }
    }
    return {
      searchQuery: '',
      statusFilter: [],
      workflowTypeFilter: [],
      environmentFilter: [],
      createdByFilter: [],
      assignedToFilter: [],
      dateRangeFilter: null,
    };
  });

  useEffect(() => {
    localStorage.setItem('ticket-screen-filters', JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    if (searchParams.get('clear') === 'true') {
      sessionStorage.removeItem(LAST_WORKFLOW_PATH_KEY);
      setShouldRedirect(false);
      return;
    }

    const lastWorkflowPath = sessionStorage.getItem(LAST_WORKFLOW_PATH_KEY);
    if (lastWorkflowPath) {
      void navigate(lastWorkflowPath, { replace: true });
    } else {
      setShouldRedirect(false);
    }
  }, [searchParams, navigate]);

  if (shouldRedirect) {
    return <div data-id='tickets-screen-redirect-placeholder' className='h-full bg-background' />;
  }

  return (
    <div
      data-id='tickets-screen-container'
      className='h-full bg-background md:rounded-2xl overflow-hidden shadow-md flex flex-col gap-4'
    >
      <TicketHeader
        filters={filters}
        onFiltersChange={setFilters}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />
      <TicketTable filters={filters} viewMode={viewMode} />
    </div>
  );
};

export default TicketsScreen;
