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
// One main release board represents one repository per hub; the hub's channel name
// keeps two hubs releasing the same repository from colliding on board names.
export function buildMainReleaseBoardName(repoUrl: string, channelName?: string): string {
  const repositoryName = repositoryNameFromUrl(repoUrl);
  const channelPart = channelName ? normalizeReleaseBoardNamePart(channelName) : '';

  if (!repositoryName) return '';
  return channelPart ? `${repositoryName}_${channelPart}_release` : `${repositoryName}_release`;
}

// Per-application release board, keyed on the repository + application so it stays
// unique within a repository's release group.
export function buildApplicationReleaseBoardName(
  repoUrl: string,
  applicationName: string,
  channelName?: string,
): string {
  const repositoryName = repositoryNameFromUrl(repoUrl);
  const normalizedApplicationName = normalizeReleaseBoardNamePart(applicationName);
  const channelPart = channelName ? normalizeReleaseBoardNamePart(channelName) : '';

  if (!repositoryName || !normalizedApplicationName) return '';
  return channelPart
    ? `${repositoryName}_${channelPart}_${normalizedApplicationName}_release`
    : `${repositoryName}_${normalizedApplicationName}_release`;
}
