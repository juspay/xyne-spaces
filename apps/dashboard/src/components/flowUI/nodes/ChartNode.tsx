import React, { Suspense, useContext, useState } from 'react';
import { MaximizeFourArrow } from '@xyne/icons';
import type { ChartProps, FlowComponent } from '@xyne/shared';
import { useFlow } from '../FlowContext';
import { ArtifactRenderBoundary } from './ArtifactRenderBoundary';
import { InsideWidgetPreviewContext, WidgetPreview } from './WidgetPreview';

const ChartBody = React.lazy(() => import('./ChartBody'));

const CHART_HEIGHT_PX = 220;
const CHART_PREVIEW_HEIGHT_PX = 420;

export const ChartNode: React.FC<{ node: FlowComponent; children?: React.ReactNode }> = ({
  node,
}) => {
  const props = node.props as ChartProps | undefined;
  const { conversationId } = useFlow();
  // A copy of this card lives inside its own widget-preview thread panel; hide the
  // Maximize there so it can't open a nested preview.
  const insidePreview = useContext(InsideWidgetPreviewContext);
  const [expanded, setExpanded] = useState(false);

  if (!props?.type) return null;
  const hasData =
    props.type === 'line' || props.type === 'area'
      ? props.series.length > 0
      : props.points.length > 0;
  if (!hasData) return null;

  const fallbackText =
    props.type === 'line' || props.type === 'area'
      ? props.series.map(point => `${point.x}: ${point.y}`).join('\n')
      : props.points.map(point => `${point.label}: ${point.value}`).join('\n');

  const chartView = (height: number): React.ReactNode => (
    <ArtifactRenderBoundary fallbackText={fallbackText}>
      <Suspense fallback={<div style={{ height }} />}>
        <ChartBody props={props} height={height} />
      </Suspense>
    </ArtifactRenderBoundary>
  );

  return (
    <section
      className='flow-artifact-wide flex w-full flex-col overflow-hidden rounded-xl border border-border bg-muted/40'
      style={node.style}
    >
      <div className='flex items-center justify-between gap-2 px-4 py-3'>
        <span className='font-mono text-sm leading-[18px] tracking-[0.2px] text-muted-foreground'>
          Chart
        </span>
        {!insidePreview && (
          <button
            type='button'
            onClick={() => setExpanded(true)}
            aria-label='Expand chart'
            className='shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
            data-track-category='CHART_ARTIFACT'
            data-track-name='EXPAND_CHART'
          >
            <MaximizeFourArrow size={16} className='shrink-0' />
          </button>
        )}
      </div>

      <div className='border-t border-border px-2 py-3'>{chartView(CHART_HEIGHT_PX)}</div>

      {props.caption && (
        <div className='border-t border-border bg-foreground/[0.03] px-4 py-3'>
          <p className='text-xs leading-[1.2] text-muted-foreground'>{props.caption}</p>
        </div>
      )}

      <WidgetPreview
        open={expanded}
        onOpenChange={setExpanded}
        idPrefix='chart-preview'
        label='Chart'
        title={props.caption ?? 'Chart'}
        description={props.caption ?? `${props.type} chart`}
        conversationId={conversationId ?? undefined}
        tracking={{ category: 'CHART_ARTIFACT', closeName: 'CLOSE_CHART_PREVIEW' }}
      >
        <div className='rounded-xl border border-border px-2 py-3'>
          {chartView(CHART_PREVIEW_HEIGHT_PX)}
        </div>
        {props.caption && (
          <p className='text-xs leading-[1.2] text-muted-foreground'>{props.caption}</p>
        )}
      </WidgetPreview>
    </section>
  );
};
