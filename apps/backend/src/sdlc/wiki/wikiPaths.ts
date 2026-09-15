import path from 'path';

export const WIKI_FOLDER_PREFIX = 'Wiki';

export function normalizeWikiRelativePath(value: string): string {
  const rawPath = value.trim();
  if (!rawPath || rawPath.includes('\\') || rawPath.startsWith('/')) {
    throw new Error('Wiki path must be a non-empty relative POSIX path');
  }
  const normalized = path.posix.normalize(rawPath);
  if (
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    !normalized.toLowerCase().endsWith('.md')
  ) {
    throw new Error('Wiki path must be a normalized relative Markdown path');
  }
  return normalized;
}

export function normalizeWikiSourcePath(sourceRepository: string, sourcePath: string): string {
  const repository = sourceRepository.trim().replace(/^\/+|\/+$/g, '');
  const rawPath = sourcePath.trim();
  if (!repository || !rawPath || rawPath.includes('\\')) {
    throw new Error('Wiki source repository and path must be non-empty POSIX paths');
  }

  const normalized = path.posix.normalize(rawPath).replace(/^\/+/, '');
  const prefix = `${repository}/`;
  if (!normalized.startsWith(prefix)) {
    throw new Error(`Wiki path must be inside ${repository}`);
  }

  return normalizeWikiRelativePath(normalized.slice(prefix.length));
}

// Wiki uses exactly two flat canvas folders: 'Wiki' (live pages) and
// 'Wiki Archive' (archived pages). Folder placement IS the archive state.
// Page hierarchy lives only in wikiRelativePath; no nested folder rows exist.
export function wikiFolderName(): string {
  return WIKI_FOLDER_PREFIX;
}

const WIKI_ARCHIVE_FOLDER_PREFIX = 'Wiki Archive';

export function wikiArchiveFolderName(): string {
  return WIKI_ARCHIVE_FOLDER_PREFIX;
}

export function isWikiArchiveFolder(name: string | null | undefined): boolean {
  return name === WIKI_ARCHIVE_FOLDER_PREFIX;
}
