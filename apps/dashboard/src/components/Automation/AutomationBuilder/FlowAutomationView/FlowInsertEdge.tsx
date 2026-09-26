// The one custom edge type: a smooth-step edge carrying an optional branch label
// and the "insert a step here" + button.
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from 'reactflow';
import { cn } from '../../../../utils/classNames';
import { AddStepRow } from '../AddStepRow/AddStepRow';
import type { FlowEdgeData } from './FlowAutomationView.types';
import { TRACK_CATEGORY } from './FlowAutomationView.utils';

/* ─────────────────────────────── Edges ─────────────────────────────── */

/** Smooth-step edge with an optional branch label and an "insert step here" +. */
function InsertEdge({
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
}: EdgeProps<FlowEdgeData>): React.ReactElement {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });
  const insert = data?.insert;
  const canInsert = Boolean(insert && data && (!data.readOnly || data.onRequestEdit));
  const label = data?.label;
  const plusY = label ? labelY + 12 : labelY;
  const labelTop = canInsert ? labelY - 10 : labelY;
  const plusClass = cn(
    'nodrag nopan flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-opacity',
    'hover:border-foreground/40 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    data?.hovered || pickerOpen ? 'opacity-100' : 'opacity-0 hover:opacity-100',
  );
  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        {...(markerEnd ? { markerEnd } : {})}
        {...(style ? { style } : {})}
      />
      <EdgeLabelRenderer>
        {label && (
          <span
            className='pointer-events-none absolute rounded-full border border-border bg-background px-1.5 py-px text-[10px] font-medium text-muted-foreground'
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelTop}px)` }}
          >
            {label}
          </span>
        )}
        {canInsert && insert && data && (
          <div
            className='absolute'
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${plusY}px)`,
              pointerEvents: 'all',
            }}
          >
            {data.readOnly ? (
              <button
                type='button'
                aria-label='Insert step here'
                className={plusClass}
                data-track-category={TRACK_CATEGORY}
                data-track-name='edge-insert-request-edit'
                onClick={() => data.onRequestEdit?.()}
              >
                <Plus className='size-3' aria-hidden='true' />
              </button>
            ) : (
              <AddStepRow
                catalog={data.stepCatalog}
                onPick={type => data.onInsert(insert, type)}
                onOpenChange={setPickerOpen}
                trigger={
                  <button
                    type='button'
                    aria-label='Insert step here'
                    aria-haspopup='listbox'
                    className={plusClass}
                    data-track-category={TRACK_CATEGORY}
                    data-track-name='edge-insert-open'
                  >
                    <Plus className='size-3' aria-hidden='true' />
                  </button>
                }
              />
            )}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

export const edgeTypes = { insert: InsertEdge };
