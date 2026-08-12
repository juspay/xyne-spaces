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

export function wikiFolderName(relativePath: string): string {
  const directory = path.posix.dirname(relativePath);
  return directory === '.' ? WIKI_FOLDER_PREFIX : `${WIKI_FOLDER_PREFIX}/${directory}`;
}
