export interface DiffLine {
  kind: 'add' | 'remove' | 'context' | 'meta';
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffFile {
  path: string;
  added: number;
  removed: number;
  lines: DiffLine[];
}

export type ReviewSeverity = 'high' | 'medium' | 'low' | 'note';

export interface ReviewComment {
  id: string;
  file: string;
  line: number | null;
  severity: ReviewSeverity;
  title: string;
  body: string;
}

export interface CoverageRow {
  file: string;
  status: 'reviewed' | 'skipped';
  note: string;
}

export interface ReviewGuide {
  summary: string;
  verdict: string;
  order: Array<{ file: string; why: string }>;
  coverage: CoverageRow[];
  comments: ReviewComment[];
}

export interface CoverageReport {
  reviewed: string[];
  skipped: CoverageRow[];
  missing: string[];
  claimed: number;
  total: number;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function stripPrefix(raw: string): string {
  const value = raw.trim().split('\t')[0] ?? '';
  if (value === '/dev/null') return value;
  return value.replace(/^[ab]\//, '');
}

export function parseUnifiedDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | undefined;
  let oldNext = 0;
  let newNext = 0;

  const start = (path: string): DiffFile => {
    const file: DiffFile = { path, added: 0, removed: 0, lines: [] };
    files.push(file);
    return file;
  };

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const parts = line.slice('diff --git '.length).split(' ');
      current = start(stripPrefix(parts[parts.length - 1] ?? ''));
      continue;
    }
    if (line.startsWith('--- ')) {
      if (!current) current = start(stripPrefix(line.slice(4)));
      continue;
    }
    if (line.startsWith('+++ ')) {
      const path = stripPrefix(line.slice(4));
      if (current && path !== '/dev/null') current.path = path;
      continue;
    }
    if (!current) continue;

    const hunk = HUNK_RE.exec(line);
    if (hunk) {
      oldNext = Number(hunk[1]);
      newNext = Number(hunk[3]);
      current.lines.push({ kind: 'meta', text: line, oldLine: null, newLine: null });
      continue;
    }
    if (line.startsWith('+')) {
      current.added += 1;
      current.lines.push({ kind: 'add', text: line.slice(1), oldLine: null, newLine: newNext });
      newNext += 1;
      continue;
    }
    if (line.startsWith('-')) {
      current.removed += 1;
      current.lines.push({ kind: 'remove', text: line.slice(1), oldLine: oldNext, newLine: null });
      oldNext += 1;
      continue;
    }
    if (line.startsWith(' ') || line === '') {
      if (current.lines.length === 0) continue;
      current.lines.push({
        kind: 'context',
        text: line.slice(1),
        oldLine: oldNext,
        newLine: newNext,
      });
      oldNext += 1;
      newNext += 1;
      continue;
    }
    if (line.startsWith('\\')) {
      current.lines.push({ kind: 'context', text: line, oldLine: null, newLine: null });
    }
  }

  return files;
}

function severityOf(value: unknown): ReviewSeverity {
  const text = typeof value === 'string' ? value.toLowerCase() : '';
  if (text === 'high' || text === 'critical' || text === 'blocker') return 'high';
  if (text === 'medium' || text === 'major') return 'medium';
  if (text === 'low' || text === 'minor') return 'low';
  return 'note';
}

export function parseReviewGuide(raw: string): ReviewGuide | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const value = parsed as Record<string, unknown>;

  const rawComments = Array.isArray(value['comments']) ? value['comments'] : [];
  const comments: ReviewComment[] = [];
  for (const entry of rawComments) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const file = typeof row['file'] === 'string' ? row['file'].replace(/^[ab]\//, '') : '';
    if (!file) continue;
    const lineValue = row['line'];
    const line =
      typeof lineValue === 'number' && Number.isFinite(lineValue) && lineValue > 0
        ? Math.floor(lineValue)
        : null;
    comments.push({
      id:
        typeof row['id'] === 'string' && row['id'] ? row['id'] : `C${String(comments.length + 1)}`,
      file,
      line,
      severity: severityOf(row['severity']),
      title: typeof row['title'] === 'string' ? row['title'] : '',
      body: typeof row['body'] === 'string' ? row['body'] : '',
    });
  }

  const rawOrder = Array.isArray(value['order']) ? value['order'] : [];
  const order = rawOrder
    .map(entry => {
      if (!entry || typeof entry !== 'object') return null;
      const row = entry as Record<string, unknown>;
      const file = typeof row['file'] === 'string' ? row['file'].replace(/^[ab]\//, '') : '';
      if (!file) return null;
      return { file, why: typeof row['why'] === 'string' ? row['why'] : '' };
    })
    .filter((entry): entry is { file: string; why: string } => entry !== null);

  const rawCoverage = Array.isArray(value['coverage']) ? value['coverage'] : [];
  const coverage: CoverageRow[] = [];
  for (const entry of rawCoverage) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const file = typeof row['file'] === 'string' ? row['file'].replace(/^[ab]\//, '') : '';
    if (!file) continue;
    coverage.push({
      file,
      status: row['status'] === 'skipped' ? 'skipped' : 'reviewed',
      note: typeof row['note'] === 'string' ? row['note'] : '',
    });
  }

  return {
    summary: typeof value['summary'] === 'string' ? value['summary'] : '',
    verdict: typeof value['verdict'] === 'string' ? value['verdict'] : '',
    order,
    coverage,
    comments,
  };
}

export function coverageReport(
  files: DiffFile[],
  guide: ReviewGuide | null,
): CoverageReport | null {
  if (!guide) return null;
  const rows = new Map(guide.coverage.map(row => [row.file, row] as const));
  const commented = new Set(guide.comments.map(comment => comment.file));
  const reviewed: string[] = [];
  const skipped: CoverageRow[] = [];
  const missing: string[] = [];

  for (const file of files) {
    const row = rows.get(file.path);
    if (!row) {
      if (commented.has(file.path)) reviewed.push(file.path);
      else missing.push(file.path);
      continue;
    }
    if (row.status === 'skipped') skipped.push(row);
    else reviewed.push(file.path);
  }

  return {
    reviewed,
    skipped,
    missing,
    claimed: guide.coverage.length,
    total: files.length,
  };
}

export interface AnchoredComment extends ReviewComment {
  anchorIndex: number | null;
}

export function anchorComments(
  files: DiffFile[],
  comments: ReviewComment[],
): Map<string, AnchoredComment[]> {
  const byFile = new Map<string, AnchoredComment[]>();

  for (const comment of comments) {
    const file = files.find(candidate => candidate.path === comment.file);
    const anchored: AnchoredComment = { ...comment, anchorIndex: null };

    if (file) {
      if (comment.line === null) {
        anchored.anchorIndex = file.lines.findIndex(line => line.kind !== 'meta');
      } else {
        const exact = file.lines.findIndex(line => line.newLine === comment.line);
        if (exact >= 0) {
          anchored.anchorIndex = exact;
        } else {
          let best = -1;
          let distance = Number.POSITIVE_INFINITY;
          file.lines.forEach((line, index) => {
            if (line.newLine === null) return;
            const gap = Math.abs(line.newLine - (comment.line as number));
            if (gap < distance) {
              distance = gap;
              best = index;
            }
          });
          anchored.anchorIndex = best >= 0 ? best : null;
        }
      }
    }

    const list = byFile.get(comment.file) ?? [];
    list.push(anchored);
    byFile.set(comment.file, list);
  }

  for (const list of byFile.values()) {
    list.sort((a, b) => (a.anchorIndex ?? 0) - (b.anchorIndex ?? 0));
  }
  return byFile;
}

export function orderedFiles(files: DiffFile[], guide: ReviewGuide | null): DiffFile[] {
  if (!guide || guide.order.length === 0) return files;
  const rank = new Map(guide.order.map((entry, index) => [entry.file, index] as const));
  return [...files].sort((a, b) => {
    const left = rank.get(a.path) ?? Number.MAX_SAFE_INTEGER;
    const right = rank.get(b.path) ?? Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    return files.indexOf(a) - files.indexOf(b);
  });
}
