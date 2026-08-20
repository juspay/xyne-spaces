const autoOpenedRepositoryIds = new Set<string>();

/**
 * Claims the one automatic assistant open for a repository during this app
 * runtime. Keeping the claim outside the screen component makes closing the
 * panel survive layout-driven remounts. A browser reload resets the module and
 * opens the assistant again.
 */
export function claimSdlcAssistantAutoOpen(repositoryId: string): boolean {
  if (autoOpenedRepositoryIds.has(repositoryId)) return false;
  autoOpenedRepositoryIds.add(repositoryId);
  return true;
}

export function shouldOpenSdlcAssistantForRepository(input: {
  assistantOpen: boolean;
  pinnedRepositoryId: string | null;
  repositoryId: string;
  autoOpenClaimed: boolean;
  scopeChanged: boolean;
}): boolean {
  if (input.assistantOpen) {
    return input.scopeChanged || input.pinnedRepositoryId !== input.repositoryId;
  }
  return input.autoOpenClaimed;
}
