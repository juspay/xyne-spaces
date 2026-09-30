import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../ui/Select/Select';
import { Tooltip } from '../../../ui/Tooltip';
import { useUsersById } from '../../../../hooks/useUsers';
import { fetchAutomationVersions } from '../../../../api/automationsApi';
import { AutomationBuilder } from '../../AutomationBuilder/AutomationBuilder';
import type { Automation } from '../../Automation.types';
import {
  DiffHighlightContext,
  type DiffHighlightValue,
} from '../../AutomationBuilder/DiffHighlight/DiffHighlight';
import { computeVersionDiff, summarizeDiff } from './VersionDiffView.utils';

interface VersionDiffViewProps {
  automationId: string;
  fromId: string;
  toId: string;
  onFromChange: (id: string) => void;
  onToChange: (id: string) => void;
  onClose: () => void;
}

const noop = (): void => undefined;

type UsersById = Map<string, { name?: string; email?: string }>;

function versionLabel(
  version: Automation,
  position: number,
  total: number,
  usersById: UsersById,
): string {
  const editor = usersById.get(version.createdById);
  const editorLabel = editor?.name ?? editor?.email ?? 'unknown';
  return `v${total - position} · ${version.status} · ${editorLabel} · ${new Date(version.createdAt).toLocaleString()}`;
}

function VersionPicker({
  value,
  onChange,
  versions,
  usersById,
}: {
  value: string;
  onChange: (id: string) => void;
  versions: Automation[];
  usersById: UsersById;
}): React.ReactElement {
  return (
    <div className='w-[360px]'>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className='h-8 text-xs'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {versions.map((v, i) => (
            <SelectItem key={v.id} value={v.id}>
              {versionLabel(v, i, versions.length, usersById)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// Kept independent of `VersionHistory`'s own fetch so this view can be mounted
// on its own (driven purely by the `fromId`/`toId` it's given) — same query
// key, so React Query serves it from cache when both are open.
export function VersionDiffView({
  automationId,
  fromId,
  toId,
  onFromChange,
  onToChange,
  onClose,
}: VersionDiffViewProps): React.ReactElement {
  const { data } = useQuery({
    queryKey: ['automation-versions', automationId],
    queryFn: () => fetchAutomationVersions(automationId),
  });
  const versions = useMemo(() => data ?? [], [data]);
  const usersById = useUsersById();

  const from = useMemo(() => versions.find(v => v.id === fromId), [versions, fromId]);
  const to = useMemo(() => versions.find(v => v.id === toId), [versions, toId]);

  // Colour by age, not by side: the pickers can put either version on the left,
  // and "Removed" must always mean "not in the newer one".
  const highlights = useMemo(() => {
    if (!from || !to || from.id === to.id) return null;
    const fromIsOlder = new Date(from.createdAt).getTime() <= new Date(to.createdAt).getTime();
    const [older, newer] = fromIsOlder ? [from, to] : [to, from];
    const diff = computeVersionDiff(older.config, newer.config);
    const olderValue: DiffHighlightValue = { tone: 'old', marks: diff.olderMarks };
    const newerValue: DiffHighlightValue = { tone: 'new', marks: diff.newerMarks };
    const otherChanges = (['name', 'description', 'priority'] as const).filter(
      key => (older[key] ?? null) !== (newer[key] ?? null),
    );
    return {
      from: fromIsOlder ? olderValue : newerValue,
      to: fromIsOlder ? newerValue : olderValue,
      summary: summarizeDiff(diff.counts, otherChanges),
      hasChanges: diff.newerMarks.size > 0 || diff.olderMarks.size > 0 || otherChanges.length > 0,
    };
  }, [from, to]);

  return (
    <div className='flex h-full w-full flex-col bg-background'>
      <div className='flex flex-wrap items-center gap-2 border-b border-border px-6 py-3'>
        <Tooltip content='Back to version history' side='bottom'>
          <button
            type='button'
            onClick={onClose}
            aria-label='Back to version history'
            data-track-category='automation-versions'
            data-track-name='version-diff-back'
            className='flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40'
          >
            <ArrowLeft className='size-4' />
          </button>
        </Tooltip>
        <span className='text-xs font-medium text-muted-foreground'>Compare</span>
        <VersionPicker
          value={fromId}
          onChange={onFromChange}
          versions={versions}
          usersById={usersById}
        />
        <span className='text-xs font-medium text-muted-foreground'>with</span>
        <VersionPicker
          value={toId}
          onChange={onToChange}
          versions={versions}
          usersById={usersById}
        />
      </div>

      {highlights && (
        <div className='flex flex-wrap items-center gap-3 border-b border-border bg-muted/30 px-6 py-2 text-xs text-muted-foreground'>
          <span className='font-medium text-foreground'>{highlights.summary}</span>
          {highlights.hasChanges && (
            <>
              <span className='flex items-center gap-1.5'>
                <span className='size-2.5 rounded-sm bg-red-500/60' aria-hidden='true' />
                Older version
              </span>
              <span className='flex items-center gap-1.5'>
                <span className='size-2.5 rounded-sm bg-green-500/60' aria-hidden='true' />
                Newer version
              </span>
            </>
          )}
        </div>
      )}

      <div className='flex min-h-0 flex-1 divide-x divide-border'>
        <div className='min-h-0 min-w-0 flex-1'>
          {from ? (
            <DiffHighlightContext.Provider value={highlights?.from ?? null}>
              <AutomationBuilder key={from.id} automation={from} onBack={noop} readOnlyPreview />
            </DiffHighlightContext.Provider>
          ) : null}
        </div>
        <div className='min-h-0 min-w-0 flex-1'>
          {to ? (
            <DiffHighlightContext.Provider value={highlights?.to ?? null}>
              <AutomationBuilder key={to.id} automation={to} onBack={noop} readOnlyPreview />
            </DiffHighlightContext.Provider>
          ) : null}
        </div>
      </div>
    </div>
  );
}
