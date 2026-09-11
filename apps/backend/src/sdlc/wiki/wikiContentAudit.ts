import type { WikiMapEntry } from './wikiMap';

export interface WikiAuditFinding {
  code:
    | 'SCRATCH_PAGE'
    | 'ACTIVE_ARCHIVE_PATH'
    | 'EMPTY_SOURCES'
    | 'STALE_SOURCE'
    | 'DUPLICATE_TOPIC'
    | 'DUPLICATE_CONTENT'
    | 'MISSING_INDEX_LINK'
    | 'UNSUPPORTED_SOURCE_CITATION'
    | 'BROKEN_MERMAID_FENCE'
    | 'INVALID_MERMAID'
    | 'UNSAFE_MERMAID'
    | 'SOURCE_OVERLAP_NOT_UPDATED'
    | 'SHALLOW_FILE_INVENTORY'
    | 'MISSING_SOURCE_POINTERS'
    | 'OVERSIZED_PAGE';
  path: string;
  detail: string;
}

export function auditWikiContent(input: {
  map: WikiMapEntry[];
  markdownByPath: ReadonlyMap<string, string>;
  staleSourcesByPath?: ReadonlyMap<string, string[]>;
  changedSourcePaths?: readonly string[];
  runTargetSha?: string;
}): WikiAuditFinding[] {
  const findings: WikiAuditFinding[] = [];
  const conceptOwners = new Map<string, string>();
  const contentOwners = new Map<string, string>();
  const activePages = input.map.filter(page => !page.archived);
  const indexPages = activePages.filter(page => /^(?:index|overview|home|readme)\.md$/i.test(page.path));
  const changedSources = new Set(input.changedSourcePaths ?? []);
  const linkedPaths = new Set<string>();
  for (const indexPage of indexPages) {
    const markdown = input.markdownByPath.get(indexPage.path) ?? '';
    for (const match of markdown.matchAll(/\[[^\]]+\]\((?!https?:|#)([^)]+\.md)(?:#[^)]*)?\)/gi)) {
      const target = match[1]?.replace(/^\.\//, '');
      if (target) linkedPaths.add(target);
    }
  }
  for (const page of input.map) {
    const markdown = input.markdownByPath.get(page.path) ?? '';
    if (/^(?:scratch|tmp|draft)\//i.test(page.path)) {
      findings.push({ code: 'SCRATCH_PAGE', path: page.path, detail: 'Scratch path remains active' });
    }
    if (/^archive\//i.test(page.path) && !page.archived) {
      findings.push({ code: 'ACTIVE_ARCHIVE_PATH', path: page.path, detail: 'Archive path is active' });
    }
    if (!page.archived && page.sourceAreas.length === 0) {
      findings.push({ code: 'EMPTY_SOURCES', path: page.path, detail: 'Active page has no source areas' });
    }
    for (const sourcePath of input.staleSourcesByPath?.get(page.path) ?? []) {
      findings.push({ code: 'STALE_SOURCE', path: page.path, detail: `Source is absent at target head: ${sourcePath}` });
    }
    const mermaidOpenings = [...markdown.matchAll(/^```mermaid\s*$/gm)];
    const fences = markdown.match(/^```(?:\w+)?\s*$/gm)?.length ?? 0;
    if (fences % 2 !== 0) {
      findings.push({ code: 'BROKEN_MERMAID_FENCE', path: page.path, detail: 'Mermaid fence is not closed' });
    }
    for (const opening of mermaidOpenings) {
      const bodyStart = (opening.index ?? 0) + opening[0].length;
      const closingIndex = markdown.indexOf('\n```', bodyStart);
      if (closingIndex < 0) continue;
      const diagram = markdown.slice(bodyStart, closingIndex).trim();
      const firstLine = diagram.split('\n').find(Boolean)?.trim() ?? '';
      if (!/^(?:flowchart|graph|sequenceDiagram|stateDiagram(?:-v2)?|erDiagram|classDiagram)\b/.test(firstLine)) {
        findings.push({ code: 'INVALID_MERMAID', path: page.path, detail: `Unsupported or missing diagram type: ${firstLine || '(empty)'}` });
      }
      if (/\b(?:click|href)\b|javascript:|<script|\bsecurityLevel\b/i.test(diagram)) {
        findings.push({ code: 'UNSAFE_MERMAID', path: page.path, detail: 'Diagram contains an external-link or script directive' });
      }
    }
    const storedReferenceKeys = new Set(page.sourceReferences.map(reference => `${reference.commitSha}/${reference.path}`));
    for (const match of markdown.matchAll(/https:\/\/github\.com\/[^/\s)]+\/[^/\s)]+\/blob\/([0-9a-f]{40})\/([^\s)#]+)/gi)) {
      const key = `${match[1]}/${decodeURIComponent(match[2] ?? '')}`;
      if (!storedReferenceKeys.has(key)) {
        findings.push({ code: 'UNSUPPORTED_SOURCE_CITATION', path: page.path, detail: 'GitHub blob link has no trusted structured source reference' });
      }
    }
    if (markdown.length > 50_000) {
      findings.push({ code: 'OVERSIZED_PAGE', path: page.path, detail: 'Page may contain multiple topics' });
    }
    const nonHeadingLines = markdown
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && !line.startsWith('```'));
    const inventoryLines = nonHeadingLines.filter(line =>
      /(?:^|\s)`?[^\s`]+\/(?:[^\s`]+\/)*[^\s`]+\.[A-Za-z0-9]+`?(?:\s|$)/.test(line)
    );
    if (
      !page.archived &&
      markdown.length < 2_000 &&
      inventoryLines.length >= 4 &&
      inventoryLines.length >= nonHeadingLines.length * 0.6
    ) {
      findings.push({
        code: 'SHALLOW_FILE_INVENTORY',
        path: page.path,
        detail: 'Page is mostly a source-file inventory rather than conceptual documentation',
      });
    }
    if (
      !page.archived &&
      markdown.length >= 2_000 &&
      page.sourceReferences.length === 0 &&
      !/`[^`\n]+\/(?:[^`\n]+\/)*[^`\n]+\.[A-Za-z0-9]+`/.test(markdown)
    ) {
      findings.push({
        code: 'MISSING_SOURCE_POINTERS',
        path: page.path,
        detail: 'Substantial page has no adjacent implementation pointer or trusted citation',
      });
    }
    if (!page.archived && page.contentHash) {
      const owner = contentOwners.get(page.contentHash);
      if (owner && owner !== page.path) {
        findings.push({ code: 'DUPLICATE_CONTENT', path: page.path, detail: `Content duplicates ${owner}` });
      } else contentOwners.set(page.contentHash, page.path);
    }
    if (
      !page.archived &&
      indexPages.length > 0 &&
      !indexPages.some(index => index.path === page.path) &&
      !linkedPaths.has(page.path)
    ) {
      findings.push({ code: 'MISSING_INDEX_LINK', path: page.path, detail: 'Page is not linked from the root Wiki navigation page' });
    }
    if (
      input.runTargetSha &&
      page.lastCommitSha !== input.runTargetSha &&
      page.sourcePaths.some(sourcePath => changedSources.has(sourcePath))
    ) {
      findings.push({
        code: 'SOURCE_OVERLAP_NOT_UPDATED',
        path: page.path,
        detail: 'Page owns a source changed by this run but was not updated at the target checkpoint',
      });
    }
    for (const concept of page.concepts) {
      const key = concept.toLocaleLowerCase();
      const owner = conceptOwners.get(key);
      if (owner && owner !== page.path) {
        findings.push({ code: 'DUPLICATE_TOPIC', path: page.path, detail: `${concept} also appears in ${owner}` });
      } else conceptOwners.set(key, page.path);
    }
  }
  return findings;
}
