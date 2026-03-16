import { ReactElement, useState } from 'react';
import MemoryHeader from '../../components/Memory/MemoryHeader';
import MemoryTable from '../../components/Memory/MemoryTable';
import { MemoryScope, MemoryFilters } from '../../types/memory';

const MemoryScreen = (): ReactElement => {
  const [filters, setFilters] = useState<MemoryFilters>({
    searchQuery: '',
    includeQuery: true,
    includeSummary: true,
    scope: MemoryScope.MY,
    docTypeFilter: [],
    tagsFilter: '',
    repoUrlFilter: '',
    commitIdFilter: '',
    sessionIdFilter: '',
    filePointersFilter: '',
    ticketIdFilter: '',
  });

  return (
    <div className='h-full bg-muted rounded-lg shadow-[0_0_8px_0_rgba(0,0,0,0.15)]'>
      <main className='mx-auto py-6 sm:px-6 lg:px-8'>
        <div className='px-4 py-6 sm:px-0'>
          <div className='bg-background rounded-lg shadow'>
            <div className='px-6 py-4'>
              <MemoryHeader filters={filters} onFiltersChange={setFilters} />
              <MemoryTable filters={filters} enableCompare={filters.scope === MemoryScope.MY} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default MemoryScreen;
