import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import type { ApprovalAnalyticsResult } from '@xyne/workflow-sdk/client';
import { DashboardPanel, PanelSkeleton } from './DashboardPanel.js';

interface Slice {
  label: string;
  value: number;
  color: string;
}

/**
 * A ring with a figure in the hole and a legend beside it. Slices must add up
 * to the whole — a ring that does not is a picture of nothing.
 */
function Ring({ slices, center, caption }: { slices: Slice[]; center: string; caption: string }) {
  const shown = slices.filter((s) => s.value > 0);
  return (
    // Ring above its legend, centred in whatever height the card is given —
    // the two cards split the dashboard's left column between them.
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-5 py-6">
      <div className="relative h-[180px] w-[180px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={shown.length > 0 ? shown : [{ label: 'none', value: 1, color: 'var(--wui-bg-muted)' }]}
              dataKey="value"
              nameKey="label"
              innerRadius={62}
              outerRadius={86}
              paddingAngle={shown.length > 1 ? 2 : 0}
              stroke="none"
              // The ring draws itself in when the dashboard opens.
              startAngle={90}
              endAngle={-270}
              animationDuration={900}
              animationEasing="ease-out"
            >
              {(shown.length > 0 ? shown : [{ label: 'none', color: 'var(--wui-bg-muted)' }]).map((s) => (
                <Cell key={s.label} fill={s.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {/* Centred over the hole rather than a chart label — simpler to style. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[28px] font-bold tabular-nums leading-none text-[var(--wui-fg)]">{center}</span>
          <span className="mt-1.5 text-[11px] text-[var(--wui-fg-muted)]">{caption}</span>
        </div>
      </div>
      <ul className="flex w-full flex-col gap-2.5">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-[13px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate text-[var(--wui-fg-muted)]">{s.label}</span>
            <span className="font-semibold tabular-nums text-[var(--wui-fg)]">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-5">
      <PanelSkeleton className="h-[180px] w-[180px] rounded-full" />
      <div className="flex w-full flex-col gap-2.5">
        <PanelSkeleton className="h-3 w-full" />
        <PanelSkeleton className="h-3 w-full" />
      </div>
    </div>
  );
}

/** Approvals decided in the last 4 weeks: before or after their deadline. */
export function ApprovalTimelinessCard({
  data,
  isLoading,
  error,
}: {
  data: ApprovalAnalyticsResult | undefined;
  isLoading: boolean;
  error: Error | null;
}) {
  const decided = (data?.onTime ?? 0) + (data?.late ?? 0);
  return (
    <DashboardPanel title="Approvals · last 4 weeks" fill className="min-h-0 flex-1">
      {isLoading ? (
        <Loading />
      ) : error || !data ? (
        <p className="my-auto px-4 py-8 text-center text-[12px] text-[var(--wui-fg-muted)]">Couldn’t load approval stats.</p>
      ) : decided === 0 ? (
        <p className="my-auto px-4 py-8 text-center text-[12px] text-[var(--wui-fg-muted)]">No approvals decided in the last 4 weeks.</p>
      ) : (
        <Ring
          center={`${String(Math.round((data.onTime / decided) * 100))}%`}
          caption="on time"
          slices={[
            { label: 'On time', value: data.onTime, color: 'var(--wui-status-completed)' },
            { label: 'Late', value: data.late, color: 'var(--wui-status-paused)' },
          ]}
        />
      )}
    </DashboardPanel>
  );
}

/** What is waiting right now, by how close its deadline is. */
export function PendingApprovalsRingCard({
  total,
  overdue,
  dueToday,
  dueSoon,
}: {
  total: number | undefined;
  overdue: number | undefined;
  dueToday: number | undefined;
  dueSoon: number | undefined;
}) {
  const loading = total === undefined || overdue === undefined || dueToday === undefined || dueSoon === undefined;
  return (
    <DashboardPanel title="Pending approvals" fill className="min-h-0 flex-1">
      {loading ? (
        <Loading />
      ) : (
        <Ring
          center={String(total)}
          caption="pending"
          slices={[
            { label: 'Overdue', value: overdue, color: 'var(--wui-status-failed)' },
            { label: 'Due today', value: dueToday, color: 'var(--wui-status-paused)' },
            { label: 'Due in 2 days', value: dueSoon, color: 'var(--wui-status-running)' },
            // Everything else — a later deadline or none — so the ring adds up to the total.
            { label: 'Later', value: Math.max(0, total - overdue - dueToday - dueSoon), color: 'var(--wui-status-skipped)' },
          ]}
        />
      )}
    </DashboardPanel>
  );
}
