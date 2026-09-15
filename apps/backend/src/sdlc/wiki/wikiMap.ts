export interface WikiMapEntry {
  path: string;
  title: string;
  purpose: string;
  concepts: string[];
  sourceAreas: string[];
  sourcePaths: string[];
  sourceReferences: Array<{
    path: string;
    commitSha: string;
    symbol?: string;
    startLine?: number;
    endLine?: number;
  }>;
  contentHash: string;
  lastCommitSha: string | null;
  archived: boolean;
  diagrams: Array<{ type: string; purpose: string }>;
}

function plain(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]/g, '')
    .trim();
}

export function deriveWikiMapEntry(input: {
  path: string;
  title: string;
  markdown: string;
  sourcePaths: string[];
  sourceReferences?: WikiMapEntry['sourceReferences'];
  contentHash?: string;
  lastCommitSha: string | null;
  archived: boolean;
}): WikiMapEntry {
  const lines = input.markdown.split('\n');
  const headings = lines
    .map(line => line.match(/^#{2,3}\s+(.+?)\s*#*\s*$/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(plain)
    .filter(Boolean);
  const purpose =
    lines
      .map(line => line.trim())
      .find(line => Boolean(line) && !line.startsWith('#') && !line.startsWith('```')) ??
    input.title;
  const diagrams: WikiMapEntry['diagrams'] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim() !== '```mermaid') continue;
    const firstDiagramLine = lines.slice(index + 1).find(line => line.trim())?.trim() ?? 'mermaid';
    const type = firstDiagramLine.split(/\s+/)[0] ?? 'mermaid';
    const precedingHeading = [...lines.slice(0, index)]
      .reverse()
      .map(line => line.match(/^#{2,6}\s+(.+?)\s*#*\s*$/)?.[1])
      .find(Boolean);
    diagrams.push({ type, purpose: precedingHeading ? plain(precedingHeading) : input.title });
  }
  return {
    path: input.path,
    title: input.title,
    purpose: plain(purpose).slice(0, 240),
    concepts: [...new Set(headings)].slice(0, 20),
    sourceAreas: [
      ...new Set(
        input.sourcePaths.map(sourcePath => {
          const parts = sourcePath.split('/');
          return parts.length > 1 ? parts.slice(0, Math.min(2, parts.length - 1)).join('/') : parts[0]!;
        })
      ),
    ].slice(0, 20),
    sourcePaths: [...new Set(input.sourcePaths)].slice(0, 500),
    sourceReferences: (input.sourceReferences ?? []).slice(0, 500),
    contentHash: input.contentHash ?? '',
    lastCommitSha: input.lastCommitSha,
    archived: input.archived,
    diagrams,
  };
}
