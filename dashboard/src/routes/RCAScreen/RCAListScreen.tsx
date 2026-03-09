import { useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useUsers } from '../../hooks/useUsers';
import { queries } from '../../zero/queries';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { RCASidebar } from './components';
import type { RCARecord } from './RCAScreen.types';
import { LookupType } from '@xyne/shared';

const ITEMS_PER_PAGE = 50;

const RCAListScreen = () => {
  const navigate = useNavigate();
  const users = useUsers();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentPage = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));

  const cursorHistoryRef = useRef<{ createdAt: number; id: string }[]>([]);

  useEffect(() => {
    const stored = sessionStorage.getItem('rcaCursorHistory');
    if (!stored) return;
    try {
      cursorHistoryRef.current = JSON.parse(stored) as { createdAt: number; id: string }[];
    } catch {
      cursorHistoryRef.current = [];
    }
  }, []);

  const startCursor = useMemo(() => {
    if (currentPage <= 1) return null;
    const stored = sessionStorage.getItem('rcaCursorHistory');
    if (!stored) return null;

    try {
      const history = JSON.parse(stored) as { createdAt: number; id: string }[];
      return history[currentPage - 2] ?? null;
    } catch {
      return null;
    }
  }, [currentPage]);

  const [paginatedRecords] = useCachedQuery(
    queries.allRCAsPaginated({
      limit: ITEMS_PER_PAGE,
      start: startCursor,
    }),
  );

  const [bugTypesDataRaw] = useCachedQuery(
    queries.lookupValuesByType({ type: LookupType.BUG_TYPE }),
  );
  const bugTypesData = bugTypesDataRaw ?? [];
  const bugTypeValueById = useMemo(
    () => new Map(bugTypesData.map((lt: { id: string; value: string }) => [lt.id, lt.value])),
    [bugTypesData],
  );

  const ownerItems = useMemo(
    () => users.map(user => ({ label: user.name || user.email, value: user.id })),
    [users],
  );

  const records = paginatedRecords ?? [];
  const hasNextPage = records.length === ITEMS_PER_PAGE;
  const hasPreviousPage = currentPage > 1;
  const isSidebarLoading = paginatedRecords === undefined;

  const handleNextPage = () => {
    if (hasNextPage && records.length > 0) {
      const lastRecord = records[records.length - 1];
      if (lastRecord) {
        cursorHistoryRef.current[currentPage - 1] = {
          createdAt: lastRecord.createdAt,
          id: lastRecord.id,
        };
        sessionStorage.setItem('rcaCursorHistory', JSON.stringify(cursorHistoryRef.current));
      }
      setSearchParams({ page: String(currentPage + 1) });
    }
  };

  const handlePreviousPage = () => {
    if (hasPreviousPage) {
      setSearchParams({ page: String(currentPage - 1) });
    }
  };

  const handleRecordClick = (record: RCARecord) => {
    void navigate(`/rca/${record.id}`);
  };

  return (
    <div className='h-full bg-muted' data-id='rca-list-screen'>
      <section className='h-full flex flex-1 min-h-0 p-4 md:p-6'>
        <RCASidebar
          records={records}
          ownerItems={ownerItems}
          bugTypeValueById={bugTypeValueById}
          isLoading={isSidebarLoading}
          isSubmitting={false}
          onRecordClick={handleRecordClick}
          itemsPerPage={ITEMS_PER_PAGE}
          hasNextPage={hasNextPage}
          hasPreviousPage={hasPreviousPage}
          onNextPage={handleNextPage}
          onPreviousPage={handlePreviousPage}
        />
      </section>
    </div>
  );
};

RCAListScreen.displayName = 'RCAListScreen';

export default RCAListScreen;
