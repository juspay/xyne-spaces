import { ReactElement, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Plus } from 'lucide-react';
import type { QueryVisualizationType } from '@xyne/shared';
import { previewQueryPlan } from '../../../services/DynamicDashboard/previewService';
import { getRendererForType } from '../ComponentGrid/renderers';
import { Button } from '../../ui/Button/Button';

export interface DrillResultBubbleProps {
  title: string;
  visualType: QueryVisualizationType;
  queryPlan: unknown;
  onAdd: (args: {
    title: string;
    visualType: QueryVisualizationType;
    queryPlan: unknown;
  }) => Promise<boolean>;
}

export const DrillResultBubble = ({
  title,
  visualType,
  queryPlan,
  onAdd,
}: DrillResultBubbleProps): ReactElement => {
  const [added, setAdded] = useState(false);
  const [adding, setAdding] = useState(false);
  const query = useQuery({
    queryKey: ['drill-preview', visualType, JSON.stringify(queryPlan)],
    queryFn: ({ signal }) => previewQueryPlan({ plan: queryPlan, visualType }, signal),
    staleTime: 60_000,
  });

  const Renderer = getRendererForType(visualType);

  return (
    <div className='rounded-lg border border-border bg-card p-3'>
      <div className='mb-2 text-sm font-medium text-foreground'>{title}</div>
      {query.isLoading && <div className='text-xs text-muted-foreground'>Running…</div>}
      {query.isError && (
        <div className='text-xs text-destructive'>Could not run this breakdown.</div>
      )}
      {query.data && Renderer && (
        <div className='h-56'>
          <Renderer data={query.data.data} title={title} />
        </div>
      )}
      {query.data && !Renderer && (
        <div className='text-xs text-muted-foreground'>No preview available for {visualType}.</div>
      )}
      <Button
        variant='ghost'
        type='button'
        disabled={added || adding}
        trackId='add_drill_to_dashboard'
        onClick={() => {
          setAdding(true);
          void onAdd({ title, visualType, queryPlan })
            .then(ok => setAdded(ok))
            .catch(() => setAdded(false))
            .finally(() => setAdding(false));
        }}
        className='mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 disabled:text-muted-foreground disabled:hover:text-muted-foreground'
        data-track-category='DYNAMIC_DASHBOARD'
        data-track-name='Add_Drill_To_Dashboard'
      >
        {added ? <Check size={12} /> : <Plus size={12} />}
        {added ? 'Added to dashboard' : adding ? 'Adding…' : 'Add to dashboard'}
      </Button>
    </div>
  );
};
