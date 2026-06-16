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

export function buildMainReleaseBoardName(repoUrl: string, projectName: string): string {
  const repositoryName = repositoryNameFromUrl(repoUrl);
  const normalizedProjectName = normalizeReleaseBoardNamePart(projectName);

  if (!repositoryName || !normalizedProjectName) return '';
  return `${repositoryName}_${normalizedProjectName}_release`;
}

export function buildApplicationReleaseBoardName(
  applicationName: string,
  projectName: string,
): string {
  const normalizedApplicationName = normalizeReleaseBoardNamePart(applicationName);
  const normalizedProjectName = normalizeReleaseBoardNamePart(projectName);

  if (!normalizedApplicationName || !normalizedProjectName) return '';
  return `${normalizedApplicationName}_${normalizedProjectName}_application_release`;
}
