export function normalizeReleaseBoardNamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function repositoryNameFromUrl(url: string): string {
  let lastPathPart = '';

  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    lastPathPart = pathParts[pathParts.length - 1] ?? '';
  } catch {
    const pathParts = url.split('/').filter(Boolean);
    lastPathPart = pathParts[pathParts.length - 1] ?? '';
  }

  return normalizeReleaseBoardNamePart(lastPathPart.replace(/\.git$/i, ''));
}

// The board lives inside a project, so the project context is already implied.
// One main release board represents one repository, so the name is keyed on the
// repository alone.
export function buildMainReleaseBoardName(repoUrl: string): string {
  const repositoryName = repositoryNameFromUrl(repoUrl);

  if (!repositoryName) return '';
  return `${repositoryName}_release`;
}

// Per-application release board, keyed on the repository + application so it stays
// unique within a repository's release group.
export function buildApplicationReleaseBoardName(repoUrl: string, applicationName: string): string {
  const repositoryName = repositoryNameFromUrl(repoUrl);
  const normalizedApplicationName = normalizeReleaseBoardNamePart(applicationName);

  if (!repositoryName || !normalizedApplicationName) return '';
  return `${repositoryName}_${normalizedApplicationName}_release`;
}
