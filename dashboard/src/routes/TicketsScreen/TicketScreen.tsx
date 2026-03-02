import { ReactElement, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import TicketHeader, { TicketFilters } from '../../components/Tickets/TicketHeader';
import TicketTable from '../../components/Tickets/TicketTable';

const LAST_WORKFLOW_PATH_KEY = 'last-viewed-workflow-path';

const TicketsScreen = (): ReactElement => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [shouldRedirect, setShouldRedirect] = useState(true);
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
    return <div className='h-full bg-gray-50' />;
  }

  return (
    <div className='h-full bg-gray-50 rounded-lg shadow-[0_0_8px_0_rgba(0,0,0,0.15)]'>
      <main className='mx-auto py-6 sm:px-6 lg:px-8'>
        <div className='px-4 py-6 sm:px-0'>
          <div className='bg-white rounded-lg shadow'>
            <div className='px-6 py-4'>
              <TicketHeader filters={filters} onFiltersChange={setFilters} />
              <TicketTable filters={filters} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default TicketsScreen;
