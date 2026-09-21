import { ReactElement, useEffect, useState } from 'react';
import { Tag } from 'lucide-react';
import {
  MIGRATION_TAGS,
  toggleMigrationTag,
  type MigrationFinding,
  type MigrationTag,
} from '@xyne/shared';
import { Popover } from '../ui/Popover/Popover';
import { Checkbox } from '../ui/Checkbox/Checkbox';
import { cn } from '../../utils/classNames';

const TAG_STYLES = new Map<MigrationTag, string>([
  ['backward-compatible', 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'],
  ['breaking', 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'],
  ['data-backfill', 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200'],
  ['downtime', 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200'],
  ['long-running', 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'],
  ['irreversible', 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200'],
  ['manual-step', 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200'],
  ['zero-expand', 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200'],
  ['zero-contract', 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-200'],
  ['zero-unsafe', 'bg-red-200 text-red-900 dark:bg-red-900/60 dark:text-red-100'],
]);

const TAG_ACTIONS = new Map<MigrationTag, string>([
  ['breaking', 'deploy app and migration together, no old pods left serving'],
  ['data-backfill', 'watch write load and row counts while it runs'],
  ['downtime', 'book a maintenance window and announce it'],
  ['long-running', 'run off-peak; expect it to hold locks for a while'],
  ['irreversible', 'take a backup / snapshot first — there is no rollback'],
  ['manual-step', 'read each migration note before deploying'],
  ['zero-expand', 'DB → wait for zero-cache replication (and backfill) → API → client'],
  ['zero-contract', 'client → API → DB, or live clients hit onUpdateNeeded'],
  [
    'zero-unsafe',
    'add a primary key or unique index before this ships — zero-cache cannot replicate it',
  ],
]);

const tagMeta = (tag: MigrationTag): { label: string; description: string } =>
  MIGRATION_TAGS.find(t => t.value === tag) ?? { label: tag, description: '' };

export const MigrationTagChip = ({
  tag,
  title,
}: {
  tag: MigrationTag;
  title?: string;
}): ReactElement => (
  <span
    className={cn('text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap', TAG_STYLES.get(tag))}
    title={title ?? tagMeta(tag).description}
  >
    {tagMeta(tag).label}
  </span>
);

interface MigrationTagsProps {
  tags: MigrationTag[];
  note: string;
  findings?: MigrationFinding[];
  // Absent → read-only chips.
  onChange?: (next: { tags: MigrationTag[]; note: string }) => void;
}

export const MigrationTags = ({
  tags,
  note,
  findings = [],
  onChange,
}: MigrationTagsProps): ReactElement => {
  const [draftNote, setDraftNote] = useState(note);
  useEffect(() => setDraftNote(note), [note]);
  const evidenceFor = (tag: MigrationTag): string | undefined =>
    findings.find(f => f.tag === tag)?.evidence;

  return (
    <span className='flex items-center gap-1 flex-wrap justify-end'>
      {tags.map(tag => {
        const evidence = evidenceFor(tag);
        return <MigrationTagChip key={tag} tag={tag} {...(evidence ? { title: evidence } : {})} />;
      })}
      {onChange && (
        <Popover
          align='end'
          className='w-80 p-2'
          trigger={
            <button
              type='button'
              aria-label='Edit migration tags'
              data-track-category='Release'
              data-track-name='OPEN_MIGRATION_TAGS'
              className='flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground'
            >
              <Tag size={12} />
              {tags.length === 0 && 'Tag'}
            </button>
          }
        >
          <ul className='space-y-1'>
            {MIGRATION_TAGS.map(t => {
              const evidence = evidenceFor(t.value);
              return (
                <li key={t.value} className='rounded px-1 py-1 hover:bg-muted/60'>
                  <span className='flex items-center gap-1.5'>
                    <Checkbox
                      size='sm'
                      checked={tags.includes(t.value)}
                      onChange={() => onChange({ tags: toggleMigrationTag(tags, t.value), note })}
                      label={t.label}
                      labelClassName='text-sm text-foreground'
                    />
                    {evidence && !tags.includes(t.value) && (
                      <span className='text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300'>
                        suggested
                      </span>
                    )}
                  </span>
                  <span className='block pl-5 text-xs text-muted-foreground'>{t.description}</span>
                  {evidence && (
                    <code
                      className='block pl-5 text-[11px] text-foreground/80 truncate'
                      title={evidence}
                    >
                      {evidence}
                    </code>
                  )}
                </li>
              );
            })}
          </ul>
          <label className='mt-2 block border-t border-border pt-2 text-xs text-muted-foreground'>
            Deployment note
            <textarea
              value={draftNote}
              data-track-category='Release'
              data-track-name='EDIT_MIGRATION_NOTE'
              onChange={e => setDraftNote(e.target.value)}
              onBlur={() => {
                if (draftNote.trim() !== note) onChange({ tags, note: draftNote.trim() });
              }}
              rows={2}
              placeholder='Why it is risky, what to run first, who to ping…'
              className='mt-1 w-full resize-none rounded border border-border bg-background px-2 py-1 text-sm text-foreground'
            />
          </label>
        </Popover>
      )}
    </span>
  );
};

export const MigrationRiskAnalysis = ({
  findings,
}: {
  findings: MigrationFinding[];
}): ReactElement | null => {
  if (findings.length === 0) return null;
  return (
    <ul className='space-y-1 rounded border border-border bg-muted/40 px-3 py-2 text-xs'>
      {findings.map(f => (
        <li key={`${f.tag}:${f.evidence}`} className='flex items-start gap-2'>
          <MigrationTagChip tag={f.tag} />
          <code className='min-w-0 break-all text-foreground/80'>{f.evidence}</code>
        </li>
      ))}
    </ul>
  );
};

export const MigrationRiskSummary = ({
  tagsByFile,
}: {
  tagsByFile: ReadonlyArray<MigrationTag[]>;
}): ReactElement | null => {
  const total = tagsByFile.length;
  if (total === 0) return null;
  const counts = new Map<MigrationTag, number>();
  for (const tags of tagsByFile) for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const untagged = tagsByFile.filter(t => t.length === 0).length;
  const actions = [...counts.keys()].filter(t => TAG_ACTIONS.has(t));

  return (
    <div className='rounded-lg border border-border bg-muted/30 px-4 py-3 space-y-2'>
      <div className='flex flex-wrap items-center gap-2 text-sm'>
        <span className='font-medium text-foreground'>
          {total} migration{total === 1 ? '' : 's'}
        </span>
        {[...counts.entries()].map(([tag, n]) => (
          <span key={tag} className='flex items-center gap-1'>
            <MigrationTagChip tag={tag} />
            <span className='text-xs text-muted-foreground'>×{n}</span>
          </span>
        ))}
        {untagged > 0 && (
          <span className='text-xs text-muted-foreground'>· {untagged} untagged</span>
        )}
      </div>
      {actions.length > 0 && (
        <ul className='space-y-0.5 text-xs text-muted-foreground'>
          {actions.map(tag => (
            <li key={tag}>
              <span className='font-medium text-foreground'>{tagMeta(tag).label}:</span>{' '}
              {TAG_ACTIONS.get(tag)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
