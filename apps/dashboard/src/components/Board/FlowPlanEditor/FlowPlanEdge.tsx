import { X } from 'lucide-react';
import type { FC } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from 'reactflow';

export interface FlowPlanEdgeData {
  onDelete?: () => void;
}

/** Removable parent edge; derived entry/exit edges omit `onDelete`. */
export const FlowPlanEdge: FC<EdgeProps<FlowPlanEdgeData>> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}) => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        {...(markerEnd ? { markerEnd } : {})}
        {...(style ? { style } : {})}
      />
      {data?.onDelete && (
        <EdgeLabelRenderer>
          <button
            type='button'
            data-track-category='flow_plan_editor'
            data-track-name='delete_edge'
            title='Delete connection'
            onClick={event => {
              event.stopPropagation();
              data.onDelete?.();
            }}
            className='flow-plan-edge-delete nodrag nopan flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:border-red-400 hover:text-red-500'
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
          >
            <X size={10} />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
};
