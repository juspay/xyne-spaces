import { ReactElement, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/classNames';
import { useRecallDigitalTwin } from '@/hooks/useClawDigitalTwin';
import { scoreToneClass } from '@/components/ClawAgents/digitalTwin/format';
import type { RecallResult } from '@/services/claw/digitalTwinTypes';

const DigitalTwinRecallTab = (): ReactElement => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RecallResult[] | null>(null);
  const recall = useRecallDigitalTwin();

  const submit = (): void => {
    const q = query.trim();
    if (!q) return;
    setResults(null);
    recall.mutate({ query: q, budget: 'mid' }, { onSuccess: setResults });
  };

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-col gap-2 rounded-lg border border-border bg-card p-3'>
        <span className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>
          Query
        </span>
        <textarea
          value={query}
          onChange={e => setQuery(e.target.value)}
          data-track-category='Claw Agents'
          data-track-name='Digital Twin recall query'
          placeholder='Ask a question your Twin might answer…'
          rows={3}
          className='w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none'
        />
        <div className='flex items-center justify-end'>
          <Button
            size='sm'
            disabled={!query.trim()}
            loading={recall.isPending}
            onClick={submit}
            data-track-category='Claw Agents'
            data-track-name='SUBMIT_DIGITAL_TWIN_RECALL'
          >
            <Search className='size-3.5' />
            {recall.isPending ? 'Recalling…' : 'Test recall'}
          </Button>
        </div>
      </div>

      {results && (
        <div className='flex flex-col gap-2'>
          <h4 className='text-xs font-medium text-foreground'>
            {results.length} result{results.length !== 1 ? 's' : ''}
          </h4>
          {results.length === 0 && (
            <p className='text-xs text-muted-foreground'>No memories recalled for this query</p>
          )}
          <div className='flex flex-col gap-1.5'>
            {results.map((r, i) => (
              <div key={r.id ?? i} className='rounded-lg border border-border bg-muted/40 p-2.5'>
                <p className='text-xs text-foreground'>{r.text ?? '—'}</p>
                <div className='mt-1.5 flex flex-wrap items-center gap-1.5'>
                  {r.fact_type && (
                    <span className='rounded border border-border px-1.5 py-px text-[10px] text-muted-foreground'>
                      {r.fact_type}
                    </span>
                  )}
                  {r.score !== undefined && (
                    <span
                      className={cn(
                        'text-[10px] font-medium tabular-nums',
                        scoreToneClass(r.score),
                      )}
                    >
                      {Math.round(r.score * 100)}% match
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default DigitalTwinRecallTab;
