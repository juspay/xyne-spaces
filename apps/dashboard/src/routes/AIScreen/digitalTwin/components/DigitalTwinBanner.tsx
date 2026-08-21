import { ReactElement } from 'react';
import { AlertTriangle, Brain, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { cn } from '@/utils/classNames';
import type { DigitalTwinStatus } from '@/services/claw/digitalTwinTypes';

const LABEL_TOOLTIP =
  'Your personal AI. When someone mentions you, the Twin drafts a reply on your behalf, grounded in memories you approved. Every memory passes through your review queue first.';

const InfoDot = ({ text }: { text: string }): ReactElement => (
  <Tooltip side='top' content={text}>
    <Info className='size-3.5 text-muted-foreground' />
  </Tooltip>
);

interface DigitalTwinBannerProps {
  status: DigitalTwinStatus | undefined;
  loading: boolean;
  /** True when the backfill has been polling for ~30s with no cursor movement. */
  backfillStalled?: boolean;
  onEnable: () => void;
  /** Used only for the stalled-backfill "Disable & retry" CTA. */
  onDisable: () => void;
}

export const DigitalTwinBanner = ({
  status,
  loading,
  backfillStalled = false,
  onEnable,
  onDisable,
}: DigitalTwinBannerProps): ReactElement => {
  if (loading || !status) {
    return (
      <div className='rounded-xl border border-border bg-card p-4'>
        <div className='flex items-center gap-2'>
          <Loader2 className='size-4 animate-spin text-muted-foreground' />
          <span className='text-[13px] text-muted-foreground'>Loading Digital Twin…</span>
        </div>
      </div>
    );
  }

  const backfillRunning = status.backfillState
    ? Object.values(status.backfillState).some(s => !s.complete)
    : false;

  // ── Off ───────────────────────────────────────────────────────────────────
  if (!status.enabled) {
    return (
      <div className='overflow-hidden rounded-xl border border-emerald-500/30 bg-card'>
        <div className='h-0.5 w-full bg-emerald-500/40' />
        <div className='p-4'>
          <div className='flex items-start gap-2.5'>
            <Brain className='mt-px size-[18px] shrink-0 text-emerald-600 dark:text-emerald-400' />
            <div className='min-w-0 flex-1'>
              <div className='flex items-center gap-1.5'>
                <p className='text-[13px] font-semibold text-foreground'>Digital Twin</p>
                <InfoDot text={LABEL_TOOLTIP} />
              </div>
              <p className='mt-0.5 text-[11px] leading-relaxed text-muted-foreground'>
                Learns from your Spaces history — every memory passes your review before it&apos;s
                saved.
              </p>
            </div>
          </div>
          <button
            type='button'
            onClick={onEnable}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin enable'
            className='mt-3.5 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-emerald-600/90'
          >
            <Brain className='size-4' />
            Enable Digital Twin
          </button>
        </div>
      </div>
    );
  }

  // ── Backfilling ────────────────────────────────────────────────────────────
  if (backfillRunning) {
    const entries = Object.values(status.backfillState!);
    const overallPct = Math.round(
      entries.reduce((sum, e) => {
        if (e.complete) return sum + 100;
        const total = new Date(e.to).getTime() - new Date(e.from).getTime();
        const elapsed = new Date(e.to).getTime() - new Date(e.cursor).getTime();
        return sum + (total > 0 ? Math.min(100, Math.round((elapsed / total) * 100)) : 100);
      }, 0) / (entries.length || 1),
    );

    return (
      <div className='overflow-hidden rounded-xl border border-border bg-card'>
        <style>{`@keyframes dt-slide { 0%{transform:translateX(-130%)} 100%{transform:translateX(400%)} }`}</style>

        {backfillStalled ? (
          <div className='h-0.5 w-full bg-foreground' />
        ) : (
          <div className='h-0.5 w-full overflow-hidden bg-border'>
            <div
              className='h-full w-[38%] rounded-full bg-foreground opacity-50'
              style={{ animation: 'dt-slide 2.2s cubic-bezier(0.4,0,0.6,1) infinite' }}
            />
          </div>
        )}

        {backfillStalled && (
          <div className='flex flex-wrap items-center justify-between gap-2.5 border-b border-border bg-muted/40 px-3.5 py-2.5'>
            <div className='flex items-center gap-2'>
              <AlertTriangle className='size-3.5 shrink-0 text-foreground' />
              <span className='text-xs font-semibold text-foreground'>Backfill stalled</span>
              <span className='text-[11px] text-muted-foreground'>No progress in 30 s</span>
            </div>
            <button
              type='button'
              onClick={onDisable}
              data-track-category='Claw Agents'
              data-track-name='Digital Twin disable and retry backfill'
              className='rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-foreground transition hover:bg-muted'
            >
              Disable &amp; retry
            </button>
          </div>
        )}

        <div className='flex items-center gap-2 border-b border-border px-3.5 py-2.5'>
          {backfillStalled ? (
            <XCircle className='size-3.5 shrink-0 text-muted-foreground' />
          ) : (
            <Loader2 className='size-3.5 shrink-0 animate-spin text-muted-foreground' />
          )}
          <span className='text-xs font-medium text-foreground'>Backfilling your history</span>
          <span className='text-[11px] tabular-nums text-muted-foreground'>{overallPct}%</span>
        </div>

        <div
          className='grid gap-px bg-border'
          style={{ gridTemplateColumns: `repeat(${entries.length}, 1fr)` }}
        >
          {Object.entries(status.backfillState!).map(([source, entry]) => {
            const to = new Date(entry.to);
            const from = new Date(entry.from);
            const cursor = new Date(entry.cursor);
            const total = to.getTime() - from.getTime();
            const elapsed = to.getTime() - cursor.getTime();
            const pct =
              total > 0 ? Math.min(100, Math.max(0, Math.round((elapsed / total) * 100))) : 100;
            const isStuck = backfillStalled && !entry.complete;
            const fillWidth = entry.complete ? 100 : isStuck ? Math.max(pct, 4) : pct;
            const barOpacity = entry.complete
              ? 'opacity-100'
              : isStuck
                ? 'opacity-30'
                : pct > 0
                  ? 'opacity-60'
                  : 'opacity-0';
            const badgeLabel = entry.complete
              ? 'Done ✓'
              : isStuck
                ? 'Stalled'
                : pct > 0
                  ? `${pct}%`
                  : 'Queued';
            const badgeCls = entry.complete
              ? 'bg-emerald-600 text-white'
              : isStuck
                ? 'border border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                : pct > 0
                  ? 'bg-foreground/15 text-foreground'
                  : 'bg-border text-muted-foreground';

            return (
              <div key={source} className='flex flex-col gap-2 bg-card p-3'>
                <div className='flex items-center justify-between gap-1.5'>
                  <span className='text-[11px] font-semibold capitalize text-foreground'>
                    {source}
                  </span>
                  {entry.complete ? (
                    <CheckCircle2 className='size-4 text-emerald-600 dark:text-emerald-400' />
                  ) : (
                    <span
                      className={cn('rounded-full px-1.5 py-px text-[10px] font-medium', badgeCls)}
                    >
                      {badgeLabel}
                    </span>
                  )}
                </div>
                <div className='h-[3px] overflow-hidden rounded-full bg-border'>
                  <div
                    className={cn(
                      'h-full rounded-full bg-foreground transition-all duration-700',
                      barOpacity,
                    )}
                    style={{ width: `${fillWidth}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Active ─────────────────────────────────────────────────────────────────
  const hasPending = status.pendingCandidates > 0;

  return (
    <div className='overflow-hidden rounded-xl border border-border bg-card'>
      <div className='h-0.5 w-full bg-emerald-500/50' />
      <div className='flex items-start gap-2.5 px-4 py-3.5'>
        <CheckCircle2 className='mt-px size-[18px] shrink-0 text-emerald-600 dark:text-emerald-400' />
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-1.5 text-[13px] font-semibold text-foreground'>
            Digital Twin is active
            <InfoDot text={LABEL_TOOLTIP} />
          </div>
          <div className='mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground'>
            {hasPending ? (
              <span className='font-medium text-amber-600 dark:text-amber-400'>
                {status.pendingCandidates} memor{status.pendingCandidates === 1 ? 'y' : 'ies'}{' '}
                pending review
              </span>
            ) : status.approvedCandidates > 0 ? (
              <span>
                {status.approvedCandidates} approved memor
                {status.approvedCandidates === 1 ? 'y' : 'ies'}
              </span>
            ) : (
              <span>No memories yet — run a backfill or upload a .md to get started</span>
            )}
            {status.mdFileCount > 0 && (
              <span>
                · {status.mdFileCount} uploaded file{status.mdFileCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
