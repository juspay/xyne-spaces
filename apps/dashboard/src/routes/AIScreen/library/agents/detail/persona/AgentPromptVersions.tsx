import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { diffLines, type Change } from 'diff';
import { ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/utils/classNames';
import { Skeleton } from '@/components/ui/Skeleton';
import { useClawPromptVersions } from '@/hooks/useClawPromptVersions';
import { clawErrorText } from '@/services/claw/clawRequest';
import type { PromptVersion } from '@/services/claw/clawAuthAgentTypes';
import { ScrollFadeBox } from '../../../shared/primitives/ProseBox';
import {
  DetailCard,
  DetailEmpty,
  DetailSection,
} from '../../../shared/primitives/DetailPrimitives';
import { Pill } from '../../../shared/primitives/Pill';

const PROMPT_PREVIEW_HEIGHT = 220;
const DIFF_HEIGHT = 280;

interface DiffRow {
  type: 'eq' | 'add' | 'del';
  text: string;
}

function computeDiff(before: string, after: string): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const change of diffLines(before, after) as Change[]) {
    const type: DiffRow['type'] = change.added ? 'add' : change.removed ? 'del' : 'eq';
    const lines = change.value.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    for (const text of lines) rows.push({ type, text });
  }
  return rows;
}

function formatStamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString();
}

function VersionSelect({
  value,
  versions,
  activeVersion,
  label,
  onChange,
}: {
  value: number | null;
  versions: PromptVersion[];
  activeVersion: number | null;
  label: string;
  onChange: (next: number) => void;
}): ReactElement {
  return (
    <select
      value={value ?? ''}
      aria-label={label}
      onChange={event => onChange(Number(event.target.value))}
      data-track-category='Claw Agents'
      data-track-name='Agent detail v2: pick diff version'
      className='h-7 rounded-lg border border-border bg-card px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring'
    >
      {versions.map(entry => (
        <option key={entry.id} value={entry.version}>
          v{entry.version}
          {entry.version === activeVersion ? ' (active)' : ''}
        </option>
      ))}
    </select>
  );
}

export function AgentPromptVersions({
  agentSlug,
  canRestore,
  onRestored,
}: {
  agentSlug: string;
  canRestore: boolean;
  onRestored: (systemPrompt: string) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError, refetch, activate } = useClawPromptVersions(agentSlug, {
    enabled: open,
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [targetVersion, setTargetVersion] = useState<number | null>(null);

  const versions = useMemo(() => data?.versions ?? [], [data]);
  const activeVersion = data?.activeVersion ?? null;

  useEffect(() => {
    if (versions.length < 2) return;
    setBaseVersion(previous => previous ?? versions[1]!.version);
    setTargetVersion(previous => previous ?? versions[0]!.version);
  }, [versions]);

  const diff = useMemo(() => {
    if (!comparing || baseVersion === null || targetVersion === null) return null;
    const before = versions.find(entry => entry.version === baseVersion);
    const after = versions.find(entry => entry.version === targetVersion);
    if (!before || !after) return null;
    return computeDiff(before.systemPrompt, after.systemPrompt);
  }, [comparing, baseVersion, targetVersion, versions]);

  const diffStats = useMemo(() => {
    if (!diff) return null;
    return {
      added: diff.filter(row => row.type === 'add').length,
      removed: diff.filter(row => row.type === 'del').length,
    };
  }, [diff]);

  const restore = async (version: number): Promise<void> => {
    try {
      const updated = await activate.mutateAsync(version);
      onRestored(updated.systemPrompt ?? '');
      toast.success(`Restored v${version}`);
    } catch (error) {
      toast.error(clawErrorText(error, 'Could not restore that version'));
    }
  };

  const restoring = activate.isPending ? activate.variables : null;

  return (
    <DetailSection
      label='Version history'
      info='Every saved system prompt, newest first'
      trailing={
        open && versions.length >= 2 ? (
          <button
            type='button'
            onClick={() => setComparing(value => !value)}
            data-track-category='Claw Agents'
            data-track-name='Agent detail v2: toggle prompt diff'
            className={cn(
              'flex h-6 shrink-0 items-center rounded-md px-1.5 text-xs font-medium transition-colors',
              comparing
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {comparing ? 'Close compare' : 'Compare'}
          </button>
        ) : undefined
      }
      trailingAlign='end'
    >
      <div className='flex w-full flex-col gap-3'>
        <button
          type='button'
          onClick={() => setOpen(value => !value)}
          aria-expanded={open}
          data-track-category='Claw Agents'
          data-track-name='Agent detail v2: toggle version history'
          className='flex w-full items-center gap-1.5 rounded-2xl border border-border bg-card px-4 py-3 text-left text-sm leading-5 text-foreground transition-colors hover:bg-muted/50'
        >
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
            aria-hidden
          />
          {open ? 'Hide versions' : 'Show versions'}
          {activeVersion !== null && (
            <span className='ml-auto shrink-0'>
              <Pill tone='success'>v{activeVersion} active</Pill>
            </span>
          )}
        </button>

        {open && (
          <>
            {comparing && diff && (
              <DetailCard className='flex flex-col gap-3 p-4'>
                <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                  <VersionSelect
                    value={baseVersion}
                    versions={versions}
                    activeVersion={activeVersion}
                    label='Compare from'
                    onChange={setBaseVersion}
                  />
                  <span aria-hidden>→</span>
                  <VersionSelect
                    value={targetVersion}
                    versions={versions}
                    activeVersion={activeVersion}
                    label='Compare to'
                    onChange={setTargetVersion}
                  />
                  {diffStats && (
                    <span className='ml-auto flex items-center gap-2'>
                      <span className='text-emerald-600 dark:text-emerald-400'>
                        +{diffStats.added}
                      </span>
                      <span className='text-destructive'>−{diffStats.removed}</span>
                    </span>
                  )}
                </div>

                {diff.every(row => row.type === 'eq') ? (
                  <DetailEmpty>These two versions are identical</DetailEmpty>
                ) : (
                  <ScrollFadeBox
                    height={DIFF_HEIGHT}
                    className='bg-muted/30'
                    resetKeys={[baseVersion, targetVersion]}
                  >
                    <div className='flex flex-col font-mono text-xs leading-5'>
                      {diff.map((row, index) => (
                        <span
                          key={`${row.type}-${index}`}
                          className={cn(
                            'whitespace-pre-wrap break-words px-1',
                            row.type === 'add' &&
                              'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                            row.type === 'del' && 'bg-destructive/10 text-destructive',
                            row.type === 'eq' && 'text-muted-foreground',
                          )}
                        >
                          <span className='select-none opacity-60' aria-hidden>
                            {row.type === 'add' ? '+ ' : row.type === 'del' ? '− ' : '  '}
                          </span>
                          {row.text || ' '}
                        </span>
                      ))}
                    </div>
                  </ScrollFadeBox>
                )}
              </DetailCard>
            )}

            {isLoading ? (
              <div className='flex w-full flex-col gap-2'>
                <Skeleton className='h-12 w-full rounded-2xl' />
                <Skeleton className='h-12 w-full rounded-2xl' />
              </div>
            ) : isError ? (
              <DetailCard className='flex items-center justify-between gap-3 p-4'>
                <span className='text-sm leading-5 text-muted-foreground'>
                  Couldn&apos;t load the version history.
                </span>
                <button
                  type='button'
                  onClick={() => void refetch()}
                  data-track-category='Claw Agents'
                  data-track-name='Agent detail v2: retry version history'
                  className='shrink-0 text-sm font-medium text-foreground underline underline-offset-2'
                >
                  Retry
                </button>
              </DetailCard>
            ) : versions.length === 0 ? (
              <DetailCard>
                <DetailEmpty>No versions saved yet</DetailEmpty>
              </DetailCard>
            ) : (
              <ul className='flex w-full flex-col gap-2'>
                {versions.map(entry => {
                  const isActive = entry.version === activeVersion;
                  const isExpanded = expandedId === entry.id;
                  return (
                    <li
                      key={entry.id}
                      className='w-full overflow-hidden rounded-2xl border border-border bg-card'
                    >
                      <div className='flex flex-wrap items-center gap-2 px-4 py-3'>
                        <Pill tone={isActive ? 'success' : 'neutral'}>v{entry.version}</Pill>
                        <span className='min-w-0 flex-1 truncate text-sm leading-5 text-foreground'>
                          {entry.note || <span className='text-muted-foreground'>No note</span>}
                        </span>
                        <span className='shrink-0 text-xs leading-4 text-muted-foreground'>
                          {formatStamp(entry.createdAt)}
                        </span>
                        <button
                          type='button'
                          onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                          data-track-category='Claw Agents'
                          data-track-name='Agent detail v2: view prompt version'
                          className='flex h-7 shrink-0 items-center rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                        >
                          {isExpanded ? 'Hide' : 'View'}
                        </button>
                        {canRestore && !isActive && (
                          <button
                            type='button'
                            onClick={() => void restore(entry.version)}
                            disabled={activate.isPending}
                            data-track-category='Claw Agents'
                            data-track-name='Agent detail v2: restore prompt version'
                            className='flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
                          >
                            {restoring === entry.version && (
                              <Loader2 className='size-3.5 animate-spin' aria-hidden />
                            )}
                            Restore
                          </button>
                        )}
                      </div>

                      {isExpanded && (
                        <div className='border-t border-border px-4 py-3'>
                          <ScrollFadeBox
                            height={PROMPT_PREVIEW_HEIGHT}
                            className='border-0 bg-transparent p-0'
                            resetKeys={[entry.id]}
                          >
                            <p className='whitespace-pre-wrap break-words text-sm font-normal leading-5 tracking-[-0.28px] text-foreground'>
                              {entry.systemPrompt}
                            </p>
                          </ScrollFadeBox>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </DetailSection>
  );
}
