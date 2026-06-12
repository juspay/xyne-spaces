import { ReactElement } from 'react';
import { useOrgHighlights } from '@/hooks/useTeamIntelligence';
import { useOutletContext } from 'react-router-dom';
import { TeamIntelligenceOutletContext } from '@/routes/TeamIntelligenceScreen/TeamIntelligenceScreen';
import { getHighlightTypeConfig } from './HighlightCard';
import { formatReportDate } from '@/utils/teamIntelligenceUtils';
import { LoaderCircleIcon, RocketIcon } from 'lucide-react';
import { cn } from '@/utils/classNames';

const OrgHighlights = (): ReactElement => {
  const { dateRange } = useOutletContext<TeamIntelligenceOutletContext>();
  const { data: orgHighlights, isLoading } = useOrgHighlights({
    params: {
      from: dateRange.from,
      to: dateRange.to,
    },
  });

  const highlights = orgHighlights?.bullets || [];

  if (isLoading) {
    return (
      <section className='space-y-4'>
        <div className='flex items-center gap-3'>
          <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10'>
            <RocketIcon className='h-4 w-4 text-green-500' />
          </div>
          <h3 className='text-lg font-semibold text-foreground'>Highlights</h3>
        </div>

        <div className='w-full rounded-xl border border-border/50 bg-card p-5 flex items-center gap-2'>
          <LoaderCircleIcon className='h-5 w-5 animate-spin text-muted-foreground' />
          <p className='text-sm text-muted-foreground'>Loading Highlights</p>
        </div>
      </section>
    );
  }

  return (
    <section className='space-y-4'>
      <div className='flex items-center gap-3'>
        <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10'>
          <RocketIcon className='h-4 w-4 text-green-500' />
        </div>
        <h3 className='text-lg font-semibold text-foreground'>Highlights</h3>
      </div>

      {isLoading ? (
        <div className='w-full rounded-xl border border-border/50 bg-card p-5 flex items-center gap-2'>
          <LoaderCircleIcon className='h-5 w-5 animate-spin text-muted-foreground' />
          <p className='text-sm text-muted-foreground'>Loading Highlights</p>
        </div>
      ) : null}

      {highlights.length > 0 && !isLoading ? (
        <div className='grid gap-4 md:grid-cols-2'>
          {orgHighlights?.bullets?.map(highlight => {
            const type = highlight.bulletCat;
            const config = getHighlightTypeConfig(type);
            const Icon = config.icon;

            return (
              <article
                key={highlight.bulletId}
                className='group rounded-xl border border-border/50 bg-card p-5 transition-all hover:border-border hover:shadow-lg h-full'
              >
                <div className='flex flex-col gap-3 h-full'>
                  <div className='flex items-center justify-between'>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
                        config.color,
                      )}
                    >
                      <Icon className='h-3 w-3' />
                      {config.label}
                    </span>
                    <span className='text-xs text-muted-foreground'>
                      {formatReportDate(highlight.reportDate)}
                    </span>
                  </div>
                  <h4 className='text-base font-medium text-foreground'>{highlight.bulletTitle}</h4>
                  <p className='text-sm leading-relaxed text-muted-foreground'>
                    {highlight.bulletText}
                  </p>
                  <div className='flex items-center justify-between border-t border-border/30 pt-3 mt-auto'>
                    <span className='text-xs text-muted-foreground'>{highlight.teamName}</span>
                    {/* <span className='flex items-center gap-1 text-xs font-medium text-action-accent'>
                  <TrendingUp className='h-3 w-3' />
                  {highlight.impact}
                </span> */}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className='w-full rounded-xl border border-border/50 bg-card p-5'>
          <p className='text-sm text-muted-foreground'>
            No highlights for the selected date range.
          </p>
        </div>
      )}
    </section>
  );
};

export default OrgHighlights;
