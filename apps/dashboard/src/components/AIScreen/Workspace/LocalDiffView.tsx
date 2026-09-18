import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { fetchFile } from '../../../services/clients/fileFetchService';
import type { ConversationArtifact } from '../../../services/XyneAI/XyneAIArtifactsService';
import {
  anchorComments,
  coverageReport,
  orderedFiles,
  parseUnifiedDiff,
  type AnchoredComment,
  type DiffFile,
  type DiffLine,
  type CoverageReport,
  type ReviewGuide,
  type ReviewSeverity,
} from './reviewDiff';

export { parseUnifiedDiff } from './reviewDiff';
export type { DiffFile, DiffLine } from './reviewDiff';

export function isLocalDiffArtifact(artifact: ConversationArtifact): boolean {
  return artifact.kind === 'DIFF' && (artifact.openRef.refId ?? '').startsWith('local:');
}

function patchFileName(title: string): string {
  const base = title.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'changes';
  return `${base.replace(/\s+/g, '-').toLowerCase()}.patch`;
}

function useLocalPatch(artifact: ConversationArtifact): {
  patch: string | null;
  loading: boolean;
  error: boolean;
} {
  const refId = artifact.latestVersionRef ?? null;
  const [patch, setPatch] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!refId) {
      setPatch(null);
      setLoading(false);
      setError(true);
      return (): void => {
        cancelled = true;
      };
    }
    setLoading(true);
    setError(false);
    void fetchFile(
      `/xyne-ai/v2/attachments/${encodeURIComponent(refId)}/download`,
      'changes.patch',
      'text/plain',
    )
      .then(file => file.text())
      .then(text => {
        if (!cancelled) setPatch(text);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return (): void => {
      cancelled = true;
    };
  }, [refId]);

  return { patch, loading, error };
}

export function LocalDiffActions({ artifact }: { artifact: ConversationArtifact }): ReactElement {
  const { patch } = useLocalPatch(artifact);
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    if (!patch) return;
    void navigator.clipboard
      .writeText(patch)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => setCopied(false));
  };

  const download = (): void => {
    if (!patch) return;
    const blob = new Blob([patch], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = patchFileName(artifact.title);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <span className='flex flex-shrink-0 items-center gap-0.5'>
      <button
        type='button'
        onClick={copy}
        disabled={!patch}
        aria-label='Copy patch'
        title={copied ? 'Copied' : 'Copy patch'}
        className='grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:opacity-40'
        data-track-category='AskAI'
        data-track-name='workspace-local-diff-copy'
      >
        <Copy className='h-4 w-4' />
      </button>
      <button
        type='button'
        onClick={download}
        disabled={!patch}
        aria-label='Download .patch'
        title='Download .patch'
        className='grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:opacity-40'
        data-track-category='AskAI'
        data-track-name='workspace-local-diff-download'
      >
        <Download className='h-4 w-4' />
      </button>
    </span>
  );
}

const SEVERITY_STYLES: Record<ReviewSeverity, string> = {
  high: 'border-rose-500/50 bg-rose-500/10 text-rose-400',
  medium: 'border-amber-500/50 bg-amber-500/10 text-amber-400',
  low: 'border-sky-500/50 bg-sky-500/10 text-sky-400',
  note: 'border-border bg-secondary/60 text-muted-foreground',
};

function lineClass(kind: DiffLine['kind']): string {
  switch (kind) {
    case 'add':
      return 'bg-emerald-500/10';
    case 'remove':
      return 'bg-rose-500/10';
    case 'meta':
      return 'bg-muted/50 text-muted-foreground';
    default:
      return '';
  }
}

function marker(kind: DiffLine['kind']): string {
  if (kind === 'add') return '+';
  if (kind === 'remove') return '-';
  return ' ';
}

function fileAnchorId(path: string): string {
  return `diff-file-${path.replace(/[^a-zA-Z0-9]/g, '-')}`;
}

function commentAnchorId(id: string): string {
  return `diff-comment-${id}`;
}

function scrollToId(id: string): void {
  document.getElementById(id)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function CommentCard({ comment }: { comment: AnchoredComment }): ReactElement {
  return (
    <div id={commentAnchorId(comment.id)} className='w-full min-w-0 px-3 py-1.5'>
      <div className={cn('rounded-lg border px-2.5 py-2', SEVERITY_STYLES[comment.severity])}>
        <div className='flex items-center gap-2'>
          <span className='rounded bg-background/60 px-1.5 py-0.5 font-mono text-[11px] font-semibold'>
            {comment.id}
          </span>
          <span className='text-xs font-semibold uppercase tracking-wide'>{comment.severity}</span>
          <span className='min-w-0 flex-1 truncate text-xs font-medium text-foreground'>
            {comment.title}
          </span>
        </div>
        {comment.body ? (
          <p className='mt-1 whitespace-pre-wrap text-xs leading-relaxed text-foreground/90'>
            {comment.body}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function CoverageBar({
  report,
  onJump,
}: {
  report: CoverageReport;
  onJump: (path: string) => void;
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  if (report.total === 0) return null;
  const complete = report.missing.length === 0;

  return (
    <div
      className={cn(
        'flex-shrink-0 border-b px-3 py-2 text-xs',
        complete ? 'border-border bg-secondary/20' : 'border-amber-500/40 bg-amber-500/10',
      )}
    >
      <div className='flex items-center gap-2'>
        {complete ? (
          <ShieldCheck className='h-3.5 w-3.5 flex-shrink-0 text-emerald-500' aria-hidden='true' />
        ) : (
          <AlertTriangle className='h-3.5 w-3.5 flex-shrink-0 text-amber-500' aria-hidden='true' />
        )}
        <span className='min-w-0 flex-1 text-foreground'>
          {complete
            ? `All ${report.total} files accounted for`
            : `${report.missing.length} of ${report.total} files were not reviewed`}
          {report.skipped.length > 0 ? (
            <span className='text-muted-foreground'>
              {' '}
              · {report.skipped.length} skipped on purpose
            </span>
          ) : null}
        </span>
        {report.missing.length > 0 || report.skipped.length > 0 ? (
          <button
            type='button'
            onClick={() => setOpen(value => !value)}
            data-track-category='AskAI'
            data-track-name='review-coverage-toggle'
            className='flex-shrink-0 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
          >
            {open ? 'Hide' : 'Show'}
          </button>
        ) : null}
      </div>

      {open ? (
        <div className='mt-2 space-y-1'>
          {report.missing.map(path => (
            <button
              key={path}
              type='button'
              onClick={() => onJump(path)}
              data-track-category='AskAI'
              data-track-name='review-jump-missing'
              className='block w-full truncate text-left font-mono text-[11px] text-foreground underline-offset-2 hover:underline'
            >
              {path}
            </button>
          ))}
          {report.skipped.map(row => (
            <div key={row.file} className='flex min-w-0 items-baseline gap-2'>
              <button
                type='button'
                onClick={() => onJump(row.file)}
                data-track-category='AskAI'
                data-track-name='review-jump-skipped'
                className='min-w-0 flex-1 truncate text-left font-mono text-[11px] text-muted-foreground underline-offset-2 hover:underline'
              >
                {row.file}
              </button>
              {row.note ? (
                <span className='flex-shrink-0 text-[11px] text-muted-foreground'>{row.note}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReviewHeader({
  guide,
  files,
  onJump,
}: {
  guide: ReviewGuide;
  files: DiffFile[];
  onJump: (path: string) => void;
}): ReactElement | null {
  if (!guide.summary && !guide.verdict && guide.order.length === 0) return null;
  const known = new Set(files.map(file => file.path));
  return (
    <div className='flex-shrink-0 border-b border-border bg-secondary/20 px-3 py-2.5'>
      {guide.verdict ? (
        <p className='text-xs font-semibold text-foreground'>{guide.verdict}</p>
      ) : null}
      {guide.summary ? (
        <p className='mt-1 text-xs leading-relaxed text-muted-foreground'>{guide.summary}</p>
      ) : null}
      {guide.order.length > 0 ? (
        <ol className='mt-2 space-y-1'>
          {guide.order.map((entry, index) => (
            <li key={entry.file} className='flex items-start gap-2 text-xs'>
              <span className='mt-0.5 font-mono text-[11px] text-muted-foreground'>
                {index + 1}.
              </span>
              <button
                type='button'
                onClick={() => onJump(entry.file)}
                data-track-category='AskAI'
                data-track-name='review-jump-finding'
                disabled={!known.has(entry.file)}
                className='min-w-0 flex-1 text-left disabled:opacity-60'
              >
                <span className='truncate font-mono text-[11px] text-foreground underline-offset-2 hover:underline'>
                  {entry.file}
                </span>
                {entry.why ? (
                  <span className='ml-1.5 text-muted-foreground'>{entry.why}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function CommentNav({ comments }: { comments: AnchoredComment[] }): ReactElement | null {
  const [index, setIndex] = useState(0);
  if (comments.length === 0) return null;

  const go = (next: number): void => {
    const wrapped = (next + comments.length) % comments.length;
    setIndex(wrapped);
    scrollToId(commentAnchorId(comments[wrapped]!.id));
  };

  return (
    <div className='flex flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 py-1.5'>
      <span className='flex-shrink-0 pr-1 text-[11px] text-muted-foreground'>
        {comments.length} comment{comments.length === 1 ? '' : 's'}
      </span>
      <button
        type='button'
        onClick={() => go(index - 1)}
        aria-label='Previous comment'
        data-track-category='AskAI'
        data-track-name='review-comment-prev'
        className='grid h-6 w-6 flex-shrink-0 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
      >
        <ChevronLeft className='h-3.5 w-3.5' />
      </button>
      <button
        type='button'
        onClick={() => go(index + 1)}
        aria-label='Next comment'
        data-track-category='AskAI'
        data-track-name='review-comment-next'
        className='grid h-6 w-6 flex-shrink-0 place-items-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
      >
        <ChevronRight className='h-3.5 w-3.5' />
      </button>
      <div className='flex min-w-0 items-center gap-1'>
        {comments.map((comment, at) => (
          <button
            key={comment.id}
            type='button'
            onClick={() => {
              setIndex(at);
              scrollToId(commentAnchorId(comment.id));
            }}
            data-track-category='AskAI'
            data-track-name='review-comment-dot'
            title={`${comment.title} · ${comment.file}`}
            className={cn(
              'flex-shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] transition-colors',
              SEVERITY_STYLES[comment.severity],
              at === index ? 'ring-1 ring-ring' : '',
            )}
          >
            {comment.id}
          </button>
        ))}
      </div>
    </div>
  );
}

function FileSection({
  file,
  comments,
  defaultOpen,
  coverage,
}: {
  file: DiffFile;
  comments: AnchoredComment[];
  defaultOpen: boolean;
  coverage: 'reviewed' | 'skipped' | 'missing' | null;
}): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const byIndex = useMemo(() => {
    const map = new Map<number, AnchoredComment[]>();
    for (const comment of comments) {
      if (comment.anchorIndex === null) continue;
      const list = map.get(comment.anchorIndex) ?? [];
      list.push(comment);
      map.set(comment.anchorIndex, list);
    }
    return map;
  }, [comments]);
  const orphans = comments.filter(comment => comment.anchorIndex === null);

  return (
    <section id={fileAnchorId(file.path)} className='w-full min-w-0 border-b border-border'>
      <button
        type='button'
        onClick={() => setOpen(value => !value)}
        disabled={file.lines.length === 0}
        data-track-category='AskAI'
        data-track-name='review-file-toggle'
        className='sticky top-0 z-[1] flex w-full min-w-0 items-center gap-2 border-b border-border bg-background px-3 py-2 text-left hover:bg-secondary/40'
      >
        {file.lines.length === 0 ? (
          <span className='h-3.5 w-3.5 flex-shrink-0' />
        ) : open ? (
          <ChevronDown className='h-3.5 w-3.5 flex-shrink-0 text-muted-foreground' />
        ) : (
          <ChevronRight className='h-3.5 w-3.5 flex-shrink-0 text-muted-foreground' />
        )}
        <span
          className='min-w-0 flex-1 truncate font-mono text-xs text-foreground'
          title={file.path}
        >
          {file.path}
        </span>
        {comments.length > 0 ? (
          <span className='flex-shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground'>
            {comments.map(comment => comment.id).join(' ')}
          </span>
        ) : null}
        {coverage === 'missing' ? (
          <span className='flex-shrink-0 rounded border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400'>
            not reviewed
          </span>
        ) : coverage === 'skipped' ? (
          <span className='flex-shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground'>
            skipped
          </span>
        ) : null}
        {file.lines.length === 0 ? (
          <span className='flex-shrink-0 text-[11px] text-muted-foreground'>
            no textual changes
          </span>
        ) : (
          <>
            <span className='flex-shrink-0 font-mono text-[11px] text-emerald-500'>
              +{file.added}
            </span>
            <span className='flex-shrink-0 font-mono text-[11px] text-rose-500'>
              -{file.removed}
            </span>
          </>
        )}
      </button>

      {open && file.lines.length > 0 ? (
        <>
          {orphans.map(comment => (
            <CommentCard key={comment.id} comment={comment} />
          ))}
          <div className='w-full min-w-0 overflow-x-auto'>
            <div className='min-w-full w-max font-mono text-[11.5px] leading-[1.6]'>
              {file.lines.map((line, index) => (
                <div key={index}>
                  <div className={cn('flex whitespace-pre', lineClass(line.kind))}>
                    <span className='w-10 flex-shrink-0 select-none pr-2 text-right text-muted-foreground/60'>
                      {line.oldLine ?? ''}
                    </span>
                    <span className='w-10 flex-shrink-0 select-none pr-2 text-right text-muted-foreground/60'>
                      {line.newLine ?? ''}
                    </span>
                    <span className='w-4 flex-shrink-0 select-none text-muted-foreground'>
                      {marker(line.kind)}
                    </span>
                    <span className='pr-3'>{line.text === '' ? ' ' : line.text}</span>
                  </div>
                  {(byIndex.get(index) ?? []).map(comment => (
                    <CommentCard key={comment.id} comment={comment} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

export function LocalDiffView({
  artifact,
  guide,
}: {
  artifact: ConversationArtifact;
  guide?: ReviewGuide | null;
}): ReactElement {
  const { patch, loading, error } = useLocalPatch(artifact);
  const parsed = useMemo(() => (patch ? parseUnifiedDiff(patch) : []), [patch]);
  const files = useMemo(() => orderedFiles(parsed, guide ?? null), [parsed, guide]);
  const anchored = useMemo(() => anchorComments(files, guide?.comments ?? []), [files, guide]);
  const flat = useMemo(
    () => files.flatMap(file => anchored.get(file.path) ?? []),
    [files, anchored],
  );
  const coverage = useMemo(() => coverageReport(files, guide ?? null), [files, guide]);
  const coverageOf = useMemo(() => {
    const map = new Map<string, 'reviewed' | 'skipped' | 'missing'>();
    if (!coverage) return map;
    for (const path of coverage.reviewed) map.set(path, 'reviewed');
    for (const row of coverage.skipped) map.set(row.file, 'skipped');
    for (const path of coverage.missing) map.set(path, 'missing');
    return map;
  }, [coverage]);

  if (loading) {
    return (
      <div className='flex h-full items-center justify-center'>
        <div className='h-6 w-6 animate-spin rounded-full border-b-2 border-ring' />
      </div>
    );
  }

  if (error || patch === null) {
    return (
      <div className='flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground'>
        Could not load these changes.
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className='flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground'>
        No file changes in this patch.
      </div>
    );
  }

  return (
    <div className='flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background'>
      {guide ? (
        <ReviewHeader guide={guide} files={files} onJump={path => scrollToId(fileAnchorId(path))} />
      ) : null}
      {coverage ? (
        <CoverageBar report={coverage} onJump={path => scrollToId(fileAnchorId(path))} />
      ) : null}
      <CommentNav comments={flat} />
      <div className='min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden'>
        {files.map(file => (
          <FileSection
            key={file.path}
            file={file}
            comments={anchored.get(file.path) ?? []}
            defaultOpen={files.length <= 12 || (anchored.get(file.path) ?? []).length > 0}
            coverage={coverageOf.get(file.path) ?? null}
          />
        ))}
      </div>
    </div>
  );
}
