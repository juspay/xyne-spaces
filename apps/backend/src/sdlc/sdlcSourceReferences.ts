class SdlcSourceReferenceError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = 'SdlcSourceReferenceError';
  }
}

export interface SdlcSourceReference {
  path: string;
  commitSha: string;
  symbol?: string;
  startLine?: number;
  endLine?: number;
}

export type RequestedSdlcSourceReference = Omit<SdlcSourceReference, 'commitSha'>;

function markdownLabel(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .split('[')
    .join('\\[')
    .split(']')
    .join('\\]')
    .trim();
}

export function githubSdlcSourceUrl(input: {
  repositoryUrl: string;
  reference: SdlcSourceReference;
}): string {
  let repository: URL;
  try {
    repository = new URL(input.repositoryUrl.replace(/\.git$/i, ''));
  } catch {
    throw new SdlcSourceReferenceError('SDLC repository URL is invalid', 400);
  }
  if (
    repository.protocol !== 'https:' ||
    repository.hostname !== 'github.com' ||
    repository.port ||
    repository.username ||
    repository.password
  ) {
    throw new SdlcSourceReferenceError(
      'SDLC source links currently support GitHub repositories',
      400
    );
  }
  const repositoryParts = repository.pathname.split('/').filter(Boolean);
  if (repositoryParts.length !== 2) {
    throw new SdlcSourceReferenceError('SDLC GitHub repository URL is invalid', 400);
  }
  const path = input.reference.path;
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
    throw new SdlcSourceReferenceError(`Invalid SDLC source path: ${path}`, 400);
  }
  if (!/^[0-9a-f]{40}$/i.test(input.reference.commitSha)) {
    throw new SdlcSourceReferenceError('Invalid SDLC source commit', 400);
  }
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const line = input.reference.startLine;
  const end = input.reference.endLine;
  if (line !== undefined && (!Number.isInteger(line) || line < 1)) {
    throw new SdlcSourceReferenceError('Invalid SDLC source start line', 400);
  }
  if (end !== undefined && (!line || !Number.isInteger(end) || end < line)) {
    throw new SdlcSourceReferenceError('Invalid SDLC source end line', 400);
  }
  const fragment = line ? `#L${line}${end && end !== line ? `-L${end}` : ''}` : '';
  return `${repository.origin}${repository.pathname}/blob/${input.reference.commitSha}/${encodedPath}${fragment}`;
}

export function renderSdlcSourceReference(input: {
  repositoryUrl: string;
  reference: SdlcSourceReference;
}): string {
  const label = [input.reference.path, input.reference.symbol]
    .filter((value): value is string => Boolean(value))
    .map(markdownLabel)
    .join(' — ');
  return `[${label}](${githubSdlcSourceUrl(input)})`;
}

export function resolveSdlcSourceReferenceTokens(input: {
  markdown: string;
  repositoryUrl: string;
  commitSha: string;
  references: RequestedSdlcSourceReference[];
}): string {
  if (/https:\/\/github\.com\/[^\s)]+\/blob\//i.test(input.markdown)) {
    throw new SdlcSourceReferenceError(
      'Do not submit repository source URLs; use [[source:N]] tokens and sourceReferences',
      400
    );
  }
  const resolved = input.markdown.replace(/\[\[source:(\d+)\]\]/g, (token, rawIndex: string) => {
    const reference = input.references[Number(rawIndex)];
    if (!reference) {
      const validRange =
        input.references.length > 0 ? `0-${input.references.length - 1}` : 'none';
      throw new SdlcSourceReferenceError(
        `Unknown SDLC source reference token: ${token}. Valid zero-based indices: ${validRange}`,
        400
      );
    }
    return renderSdlcSourceReference({
      repositoryUrl: input.repositoryUrl,
      reference: { ...reference, commitSha: input.commitSha },
    });
  });
  if (resolved.includes('[[source:')) {
    throw new SdlcSourceReferenceError(
      'Invalid SDLC source reference token; use [[source:N]] with a zero-based integer index',
      400
    );
  }
  return resolved;
}
