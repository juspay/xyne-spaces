import type { ReactElement } from 'react';
import { cn } from '../../utils/classNames';

// The AI release-insights blob stored on the release ticket's metadata.
export type ReleaseInsights = {
  generatedAt?: string;
  stats?: {
    devTicketCount: number;
    environmentVariableCount: number;
    migrationFileCount: number;
    repositoryCount: number;
    serviceNames: string[];
    hotfixCount: number;
    qaAssigned: number;
    potPresent: number;
    prCount: number;
    contributors: { name: string; ticketCount: number }[];
  };
  summary?: string;
  composition?: { label: string; percent: number }[];
  risk?: { level: 'LOW' | 'MEDIUM' | 'HIGH'; reasons: string[] };
  qualityGaps?: string[];
  watchItems?: string[];
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

// Single reader for the metadata contract — used by the release screen and the
// cross-release metrics strip so the shape can't drift between them.
export function readReleaseInsights(metadata: unknown): ReleaseInsights | null {
  if (!isPlainObject(metadata)) return null;
  const value = metadata['releaseInsights'];
  return isPlainObject(value) ? (value as ReleaseInsights) : null;
}

export function readIsGeneratingInsights(metadata: unknown): boolean {
  return isPlainObject(metadata) && metadata['isGeneratingReleaseInsights'] === true;
}

const RISK_BADGE: Record<string, string> = {
  LOW: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  MEDIUM: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  HIGH: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

export function ReleaseInsightsPanel({ insights }: { insights: ReleaseInsights }): ReactElement {
  const stats = insights.stats;
  return (
    <div className='mb-6 space-y-4 rounded-xl border border-border bg-background p-4'>
      {insights.summary && (
        <div>
          <h4 className='text-sm font-semibold text-foreground'>Summary</h4>
          <p className='mt-1 text-sm text-muted-foreground'>{insights.summary}</p>
        </div>
      )}

      {stats && (
        <div className='flex flex-wrap gap-2 text-xs'>
          {[
            `${stats.devTicketCount} dev tickets`,
            `${stats.serviceNames.length} services`,
            `${stats.repositoryCount} repos`,
            `${stats.environmentVariableCount} env vars`,
            `${stats.migrationFileCount} migrations`,
            ...(stats.hotfixCount > 0 ? [`${stats.hotfixCount} hotfix`] : []),
          ].map(chip => (
            <span key={chip} className='rounded-full bg-muted px-2 py-0.5 text-muted-foreground'>
              {chip}
            </span>
          ))}
        </div>
      )}

      {insights.composition && insights.composition.length > 0 && (
        <div>
          <h4 className='text-sm font-semibold text-foreground'>Composition</h4>
          <div className='mt-2 space-y-1.5'>
            {insights.composition.map(c => (
              <div key={c.label} className='flex items-center gap-2'>
                <span className='w-20 shrink-0 text-xs text-muted-foreground'>{c.label}</span>
                <div className='h-2 flex-1 overflow-hidden rounded-full bg-muted'>
                  <div
                    className='h-full rounded-full bg-primary'
                    style={{ width: `${Math.max(0, Math.min(100, c.percent))}%` }}
                  />
                </div>
                <span className='w-9 shrink-0 text-right text-xs text-muted-foreground'>
                  {Math.round(c.percent)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
        {insights.risk && (
          <div>
            <h4 className='flex items-center gap-2 text-sm font-semibold text-foreground'>
              Risk
              <span
                className={cn(
                  'rounded px-2 py-0.5 text-xs font-medium',
                  RISK_BADGE[insights.risk.level],
                )}
              >
                {insights.risk.level}
              </span>
            </h4>
            {insights.risk.reasons.length > 0 && (
              <ul className='mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground'>
                {insights.risk.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {stats && (
          <div>
            <h4 className='text-sm font-semibold text-foreground'>Quality</h4>
            <p className='mt-1 text-xs text-muted-foreground'>
              QA {stats.qaAssigned}/{stats.devTicketCount} · POT {stats.potPresent}/{stats.prCount}
            </p>
            {insights.qualityGaps && insights.qualityGaps.length > 0 && (
              <ul className='mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-700 dark:text-amber-400'>
                {insights.qualityGaps.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
        {stats && stats.contributors.length > 0 && (
          <div>
            <h4 className='text-sm font-semibold text-foreground'>Contributors</h4>
            <div className='mt-1 flex flex-wrap gap-1.5'>
              {stats.contributors.map(c => (
                <span
                  key={c.name}
                  className='rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground'
                >
                  {c.name} · {c.ticketCount}
                </span>
              ))}
            </div>
          </div>
        )}

        {insights.watchItems && insights.watchItems.length > 0 && (
          <div>
            <h4 className='text-sm font-semibold text-foreground'>Watch items</h4>
            <ul className='mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground'>
              {insights.watchItems.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
