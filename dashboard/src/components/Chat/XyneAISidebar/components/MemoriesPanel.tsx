import { ReactElement, useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Trash2, Brain, RefreshCw } from 'lucide-react';
import { apiInstance } from '../../../../services/clients/apiClient';
import { usePlatform } from '../../../../hooks/usePlatform';

interface Memory {
  id: string;
  memory: string;
  created_at?: string;
  updated_at?: string;
  score?: number;
}

interface MemoriesPanelProps {
  onClose: () => void;
}

export const MemoriesPanel = ({ onClose }: MemoriesPanelProps): ReactElement => {
  const { isMobile } = usePlatform();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchMemories = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiInstance.get<{ results: Memory[] }>('/xyne-ai/memories');
      setMemories(res.data.results ?? []);
    } catch {
      setError('Failed to load memories.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMemories();
  }, [fetchMemories]);

  const handleDeleteOne = (id: string): void => {
    setDeletingId(id);
    apiInstance
      .delete<void>(`/xyne-ai/memories/${id}`)
      .then(() => {
        setMemories(prev => prev.filter(m => m.id !== id));
      })
      .catch(() => {
        setError('Failed to delete memory.');
      })
      .finally(() => {
        setDeletingId(null);
      });
  };

  const handleClearAll = (): void => {
    setIsClearing(true);
    apiInstance
      .delete<void>('/xyne-ai/memories')
      .then(() => {
        setMemories([]);
      })
      .catch(() => {
        setError('Failed to clear memories.');
      })
      .finally(() => {
        setIsClearing(false);
      });
  };

  return (
    <div className='flex flex-col h-full'>
      {/* Header */}
      <div
        className={`h-14 px-4 flex items-center justify-between gap-2 self-stretch border-b border-border ${isMobile ? 'mt-[14px]' : ''}`}
      >
        <div className='flex items-center gap-2'>
          <button
            onClick={onClose}
            className='p-2 rounded-lg hover:bg-accent transition-colors'
            title='Back'
            data-track-category='XyneAI'
            data-track-name='MEMORIES_BACK'
          >
            <ArrowLeft size={16} />
          </button>
          <span className="text-foreground text-base font-semibold font-['Inter']">Memories</span>
        </div>
        <div className='flex items-center gap-1'>
          <button
            onClick={() => {
              void fetchMemories();
            }}
            disabled={isLoading}
            className='p-2 rounded-lg hover:bg-accent transition-colors disabled:opacity-50'
            title='Refresh'
            data-track-category='XyneAI'
            data-track-name='MEMORIES_REFRESH'
          >
            <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
          </button>
          {memories.length > 0 && (
            <button
              onClick={handleClearAll}
              disabled={isClearing}
              className='flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50'
              title='Clear all memories'
              data-track-category='XyneAI'
              data-track-name='MEMORIES_CLEAR_ALL'
            >
              <Trash2 size={13} />
              {isClearing ? 'Clearing…' : 'Clear all'}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className='flex-1 overflow-y-auto px-4 py-3'>
        {isLoading ? (
          <div className='space-y-3 mt-2'>
            {[1, 2, 3].map(i => (
              <div key={i} className='h-10 bg-muted rounded-lg animate-pulse' />
            ))}
          </div>
        ) : error ? (
          <div className='flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground'>
            <p className='text-sm'>{error}</p>
            <button
              onClick={() => {
                void fetchMemories();
              }}
              className='text-xs underline hover:text-foreground transition-colors'
              data-track-category='XyneAI'
              data-track-name='MEMORIES_RETRY'
            >
              Try again
            </button>
          </div>
        ) : memories.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-40 gap-3 text-muted-foreground'>
            <Brain size={32} className='opacity-30' />
            <p className='text-sm'>No memories stored yet.</p>
            <p className='text-xs text-center max-w-[200px]'>
              Ask AI will remember things you share across sessions.
            </p>
          </div>
        ) : (
          <ul className='space-y-2'>
            {memories.map(mem => (
              <li
                key={mem.id}
                className='group flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-muted/50 border border-border/50 hover:border-border transition-colors'
              >
                <Brain size={13} className='mt-0.5 shrink-0 text-muted-foreground' />
                <span className='flex-1 text-sm text-foreground leading-snug'>{mem.memory}</span>
                <button
                  onClick={() => handleDeleteOne(mem.id)}
                  disabled={deletingId === mem.id}
                  className='shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all disabled:opacity-50'
                  title='Delete this memory'
                  data-track-category='XyneAI'
                  data-track-name='MEMORIES_DELETE_ONE'
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
