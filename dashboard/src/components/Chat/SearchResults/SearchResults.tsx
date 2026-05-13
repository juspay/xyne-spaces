import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { Loader2, MessageCircle, X, ChevronLeft, ChevronRight } from 'lucide-react';
import ThreadMessages from '../ThreadPannel';
import { UserProfile } from '../../ui/UserProfile/UserProfile';
import { usePlatform } from '../../../hooks/usePlatform';
import { useAuth } from '../../../hooks/useAuth';
import { useSearchResultsScreen } from '../../../hooks/useSearchResultsScreen';
import { DisplaySearchResult } from '../../../types/search';
import { SearchResultMessageCard } from './SearchResultMessageCard';
import { SearchResultsContext, SearchResultsThread } from './SearchResultsContext';

type SidePanelState =
  | { kind: 'thread'; thread: SearchResultsThread }
  | { kind: 'profile'; userId: string }
  | null;

const SearchResults = (): ReactElement => {
  const [searchParams] = useSearchParams();
  const { isMobile } = usePlatform();
  const [selectedPanel, setSelectedPanel] = useState<SidePanelState>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const query = searchParams.get('query')?.trim() ?? '';
  const { results, totalCount, totalPages, currentPage, isLoading, error, goToPage } =
    useSearchResultsScreen(query);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [currentPage, query]);

  const handleSelectThread = useCallback((thread: SearchResultsThread) => {
    setSelectedPanel({ kind: 'thread', thread });
  }, []);
  const handleSelectUser = useCallback((userId: string) => {
    setSelectedPanel({ kind: 'profile', userId });
  }, []);
  const handleClosePanel = (): void => setSelectedPanel(null);

  const contextValue = useMemo(
    () => ({ onSelectThread: handleSelectThread, onSelectUser: handleSelectUser }),
    [handleSelectThread, handleSelectUser],
  );

  const resultsColumn = (
    <div className='flex flex-col h-full min-h-0'>
      {query && (
        <header className='py-4 border-b border-border shrink-0'>
          <h1 className='mx-auto w-full max-w-4xl px-4 text-lg font-semibold text-foreground'>
            Results for <span className='text-muted-foreground'>{`"${query}"`}</span>
            {!isLoading && totalCount > 0 && (
              <span className='ml-2 text-sm font-normal text-muted-foreground'>({totalCount})</span>
            )}
          </h1>
        </header>
      )}
      <div ref={scrollRef} className='flex-1 min-h-0 overflow-y-auto mt-4'>
        <ResultsBody
          query={query}
          isLoading={isLoading}
          error={error}
          results={results}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={goToPage}
        />
      </div>
    </div>
  );

  return (
    <SearchResultsContext.Provider value={contextValue}>
      <div
        className='h-full flex flex-col relative bg-background md:rounded-2xl overflow-hidden shadow-md'
        data-id='search-results-screen'
      >
        <div className='flex-1 flex min-h-0 relative'>
          {isMobile ? (
            <MobileLayout
              selectedPanel={selectedPanel}
              onClose={handleClosePanel}
              resultsColumn={resultsColumn}
            />
          ) : (
            <DesktopLayout
              selectedPanel={selectedPanel}
              onClose={handleClosePanel}
              resultsColumn={resultsColumn}
            />
          )}
        </div>
      </div>
    </SearchResultsContext.Provider>
  );
};
export default SearchResults;

// —— Inline subcomponents (file-local, not reused) ———

interface ResultsBodyProps {
  query: string;
  isLoading: boolean;
  error: string | null;
  results: DisplaySearchResult[];
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

function ResultsBody({
  query,
  isLoading,
  error,
  results,
  currentPage,
  totalPages,
  onPageChange,
}: ResultsBodyProps): ReactElement {
  if (!query) {
    return <EmptyState title='Type a query to search' />;
  }
  if (isLoading) {
    return (
      <div className='flex items-center justify-center h-full'>
        <Loader2 className='animate-spin text-muted-foreground' size={32} />
      </div>
    );
  }
  if (error) {
    return (
      <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
        <p className='text-destructive text-base font-semibold mb-2'>Search failed</p>
        <p className='text-muted-foreground text-sm'>{error}</p>
      </div>
    );
  }
  if (results.length === 0) {
    return <EmptyState title='No results found' subtitle={`Nothing matched "${query}"`} />;
  }

  return (
    <div className='mx-auto w-full max-w-4xl space-y-2 px-4 pt-8 pb-6'>
      {results.map(result => {
        const ctx = result.searchContext;
        if (!ctx?.channelId || !ctx?.conversationId) return null;
        return (
          <SearchResultMessageCard
            key={`${result.type}-${result.id}`}
            channelId={ctx.channelId}
            conversationId={ctx.conversationId}
            matchedMessageId={ctx.messageId ?? null}
          />
        );
      })}
      {totalPages > 1 && (
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={onPageChange} />
      )}
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle?: string }): ReactElement {
  return (
    <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
      <MessageCircle className='text-muted-foreground mb-4' size={64} />
      <p className='text-muted-foreground text-xl font-semibold mb-2'>{title}</p>
      {subtitle && <p className='text-muted-foreground text-sm'>{subtitle}</p>}
    </div>
  );
}

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps): ReactElement {
  return (
    <div className='pt-6 flex items-center justify-center gap-2'>
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        className='p-1.5 rounded-full border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed'
        data-track-category='SEARCH_RESULTS'
        data-track-name='PAGINATION_PREV'
      >
        <ChevronLeft size={14} />
      </button>
      <span className='text-sm text-muted-foreground px-1'>
        {currentPage} / {totalPages}
      </span>
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className='p-1.5 rounded-full border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed'
        data-track-category='SEARCH_RESULTS'
        data-track-name='PAGINATION_NEXT'
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

interface LayoutProps {
  selectedPanel: SidePanelState;
  onClose: () => void;
  resultsColumn: ReactElement;
}

function MobileLayout({ selectedPanel, onClose, resultsColumn }: LayoutProps): ReactElement {
  return (
    <>
      <div className='flex-1 min-w-0 flex flex-col min-h-0'>{resultsColumn}</div>
      {selectedPanel && (
        <div className='absolute inset-0 z-20 bg-background flex flex-col animate-slide-in-from-right'>
          {selectedPanel.kind === 'thread' && (
            <div className='flex items-center justify-end p-2 border-b border-border'>
              <button
                onClick={onClose}
                className='p-2 rounded-md hover:bg-accent'
                aria-label='Close thread'
                data-track-category='SEARCH_RESULTS'
                data-track-name='CLOSE_THREAD_PANEL'
              >
                <X size={18} />
              </button>
            </div>
          )}
          <div className='flex-1 min-h-0'>
            <SearchResultsSidePanel panel={selectedPanel} onClose={onClose} />
          </div>
        </div>
      )}
    </>
  );
}

function DesktopLayout({ selectedPanel, onClose, resultsColumn }: LayoutProps): ReactElement {
  return (
    <PanelGroup direction='horizontal' className='h-full' autoSaveId='search-results-thread'>
      <Panel defaultSize={selectedPanel ? 60 : 100} minSize={selectedPanel ? 30 : 100}>
        <div className='h-full'>{resultsColumn}</div>
      </Panel>
      {selectedPanel && (
        <>
          <PanelResizeHandle className='w-1 hover:bg-blue-50 active:bg-blue-100 transition-colors duration-200 cursor-col-resize flex items-center justify-center group'>
            <div className='w-[1px] h-full bg-border' />
          </PanelResizeHandle>
          <Panel defaultSize={40} minSize={25}>
            <div className='h-full animate-slide-in-from-right'>
              <SearchResultsSidePanel panel={selectedPanel} onClose={onClose} />
            </div>
          </Panel>
        </>
      )}
    </PanelGroup>
  );
}

function SearchResultsSidePanel({
  panel,
  onClose,
}: {
  panel: NonNullable<SidePanelState>;
  onClose: () => void;
}): ReactElement {
  const { user: currentUser } = useAuth();

  return (
    <div className='h-full flex flex-col min-h-0 bg-background'>
      {panel.kind === 'thread' ? (
        <ThreadMessages
          channelId={panel.thread.channelId}
          conversationId={panel.thread.conversationId}
          onClose={onClose}
        />
      ) : (
        <>
          <div className='flex items-center justify-end p-2 border-b border-border shrink-0'>
            <button
              onClick={onClose}
              className='p-2 rounded-md hover:bg-accent'
              aria-label='Close profile'
              data-track-category='SEARCH_RESULTS'
              data-track-name='CLOSE_PROFILE_PANEL'
            >
              <X size={18} />
            </button>
          </div>
          <div className='flex-1 min-h-0 overflow-y-auto'>
            <UserProfile
              userId={panel.userId}
              isOwnProfile={currentUser?.id === panel.userId}
              className='border-0 rounded-none shadow-none'
            />
          </div>
        </>
      )}
    </div>
  );
}
