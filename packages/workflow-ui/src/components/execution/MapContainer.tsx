import type { ExecutionDetail } from '@xyne/workflow-sdk/client';
import type { StepExecutionState } from '../../utils/step-state.js';
import { buildIterations } from '../../utils/iterations.js';
import { getCategoryTheme } from '../builder/theme.js';
import { cn } from '../shared/cn.js';

interface MapContainerProps {
  /** Config id of the MAP step — used to match its iteration records. */
  mapStepId: string;
  /** Raw execution records; iteration lanes are derived from these. */
  records: ExecutionDetail['steps'] | undefined;
  category?: string | undefined;
  /** Box header label (e.g. "Map"). */
  label?: string | undefined;
  /**
   * Render one lane's body. `states`/`records` are scoped to that iteration
   * (frame-stripped); `index` is the source-array position; `prefix` is the
   * iteration's node-path frame (`owners_map:item#0/`) used to build per-lane
   * selection ids.
   */
  renderLane: (
    states: Map<string, StepExecutionState>,
    records: ExecutionDetail['steps'] | undefined,
    index: number,
    prefix: string,
  ) => React.ReactNode;
}

/**
 * Execution-only container that renders each concurrent MAP iteration as its own
 * lane, side-by-side (like PARALLEL) — but the lanes are dynamic: their count and
 * contents come from runtime records, not static config branches.
 *
 * Before any iteration record exists (MAP not yet reached / source empty) we show
 * the body template once with empty states, so the step still reads structurally.
 */
export function MapContainer({
  mapStepId,
  records,
  category,
  label,
  renderLane,
}: MapContainerProps) {
  const theme = getCategoryTheme(category);
  const iters = buildIterations(mapStepId, records);
  const laneCount = Math.max(iters.length, 1);

  const headerLabel =
    iters.length > 0
      ? `${label ?? 'Map'} · ${iters.length} item${iters.length === 1 ? '' : 's'} concurrently`
      : `${label ?? 'Map'} · per item (concurrent)`;

  return (
    <div className="flex flex-col items-center">
      <div
        className="relative rounded-xl border-2 border-dashed px-6 bg-gradient-to-b from-slate-50/80 to-white"
        style={{ borderColor: `${theme.edgeColor}40` }}
      >
        {/* Header badge */}
        <div
          className={cn(
            'absolute -top-3 left-4 flex items-center gap-1.5 rounded-full px-2.5 py-0.5',
            'text-[10px] font-semibold uppercase tracking-wider',
            theme.iconBg,
            theme.iconText,
          )}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="2 7 12 12 22 7" /><polyline points="2 12 12 17 22 12" /><polyline points="2 17 12 22 22 17" />
          </svg>
          {headerLabel}
        </div>

        {/* Spur into the fork bar */}
        <div className="mx-auto h-4 w-px bg-slate-300" />

        {/* Fork bar */}
        <div
          className="h-px rounded-full"
          style={{ backgroundColor: theme.edgeColor, opacity: 0.4, width: '100%', minWidth: `${laneCount * 200}px` }}
        />

        {/* Lanes — one per runtime iteration (items-stretch so all reach the merge bar) */}
        <div className="flex items-stretch gap-4">
          {iters.length > 0 ? (
            iters.map((it) => (
              <div key={it.index} className="flex flex-col items-center" style={{ minWidth: '200px' }}>
                <div className={cn('mb-2 mt-1 rounded-full px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wider', theme.lightBg, theme.iconText)}>
                  Item {it.index}
                </div>
                <div className="h-4 w-px bg-slate-300" />
                <div className="flex flex-col items-center">{renderLane(it.states, it.records, it.index, it.prefix)}</div>
                <div className="min-h-[16px] w-px flex-1 bg-slate-300" />
              </div>
            ))
          ) : (
            // Not started yet — show the body template once with empty states.
            <div className="flex flex-col items-center" style={{ minWidth: '200px' }}>
              <div className={cn('mb-2 mt-1 rounded-full px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wider', theme.lightBg, theme.iconText)}>
                Each item
              </div>
              <div className="h-4 w-px bg-slate-300" />
              <div className="flex flex-col items-center">{renderLane(new Map(), records, 0, '')}</div>
              <div className="min-h-[16px] w-px flex-1 bg-slate-300" />
            </div>
          )}
        </div>

        {/* Merge bar */}
        <div
          className="h-px rounded-full"
          style={{ backgroundColor: theme.edgeColor, opacity: 0.4, width: '100%', minWidth: `${laneCount * 200}px` }}
        />
        <div className="mx-auto h-4 w-px bg-slate-300" />
      </div>

      {/* Merge point into the next connector */}
      <div className="h-4 w-px bg-slate-300" />
    </div>
  );
}
