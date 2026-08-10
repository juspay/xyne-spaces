import React, { Suspense } from 'react';
import type { ChartProps, FlowComponent } from '@xyne/shared';
import { ArtifactRenderBoundary } from './ArtifactRenderBoundary';

const ChartBody = React.lazy(() => import('./ChartBody'));

const CHART_HEIGHT_PX = 220;

export const ChartNode: React.FC<{ node: FlowComponent; children?: React.ReactNode }> = ({
  node,
}) => {
  const props = node.props as ChartProps | undefined;
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

  return (
    <section
      className='flow-artifact-wide flex w-full flex-col overflow-hidden rounded-xl border border-border bg-muted/40'
      style={node.style}
    >
      <div className='px-4 pb-2 pt-4'>
        <span className='font-mono text-sm leading-[18px] tracking-[0.2px] text-muted-foreground'>
          Chart
        </span>
      </div>

      <div className='border-t border-border px-2 pt-3'>
        <ArtifactRenderBoundary fallbackText={fallbackText}>
          <Suspense fallback={<div style={{ height: CHART_HEIGHT_PX }} />}>
            <ChartBody props={props} height={CHART_HEIGHT_PX} />
          </Suspense>
        </ArtifactRenderBoundary>
      </div>

      {props.caption && (
        <div className='border-t border-border bg-foreground/[0.03] px-4 py-3'>
          <p className='text-xs leading-[1.2] text-muted-foreground'>{props.caption}</p>
        </div>
      )}
    </section>
  );
};
