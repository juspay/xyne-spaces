import { ReactElement, useState } from 'react';
import { ListDefault, SearchDefault } from '@xyne/icons';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/classNames';
import { DetailCard } from '@/routes/AIScreen/library/shared/primitives/DetailPrimitives';
import { useRecallDigitalTwin } from '@/hooks/useClawDigitalTwin';
import { MetaRow } from '@/routes/AIScreen/library/shared/primitives/MetaRow';
import { SettingCardHeader } from '../components/SettingCardHeader';
import { scoreToneClass } from '../components/format';
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
    <div className='flex w-full flex-col gap-3'>
      <DetailCard>
        <SettingCardHeader
          icon={SearchDefault}
          title='Test recall'
          description='Runs the same retrieval your Twin uses when drafting a reply. Nothing is saved.'
        />
        <div className='flex flex-col gap-4 p-4'>
          <textarea
            value={query}
            onChange={e => setQuery(e.target.value)}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin recall query'
            placeholder='Ask a question your Twin might answer…'
            rows={3}
            className='w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none'
          />
          <div className='flex justify-end'>
            <Button
              size='sm'
              disabled={!query.trim()}
              loading={recall.isPending}
              onClick={submit}
              data-track-category='Claw Agents'
              data-track-name='Digital Twin run recall'
            >
              {!recall.isPending && <SearchDefault className='size-4' aria-hidden />}
              {recall.isPending ? 'Recalling…' : 'Test recall'}
            </Button>
          </div>
        </div>
      </DetailCard>

      {results && (
        <DetailCard>
          <SettingCardHeader
            icon={ListDefault}
            title='Results'
            description={
              results.length === 0
                ? 'No memories were recalled for this query.'
                : `${results.length} memor${results.length === 1 ? 'y' : 'ies'} your Twin would draw on.`
            }
            divided={results.length > 0}
          />
          {results.length > 0 && (
            <ul className='flex flex-col px-4'>
              {results.map((result, index) => (
                <li
                  key={result.id ?? index}
                  className='flex flex-col gap-1 border-b border-border py-4 last:border-b-0'
                >
                  <p className='text-sm leading-relaxed text-foreground'>{result.text ?? '—'}</p>
                  <MetaRow
                    items={[
                      result.fact_type && <span key='type'>{result.fact_type}</span>,
                      result.score !== undefined && (
                        <span
                          key='score'
                          className={cn('font-medium tabular-nums', scoreToneClass(result.score))}
                        >
                          {Math.round(result.score * 100)}% match
                        </span>
                      ),
                    ]}
                  />
                </li>
              ))}
            </ul>
          )}
        </DetailCard>
      )}
    </div>
  );
};

export default DigitalTwinRecallTab;
