import type { FlowComponentLike } from '@/src/utils/flowJsonMarkdown';

export type DiffLineKind = 'add' | 'remove' | 'hunk' | 'meta' | 'context';

export type DiffLineViewModel = {
  text: string;
  kind: DiffLineKind;
};

export type DiffComponentViewModel = {
  path: string;
  patch: string;
  lines: DiffLineViewModel[];
  added: number;
  removed: number;
};

const readStringProp = (props: Record<string, unknown> | undefined, key: string): string | null => {
  const value = props?.[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** Path is trimmed; patch keeps original whitespace (only validated non-empty). */
const readPatchProp = (props: Record<string, unknown> | undefined): string | null => {
  const value = props?.['patch'];
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return value;
};

export const classifyDiffLine = (line: string): DiffLineKind => {
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'remove';
  return 'context';
};

/**
 * Hunk-aware +/− counts — same algorithm as dashboard `diffStat`.
 * Ignores file headers (`---` / `+++`) and lines before the first hunk.
 */
export const countDiffStats = (patch: string): { added: number; removed: number } => {
  let added = 0;
  let removed = 0;
  let inHunk = false;

  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith('+++ ') || line.startsWith('--- ')) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) removed += 1;
  }

  return { added, removed };
};

export const parseDiffPatchLines = (patch: string): DiffLineViewModel[] =>
  patch.split('\n').map(text => ({
    text,
    kind: classifyDiffLine(text),
  }));

export const createDiffComponentViewModel = (
  component: FlowComponentLike,
): DiffComponentViewModel | null => {
  if (component.type !== 'diff') return null;

  const props =
    component.props && typeof component.props === 'object'
      ? (component.props as Record<string, unknown>)
      : undefined;

  const path = readStringProp(props, 'path');
  const patch = readPatchProp(props);
  if (!path || !patch) return null;

  const { added, removed } = countDiffStats(patch);

  return {
    path,
    patch,
    lines: parseDiffPatchLines(patch),
    added,
    removed,
  };
};

/** Markdown / preview label. Uses U+2212 minus. */
export const formatDiffStatsLabel = (added: number, removed: number): string =>
  `+${added} −${removed}`;

export const diffComponentToMarkdown = (component: FlowComponentLike): string => {
  const viewModel = createDiffComponentViewModel(component);
  if (!viewModel) return '';

  const stats = formatDiffStatsLabel(viewModel.added, viewModel.removed);
  return [`**${viewModel.path}** (${stats})`, '```diff', viewModel.patch, '```'].join('\n');
};

export const diffNotificationPreview = (path?: string | null): string => {
  const trimmed = path?.trim();
  return trimmed ? `📝 Shared a diff: ${trimmed}` : '📝 Shared a diff';
};

export const isDiffFlow = (flow: {
  data?: { kind?: unknown } | null;
  components?: ReadonlyArray<{ type?: unknown }> | null;
}): boolean =>
  flow.data?.kind === 'diff' ||
  (flow.components ?? []).some(component => component.type === 'diff');
