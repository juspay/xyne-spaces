/* eslint-disable local-rules/require-tracking-on-click */
import { ReactElement, useMemo, useState } from 'react';
import type { VCSProviderType } from '@xyne/shared';
import { cn } from '../../utils/classNames';
import { RepoDot, ProviderBadge, repoColor, repoShortName } from './repoVisual';

/**
 * Shared rendering for env/migration change groups used by:
 *   - ReleaseDetailScreen — Envs and Migrations tabs (release-wide groups)
 *   - ApplicationReleaseTicketDetailScreen — dev-ticket-scoped groups
 *
 * One section per app, one collapsible card per file. The card body lists
 * *every* change to that file (one block per release_change_types row),
 * because dedup-by-file-only would otherwise hide changes when multiple
 * dev tickets touch the same env/migration file in the same release.
 *
 * Caller filters/sorts the input groups.
 */

export type FileChangeEntry = {
  // release_change_types.id — the key into valuesByChangeId for this row's
  // EAV bag (oldValue/newValue/changeLog/...).
  id: string;
  commitId: string | null;
  devTicketXyneId: string | null;
  createdAt: number;
};

export type RenderableFileGroup = {
  key: string;
  changeType: string;
  filePath: string;
  // Oldest change first so the user reads in the order changes landed.
  changes: FileChangeEntry[];
  // Sort key for the caller — oldest change in the group.
  earliestAt: number;
  // Aggregated for the card header counter.
  devTicketXyneIds: Set<string>;
  commitIds: Set<string>;
};

export interface ChangeSectionsGroup {
  appName: string;
  repoUrl: string | null;
  vcsProvider?: VCSProviderType | null;
  files: RenderableFileGroup[];
}

interface ChangeSectionsProps {
  groups: ChangeSectionsGroup[];
  kind: 'ENV' | 'MIGRATION';
  emptyMessage: string;
  valuesByChangeId: Map<string, Record<string, string>>;
  // ART detail page is already scoped to one dev ticket, so per-change
  // dev-ticket badges are redundant there. Pass true to suppress.
  hideDevTickets?: boolean;
}

// Strip git-diff metadata noise from a unified-diff string, returning the
// remaining content lines as plain strings. Drops `diff --git`, mode lines,
// `index …`, `--- /dev/null`, `+++ …`, and hunk headers `@@ … @@`.
//
// We intentionally do NOT classify lines as add/del/ctx based on the leading
// character. After the backend's write-time cleanup, content lines no longer
// carry `+`/`-`/space markers — and SQL `--` comments would be misread as
// deletion markers if we tried. Legacy pre-cleanup rows still display
// readably (just with the original `+`/`-` prefix visible in the text).
const cleanDiff = (raw: string): string[] => {
  const drop =
    /^(diff --git |index |new file mode |deleted file mode |old mode |new mode |--- |\+\+\+ |@@ )/;
  return raw.split('\n').filter(line => !drop.test(line));
};

// github.com / GHE host → GitHub URLs; else Bitbucket. Rejects github.com.<lookalike>.
const isGitHubRepoUrl = (repoUrl: string): boolean => {
  try {
    const host = new URL(repoUrl).hostname.toLowerCase();
    return (
      host === 'github.com' ||
      host === 'www.github.com' ||
      (host.startsWith('github.') && !host.startsWith('github.com.'))
    );
  } catch {
    return false;
  }
};

// Repo web base (strip trailing slash + .git).
const repoWebBase = (repoUrl: string): string => repoUrl.replace(/\/$/, '').replace(/\.git$/, '');

// File link for a commit — GitHub blob/<sha> or Bitbucket browse?at=<sha>.
const buildFileUrl = (
  repoUrl: string | null,
  filePath: string,
  commitId: string | null,
): string | null => {
  if (!repoUrl) return null;
  const base = repoWebBase(repoUrl);
  const path = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  if (isGitHubRepoUrl(repoUrl)) {
    return `${base}/blob/${commitId ?? 'HEAD'}/${path}`;
  }
  return commitId ? `${base}/browse/${path}?at=${commitId}` : `${base}/browse/${path}`;
};

// Single-commit URL per provider.
const buildCommitUrl = (repoUrl: string | null, commitId: string | null): string | null => {
  if (!repoUrl || !commitId) return null;
  const base = repoWebBase(repoUrl);
  return isGitHubRepoUrl(repoUrl) ? `${base}/commit/${commitId}` : `${base}/commits/${commitId}`;
};

/**
 * Renders env or migration change groups as app-sectioned cards. Caller
 * supplies the already-filtered + sorted groups. One block per file under
 * each app; clicking a card header expands to show every change to that
 * file (one block per change row).
 */
export const ChangeSections = ({
  groups,
  kind,
  emptyMessage,
  valuesByChangeId,
  hideDevTickets = false,
}: ChangeSectionsProps): ReactElement => {
  const byRepo = useMemo(() => {
    const map = new Map<string, ChangeSectionsGroup[]>();
    for (const g of groups) {
      const key = g.repoUrl ?? '';
      const arr = map.get(key);
      if (arr) arr.push(g);
      else map.set(key, [g]);
    }
    return [...map.entries()];
  }, [groups]);

  if (groups.length === 0) {
    return (
      <div className='text-center py-8 bg-muted rounded-lg border border-dashed border-border'>
        <p className='text-sm text-muted-foreground'>{emptyMessage}</p>
      </div>
    );
  }
  return (
    <>
      {byRepo.map(([repoKey, appGroups]) => {
        const repoUrl = appGroups[0]?.repoUrl ?? null;
        return (
          <div key={repoKey || 'no-repo'} className='space-y-3'>
            {byRepo.length > 1 && (
              <div className='flex items-center gap-2.5 border-b border-border pb-2'>
                <RepoDot color={repoColor(repoKey || repoUrl)} />
                <span className='text-sm font-semibold text-foreground'>
                  {repoShortName(repoUrl)}
                </span>
                <ProviderBadge vcsProvider={appGroups[0]?.vcsProvider ?? null} showLabel={false} />
                <span className='ml-auto rounded-md bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground'>
                  repo
                </span>
              </div>
            )}
            {appGroups.map(app => (
              <section key={app.appName} className='space-y-3'>
                <h3 className='text-base font-semibold text-foreground'>{app.appName}</h3>
                <div className='space-y-3'>
                  {app.files.map(f => (
                    <ChangeCard
                      key={f.key}
                      file={f}
                      kind={kind}
                      repoUrl={app.repoUrl}
                      valuesByChangeId={valuesByChangeId}
                      hideDevTickets={hideDevTickets}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        );
      })}
    </>
  );
};

interface ChangeCardProps {
  file: RenderableFileGroup;
  kind: 'ENV' | 'MIGRATION';
  repoUrl: string | null;
  valuesByChangeId: Map<string, Record<string, string>>;
  hideDevTickets?: boolean;
}

/**
 * One file-level card. Header is always visible; clicking it toggles a
 * stacked list of every change to this file in the current scope. Each
 * change block carries its own dev-ticket attribution (when not hidden),
 * commit link, and diff (env: stacked red/green blocks; migration:
 * cleaned + color-coded diff).
 */
const ChangeCard = ({
  file: f,
  kind,
  repoUrl,
  valuesByChangeId,
  hideDevTickets = false,
}: ChangeCardProps): ReactElement => {
  const [open, setOpen] = useState(false);
  const isEnv = kind === 'ENV';
  // File-browse link uses the *latest* commit so the user lands on the
  // current state of the file (changes[] is oldest-first → take last).
  const latestCommitId = f.changes.at(-1)?.commitId ?? null;
  const fileUrl = buildFileUrl(repoUrl, f.filePath, latestCommitId);
  const changeCount = f.changes.length;

  return (
    <div className='border border-border rounded-lg bg-background overflow-hidden'>
      {/* Header — clickable to toggle. The filePath link inside still
          navigates to Bitbucket without triggering expand (stopPropagation). */}
      <button
        type='button'
        onClick={() => setOpen(prev => !prev)}
        data-track-category='Release'
        data-track-name='TOGGLE_CHANGE_CARD'
        className='w-full flex items-center gap-2 px-4 py-3 hover:bg-muted/40 transition-colors text-left'
      >
        <span className='text-xs text-muted-foreground w-3 shrink-0'>{open ? '▼' : '▶'}</span>
        <span
          className={cn(
            'text-xs px-2 py-0.5 rounded shrink-0',
            isEnv
              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
          )}
        >
          {isEnv ? 'env' : 'migration'}
        </span>
        {fileUrl ? (
          <a
            href={fileUrl}
            target='_blank'
            rel='noopener noreferrer'
            onClick={e => e.stopPropagation()}
            className='font-mono text-sm text-foreground hover:underline truncate'
          >
            {f.filePath}
          </a>
        ) : (
          <span className='font-mono text-sm text-foreground truncate'>{f.filePath}</span>
        )}
        <span className='ml-auto text-xs text-muted-foreground shrink-0'>
          {changeCount} commit{changeCount === 1 ? '' : 's'}
        </span>
      </button>

      {open && (
        <div className='border-t border-border px-4 py-3 space-y-4'>
          {f.changes.map((change, idx) => (
            <ChangeBlock
              key={change.id}
              kind={kind}
              change={change}
              values={valuesByChangeId.get(change.id) ?? {}}
              repoUrl={repoUrl}
              hideDevTickets={hideDevTickets}
              showSeparator={idx > 0}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface ChangeBlockProps {
  kind: 'ENV' | 'MIGRATION';
  change: FileChangeEntry;
  values: Record<string, string>;
  repoUrl: string | null;
  hideDevTickets: boolean;
  showSeparator: boolean;
}

/**
 * One change row inside a file card. Shows attribution chips (dev ticket
 * + commit short hash) and this row's diff.
 */
const ChangeBlock = ({
  kind,
  change,
  values,
  repoUrl,
  hideDevTickets,
  showSeparator,
}: ChangeBlockProps): ReactElement => {
  const isEnv = kind === 'ENV';
  const oldVal = values['oldValue'] ?? '';
  const newVal = values['newValue'] ?? '';
  const description = values['description'] ?? '';
  const changeLog = values['changeLog'] ?? '';
  const commitUrl = buildCommitUrl(repoUrl, change.commitId);
  const commitShort = change.commitId ? change.commitId.slice(0, 7) : null;

  return (
    <div className={cn('space-y-2', showSeparator && 'pt-4 border-t border-border')}>
      {/* Attribution row */}
      <div className='flex items-center gap-2 flex-wrap text-xs'>
        {!hideDevTickets && (
          <span className='px-2 py-0.5 rounded bg-muted text-foreground'>
            {change.devTicketXyneId || 'Unmapped'}
          </span>
        )}
        {commitShort &&
          (commitUrl ? (
            <a
              href={commitUrl}
              target='_blank'
              rel='noopener noreferrer'
              className='font-mono text-muted-foreground hover:text-foreground hover:underline'
            >
              {commitShort}
            </a>
          ) : (
            <span className='font-mono text-muted-foreground'>{commitShort}</span>
          ))}
        {description && <span className='text-muted-foreground'>· {description}</span>}
      </div>

      {isEnv ? (
        // Stacked red (removed) / green (added) blocks, oldValue above
        // newValue. Single block when oldValue is empty (pure addition).
        oldVal || newVal ? (
          <div className='border border-border rounded overflow-hidden text-xs font-mono'>
            {oldVal && (
              <pre className='px-3 py-2 whitespace-pre-wrap break-all bg-red-50 text-red-900 dark:bg-red-900/20 dark:text-red-200'>
                {oldVal}
              </pre>
            )}
            {newVal && (
              <pre className='px-3 py-2 whitespace-pre-wrap break-all bg-green-50 text-green-900 dark:bg-green-900/20 dark:text-green-200'>
                {newVal}
              </pre>
            )}
          </div>
        ) : null
      ) : (
        // Migration diff — card is the collapse boundary, so render inline.
        // Plain text (no per-line coloring): migrations are almost always
        // new files (all additions), and SQL `--` comments would be
        // misclassified as deletions if we tried to color by leading char.
        changeLog &&
        (() => {
          const lines = cleanDiff(changeLog);
          if (lines.length === 0) return null;
          return (
            <pre className='text-xs bg-muted rounded p-2 whitespace-pre-wrap font-mono leading-tight text-foreground'>
              {lines.join('\n')}
            </pre>
          );
        })()
      )}
    </div>
  );
};
