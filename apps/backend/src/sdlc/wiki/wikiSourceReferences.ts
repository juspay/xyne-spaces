class WikiSourceReferenceError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = 'WikiSourceReferenceError';
  }
}

export interface WikiSourceReference {
  path: string;
  commitSha: string;
  symbol?: string;
  startLine?: number;
  endLine?: number;
}

function markdownLabel(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/([\\\[\]])/g, '\\$1').trim();
}

export function githubWikiSourceUrl(input: {
  repositoryUrl: string;
  reference: WikiSourceReference;
}): string {
  let repository: URL;
  try {
    repository = new URL(input.repositoryUrl.replace(/\.git$/i, ''));
  } catch {
    throw new WikiSourceReferenceError('Wiki repository URL is invalid', 400);
  }
  if (
    repository.protocol !== 'https:' ||
    repository.hostname !== 'github.com' ||
    repository.port ||
    repository.username ||
    repository.password
  ) {
    throw new WikiSourceReferenceError('Wiki source links currently support GitHub repositories', 400);
  }
  const repositoryParts = repository.pathname.split('/').filter(Boolean);
  if (repositoryParts.length !== 2) {
    throw new WikiSourceReferenceError('Wiki GitHub repository URL is invalid', 400);
  }
  const path = input.reference.path;
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
    throw new WikiSourceReferenceError(`Invalid Wiki source path: ${path}`, 400);
  }
  if (!/^[0-9a-f]{40}$/i.test(input.reference.commitSha)) {
    throw new WikiSourceReferenceError('Invalid Wiki source commit', 400);
  }
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const line = input.reference.startLine;
  const end = input.reference.endLine;
  if (line !== undefined && (!Number.isInteger(line) || line < 1)) {
    throw new WikiSourceReferenceError('Invalid Wiki source start line', 400);
  }
  if (end !== undefined && (!line || !Number.isInteger(end) || end < line)) {
    throw new WikiSourceReferenceError('Invalid Wiki source end line', 400);
  }
  const fragment = line ? `#L${line}${end && end !== line ? `-L${end}` : ''}` : '';
  return `${repository.origin}${repository.pathname}/blob/${input.reference.commitSha}/${encodedPath}${fragment}`;
}

export function renderWikiSourceReference(input: {
  repositoryUrl: string;
  reference: WikiSourceReference;
}): string {
  const label = [input.reference.path, input.reference.symbol]
    .filter((value): value is string => Boolean(value))
    .map(markdownLabel)
    .join(' — ');
  return `[${label}](${githubWikiSourceUrl(input)})`;
}

export function resolveWikiSourceReferenceTokens(input: {
  markdown: string;
  repositoryUrl: string;
  commitSha: string;
  references: Array<Omit<WikiSourceReference, 'commitSha'>>;
}): string {
  return input.markdown.replace(/\[\[source:(\d+)\]\]/g, (token, rawIndex: string) => {
    const reference = input.references[Number(rawIndex)];
    if (!reference) {
      const validRange = input.references.length > 0
        ? `0-${input.references.length - 1}`
        : 'none (no sourceReferences were supplied)';
      throw new WikiSourceReferenceError(
        `Unknown Wiki source reference token: ${token}. Valid zero-based indices: ${validRange}`,
        400
      );
    }
    return renderWikiSourceReference({
      repositoryUrl: input.repositoryUrl,
      reference: { ...reference, commitSha: input.commitSha },
    });
  });
}
