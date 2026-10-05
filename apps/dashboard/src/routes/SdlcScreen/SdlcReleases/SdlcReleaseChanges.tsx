import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Copy,
  FileText,
  RotateCw,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/Button';
import { getAvatarColorClassNames } from '../../../components/ui/Avatar/Avatar';
import { Skeleton } from '../../../components/ui/Skeleton';
import { Tooltip } from '../../../components/ui/Tooltip';
import {
  readIsGeneratingInsights,
  readReleaseInsights,
  type ReleaseInsights,
} from '../../../components/Release/ReleaseInsightsPanel';
import {
  buildGroupedByApp,
  buildValuesByChangeId,
} from '../../../components/Release/releaseChanges.utils';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useConfirmDialog } from '../../../hooks/useConfirmDialog';
import { useCopyButton } from '../../../hooks/useCopyButton';
import { useCanManageRelease } from '../../../hooks/usePermissions';
import { apiInstance } from '../../../services/clients/apiClient';
import { queries } from '../../../zero/queries';
import { getApiErrorMessage } from '../../../utils/apiError';
import { cn } from '../../../utils/classNames';
import type { ReleaseChangeRow, SdlcReleaseChangesProps } from './SdlcReleases.types';
import {
  CODE_TONE_CLASS,
  COMPOSITION_BAR_CLASSES,
  TONE,
  TRACK_CATEGORY,
  buildChangeRows,
  plural,
} from './SdlcReleases.utils';
import { EllipsisText } from './SdlcReleasePrimitives';

const RISK_TONE: Record<string, string> = { LOW: TONE.green, MEDIUM: TONE.amber, HIGH: TONE.red };
const MAX_CONTRIBUTORS = 8;

export function SdlcReleaseChanges({
  release,
  changes,
  devTickets,
  analysisCanvasId,
  repoName,
  onOpenCanvas,
}: SdlcReleaseChangesProps): ReactElement {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [formValues] = useCachedQuery(
    queries.releaseChangeFormValuesByReleaseId({ releaseId: release.id }),
  );
  const [changeLogValues] = useCachedQuery(
    queries.releaseChangeLogValuesByReleaseId({ releaseId: release.id }),
  );

  const rows = useMemo(
    () =>
      buildChangeRows(
        buildGroupedByApp([...changes]),
        buildValuesByChangeId([...(formValues ?? []), ...(changeLogValues ?? [])]),
        new Map(devTickets.map(ticket => [ticket.xyneId, ticket.title])),
      ),
    [changes, formValues, changeLogValues, devTickets],
  );
  const envRows = rows.filter(row => row.kind === 'ENV');
  const migrationRows = rows.filter(row => row.kind === 'MIGRATION');
  const toggle = (key: string): void => setOpenKey(current => (current === key ? null : key));

  return (
    <div className='flex flex-col gap-9'>
      {envRows.length > 0 && (
        <ChangeTable
          title='Environment'
          meta={plural(envRows.length, 'file')}
          rows={envRows}
          openKey={openKey}
          onToggle={toggle}
        />
      )}
      {migrationRows.length > 0 && (
        <ChangeTable
          title='Migrations'
          meta={String(migrationRows.length)}
          rows={migrationRows}
          openKey={openKey}
          onToggle={toggle}
        />
      )}
      {rows.length === 0 && (
        <Section title='Env & migrations'>
          <div className='flex items-center gap-2.5 rounded-[10px] border border-border bg-background px-4 py-3.5 text-[13.5px] text-muted-foreground'>
            <CircleCheck size={15} className='shrink-0 text-status-success' />
            No environment or migration changes in this release.
          </div>
        </Section>
      )}
      <ReleaseNotes
        release={release}
        devTicketCount={devTickets.length}
        analysisCanvasId={analysisCanvasId}
        envFileCount={envRows.length}
        migrationCount={migrationRows.length}
        repoName={repoName}
        onOpenCanvas={onOpenCanvas}
      />
    </div>
  );
}

function Section({
  title,
  meta,
  action,
  children,
}: {
  title: string;
  meta?: string;
  action?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <div className='flex flex-col gap-2.5'>
      <div className='flex min-h-[30px] items-center gap-2 px-0.5'>
        <span className='text-[15px] font-semibold tracking-[-0.01em] text-foreground'>
          {title}
        </span>
        {meta && <span className='flex-1 text-[13px] text-muted-foreground'>{meta}</span>}
        {action}
      </div>
      {children}
    </div>
  );
}

function ChangeTable({
  title,
  meta,
  rows,
  openKey,
  onToggle,
}: {
  title: string;
  meta: string;
  rows: ReleaseChangeRow[];
  openKey: string | null;
  onToggle: (key: string) => void;
}): ReactElement {
  return (
    <Section title={title} meta={meta}>
      <div className='divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-background'>
        {rows.map(row => (
          <ChangeRow
            key={row.key}
            row={row}
            open={openKey === row.key}
            onToggle={() => onToggle(row.key)}
          />
        ))}
      </div>
    </Section>
  );
}

function ChangeRow({
  row,
  open,
  onToggle,
}: {
  row: ReleaseChangeRow;
  open: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <div>
      <button
        type='button'
        aria-expanded={open}
        onClick={onToggle}
        className={cn(
          'flex w-full items-center gap-3.5 py-3 pl-3.5 pr-4 text-left transition-colors hover:bg-muted/40',
          open && 'bg-muted/20',
        )}
        data-track-category={TRACK_CATEGORY}
        data-track-name='ReleaseChangeFileToggled'
      >
        <ChevronRight
          size={12}
          strokeWidth={2.6}
          className={cn(
            'w-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90',
          )}
        />
        <span className='flex min-w-0 flex-1 flex-col gap-1'>
          <span className='flex min-w-0 items-baseline gap-2'>
            <span className='shrink-0 text-[13.5px] font-semibold text-foreground'>
              {row.service}
            </span>
            <span className='shrink-0 text-muted-foreground/50'>/</span>
            <EllipsisText
              text={row.title}
              className='font-code text-[13px] font-medium text-foreground'
            />
          </span>
          <EllipsisText text={row.subtitle} className='text-[12.5px] text-muted-foreground' />
        </span>
        {row.addedLines > 0 && (
          <span className='shrink-0 font-code text-xs text-status-success'>+{row.addedLines}</span>
        )}
        {row.removedLines > 0 && (
          <span className='shrink-0 font-code text-xs text-status-failure'>
            −{row.removedLines}
          </span>
        )}
        <span className='w-[72px] shrink-0 text-right text-[12.5px] text-muted-foreground'>
          {plural(row.commits.length, 'commit')}
        </span>
      </button>
      {open && (
        <div className='flex flex-col gap-3 border-t border-border/70 bg-muted/30 py-3.5 pl-[42px] pr-4'>
          <div className='flex flex-col gap-2'>
            {row.commits.map(commit => (
              <div key={commit.id} className='flex min-w-0 items-center gap-2.5 text-[12.5px]'>
                <span
                  className={cn(
                    'shrink-0 font-semibold',
                    commit.ticket ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {commit.ticket ?? 'No ticket'}
                </span>
                <EllipsisText
                  text={commit.ticketTitle}
                  className='min-w-0 flex-1 text-foreground/75'
                />
                {commit.sha && commit.commitUrl && (
                  <a
                    href={commit.commitUrl}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='shrink-0 font-code text-[11.5px] text-muted-foreground hover:text-foreground hover:underline'
                  >
                    {commit.sha}
                  </a>
                )}
                {commit.sha && !commit.commitUrl && (
                  <span className='shrink-0 font-code text-[11.5px] text-muted-foreground'>
                    {commit.sha}
                  </span>
                )}
              </div>
            ))}
          </div>
          <CodeViewer row={row} />
        </div>
      )}
    </div>
  );
}

function CodeViewer({ row }: { row: ReleaseChangeRow }): ReactElement {
  const { copied, copy } = useCopyButton(1400);

  return (
    <div className='overflow-hidden rounded-[10px] border border-border bg-background'>
      <div className='flex h-9 items-center border-b border-border bg-muted/50 pr-1.5'>
        <span className='-mb-px flex h-full items-center border-r border-border bg-background px-3.5 font-code text-xs text-foreground'>
          {row.fileName}
        </span>
        <span className='flex-1' />
        <span className='px-2.5 text-xs text-muted-foreground'>{row.language}</span>
        <Button
          variant='outline'
          size='sm'
          onClick={() => copy(row.source)}
          className='h-[26px] px-2.5 text-[12.5px]'
          data-track-category={TRACK_CATEGORY}
          data-track-name='ReleaseChangeCopied'
        >
          <Copy className='size-3' />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <div className='max-h-[360px] overflow-auto py-2'>
        <div className='min-w-max'>
          {row.lines.map((line, index) => (
            <div
              key={index}
              className={cn(
                'flex min-h-[19px] text-[12.5px] leading-[19px] hover:bg-muted/40',
                line.number === null &&
                  'bg-[color-mix(in_srgb,var(--status-failure)_8%,transparent)] line-through decoration-status-failure/60',
              )}
            >
              <span className='w-12 shrink-0 select-none pr-4 text-right font-code text-muted-foreground/60'>
                {line.number ?? '−'}
              </span>
              <span className='whitespace-pre pr-6'>
                {line.tokens.map((token, tokenIndex) => (
                  <span key={tokenIndex} className={cn('font-code', CODE_TONE_CLASS[token.tone])}>
                    {token.text}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReleaseNotes({
  release,
  devTicketCount,
  analysisCanvasId,
  envFileCount,
  migrationCount,
  repoName,
  onOpenCanvas,
}: {
  release: SdlcReleaseChangesProps['release'];
  devTicketCount: number;
  analysisCanvasId: string | null;
  envFileCount: number;
  migrationCount: number;
  repoName: string | null;
  onOpenCanvas: (canvasId: string) => void;
}): ReactElement {
  const [analyzing, setAnalyzing] = useState(false);
  const canManage = useCanManageRelease();
  const { confirm, ConfirmDialog } = useConfirmDialog();

  const insights = readReleaseInsights(release.metadata);
  const running = analyzing || readIsGeneratingInsights(release.metadata);

  const analyze = async (): Promise<void> => {
    if (
      insights &&
      !(await confirm({
        title: 'Re-analyze this release?',
        description:
          'This replaces the current summary, stats and risk assessment with a freshly generated set.',
        confirmLabel: 'Re-analyze',
      }))
    ) {
      return;
    }
    setAnalyzing(true);
    try {
      const response = await apiInstance.post<{ success: boolean; error?: string }>(
        `/tickets/${release.id}/release-insights`,
        {},
      );
      if (response.data?.success) toast.success('Release insights generated.');
      else toast.error(response.data?.error ?? 'Analysis failed');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Analysis failed'));
    } finally {
      setAnalyzing(false);
    }
  };

  const headerAction = canManage && (insights || running || analysisCanvasId) && (
    <Button
      variant='ghost'
      size='sm'
      onClick={() => void analyze()}
      disabled={running}
      className='h-7 px-2 font-medium text-muted-foreground'
      data-track-category={TRACK_CATEGORY}
      data-track-name='ReleaseAnalyzeClicked'
    >
      <RotateCw className={cn('size-3.5', running && 'animate-spin')} />
      {running ? 'Analyzing…' : insights ? 'Re-analyze' : 'Analyze release'}
    </Button>
  );

  return (
    <Section title='Release notes' meta='AI-generated' action={headerAction}>
      {running && (
        <div className='flex flex-col gap-3 rounded-[14px] border border-border bg-background px-6 py-[22px]'>
          <span className='text-[13px] text-muted-foreground'>
            Reading {plural(devTicketCount, 'ticket')}, commits and file changes…
          </span>
          <Skeleton className='h-2.5 w-[92%]' />
          <Skeleton className='h-2.5 w-[78%]' />
          <Skeleton className='h-2.5 w-[54%]' />
        </div>
      )}
      {!running && insights && (
        <InsightsCard
          insights={insights}
          envFileCount={envFileCount}
          migrationCount={migrationCount}
        />
      )}
      {!running && !insights && !analysisCanvasId && (
        <div className='flex flex-wrap items-center gap-4 rounded-[14px] border border-border bg-background px-[22px] py-5'>
          <span className='flex size-[38px] shrink-0 items-center justify-center rounded-[10px] border border-border bg-muted text-muted-foreground'>
            <Sparkles size={17} />
          </span>
          <div className='flex min-w-[220px] flex-1 flex-col gap-[3px]'>
            <span className='text-sm font-semibold text-foreground'>Not analyzed yet</span>
            <span className='text-[13px] leading-normal text-muted-foreground'>
              Get a summary, the release mix, risk, and what to check before deploy.
            </span>
          </div>
          {canManage && (
            <Button
              onClick={() => void analyze()}
              className='h-[34px] px-3.5 text-[13.5px] font-semibold'
              data-track-category={TRACK_CATEGORY}
              data-track-name='ReleaseAnalyzeClicked'
            >
              Analyze release
            </Button>
          )}
        </div>
      )}
      {analysisCanvasId && (
        <button
          type='button'
          onClick={() => onOpenCanvas(analysisCanvasId)}
          className='flex w-full max-w-[420px] items-center gap-3 self-start rounded-xl border border-border bg-background p-3 text-left transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-sm'
          data-track-category={TRACK_CATEGORY}
          data-track-name='ReleaseCanvasOpened'
        >
          <span className='flex size-10 shrink-0 items-center justify-center rounded-lg bg-status-success text-white'>
            <FileText size={18} />
          </span>
          <span className='flex min-w-0 flex-col gap-1'>
            <span className='truncate text-sm font-semibold text-foreground'>
              📦 Release Analysis: {repoName ?? 'Release'} - {release.xyneId}
            </span>
            <span className='text-[13px] text-muted-foreground'>Click to open canvas</span>
          </span>
        </button>
      )}
      <ConfirmDialog />
    </Section>
  );
}

function InsightsCard({
  insights,
  envFileCount,
  migrationCount,
}: {
  insights: ReleaseInsights;
  envFileCount: number;
  migrationCount: number;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const stats = insights.stats;
  const devTicketCount = stats?.devTicketCount ?? 0;
  const composition = insights.composition ?? [];
  const riskItems = insights.risk?.reasons ?? [];
  const qualityItems = insights.qualityGaps ?? [];
  const watchItems = insights.watchItems ?? [];
  const contributors = stats?.contributors ?? [];
  const hiddenContributors = contributors.length - MAX_CONTRIBUTORS;
  const detailCount = riskItems.length + qualityItems.length + watchItems.length;
  const statsText = [
    plural(devTicketCount, 'dev ticket'),
    plural(Math.max(stats?.serviceNames.length ?? 0, 1), 'service'),
    plural(envFileCount, 'env file'),
    plural(migrationCount, 'migration'),
  ].join('  ·  ');

  return (
    <div className='overflow-hidden rounded-[14px] border border-border bg-background'>
      <div className='flex flex-col gap-3 px-6 pb-5 pt-[22px]'>
        {insights.summary && (
          <p
            className={cn(
              'text-[15px] leading-[1.6] text-foreground/90',
              !expanded && 'line-clamp-3',
            )}
          >
            {insights.summary}
          </p>
        )}
        <span className='whitespace-pre text-[13.5px] text-muted-foreground'>{statsText}</span>
      </div>
      {composition.length > 0 && (
        <div className='flex flex-col gap-3 border-t border-border/60 px-6 pb-5 pt-[18px]'>
          <span className='text-[13px] font-semibold text-muted-foreground'>Composition</span>
          <div className='flex h-1.5 gap-[3px]'>
            {composition.map((item, index) => (
              <span
                key={item.label}
                className={cn(
                  'rounded-[3px]',
                  COMPOSITION_BAR_CLASSES[index % COMPOSITION_BAR_CLASSES.length],
                )}
                style={{ flex: `${item.percent} 1 0` }}
              />
            ))}
          </div>
          <div className='flex flex-wrap gap-x-[22px] gap-y-2'>
            {composition.map((item, index) => (
              <span
                key={item.label}
                className='flex items-center gap-[7px] whitespace-nowrap text-[13.5px] text-foreground/80'
              >
                <span
                  className={cn(
                    'size-2 rounded-full',
                    COMPOSITION_BAR_CLASSES[index % COMPOSITION_BAR_CLASSES.length],
                  )}
                />
                {item.label}
                <span className='tabular-nums text-muted-foreground'>{item.percent}%</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {expanded && (
        <div className='grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-x-8 gap-y-[22px] border-t border-border/60 px-6 pb-[22px] pt-5'>
          {insights.risk && (
            <InsightList
              title='Risk'
              badge={
                <span
                  className={cn(
                    'rounded-[5px] px-[7px] py-0.5 text-[10.5px] font-bold tracking-[0.08em]',
                    RISK_TONE[insights.risk.level] ?? TONE.neutral,
                  )}
                >
                  {insights.risk.level}
                </span>
              }
              items={riskItems}
            />
          )}
          <InsightList
            title='Quality'
            badge={
              stats && (
                <span className='text-[13px] tabular-nums text-muted-foreground'>
                  QA {stats.qaAssigned}/{devTicketCount} · POT {stats.potPresent}/{devTicketCount}
                </span>
              )
            }
            items={qualityItems}
            emptyText='All tickets have QA sign-off and proof of testing'
            dotClassName='bg-status-pending'
          />
          <InsightList title='Watch items' items={watchItems} />
        </div>
      )}
      {expanded && contributors.length > 0 && (
        <div className='flex flex-col gap-3 border-t border-border/60 px-6 pb-5 pt-[18px]'>
          <div className='flex items-baseline gap-2'>
            <span className='text-[13px] font-semibold text-muted-foreground'>Contributors</span>
            <span className='text-[13px] text-muted-foreground'>
              {contributors.length} {contributors.length === 1 ? 'person' : 'people'} ·{' '}
              {plural(devTicketCount, 'ticket')}
            </span>
          </div>
          <div className='flex flex-wrap gap-2'>
            {contributors.slice(0, MAX_CONTRIBUTORS).map(contributor => (
              <ContributorChip
                key={contributor.name}
                name={contributor.name}
                ticketCount={contributor.ticketCount}
              />
            ))}
            {hiddenContributors > 0 && (
              <span className='flex h-8 items-center rounded-full bg-muted px-3 text-[13px] text-muted-foreground'>
                +{hiddenContributors} more
              </span>
            )}
          </div>
        </div>
      )}
      {(detailCount > 0 || contributors.length > 0) && (
        <button
          type='button'
          onClick={() => setExpanded(value => !value)}
          className='flex h-[46px] w-full items-center gap-1.5 border-t border-border/60 bg-muted/30 px-6 text-left text-[13.5px] text-foreground/80 transition-colors hover:bg-muted/50 hover:text-foreground'
          data-track-category={TRACK_CATEGORY}
          data-track-name='ReleaseInsightsToggled'
        >
          {expanded ? 'Show less' : `Risk, quality & watch items · ${detailCount}`}
          <ChevronDown size={12} className={cn('transition-transform', expanded && 'rotate-180')} />
        </button>
      )}
    </div>
  );
}

function InsightList({
  title,
  badge,
  items,
  emptyText,
  dotClassName = 'bg-muted-foreground/40',
}: {
  title: string;
  badge?: ReactNode;
  items: string[];
  emptyText?: string;
  dotClassName?: string;
}): ReactElement {
  return (
    <div className='flex min-w-0 flex-col gap-2.5'>
      <div className='flex items-center gap-2'>
        <span className='text-[13px] font-semibold text-muted-foreground'>{title}</span>
        {badge}
      </div>
      {items.map(item => (
        <span key={item} className='flex gap-2.5 text-sm leading-normal text-foreground/85'>
          <span className={cn('mt-[9px] size-1 shrink-0 rounded-full', dotClassName)} />
          <span className='min-w-0 [overflow-wrap:anywhere]'>{item}</span>
        </span>
      ))}
      {items.length === 0 && emptyText && (
        <span className='text-sm text-status-success'>{emptyText}</span>
      )}
    </div>
  );
}

function ContributorChip({
  name,
  ticketCount,
}: {
  name: string;
  ticketCount: number;
}): ReactElement {
  const color = getAvatarColorClassNames(name);
  return (
    <Tooltip content={`${name} · ${plural(ticketCount, 'ticket')}`}>
      <span className='flex h-8 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-background pl-1 pr-3 text-[13.5px] text-foreground'>
        <span
          className={cn(
            'flex size-6 items-center justify-center rounded-full text-[10.5px] font-bold',
            color.bg,
            color.text,
          )}
        >
          {name.charAt(0).toUpperCase()}
        </span>
        {name}
        <span className='text-[12.5px] tabular-nums text-muted-foreground'>{ticketCount}</span>
      </span>
    </Tooltip>
  );
}
