import path from 'path';

export const WIKI_FOLDER_PREFIX = 'Wiki';

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

  const relativePath = normalized.slice(prefix.length);
  if (
    !relativePath ||
    relativePath === '.' ||
    relativePath.startsWith('../') ||
    relativePath.includes('/../') ||
    !relativePath.toLowerCase().endsWith('.md')
  ) {
    throw new Error('Wiki source path must resolve to a Markdown file inside the repository');
  }
  return relativePath;
}

export function wikiFolderName(relativePath: string): string {
  const directory = path.posix.dirname(relativePath);
  return directory === '.' ? WIKI_FOLDER_PREFIX : `${WIKI_FOLDER_PREFIX}/${directory}`;
}
