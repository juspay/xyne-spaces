export function debugArtifactFailureState(input: {
  running: boolean;
  hasBundle: boolean;
  hasLiveEvents: boolean;
}): { showError: boolean; keepLoading: boolean } {
  return {
    showError: !input.running,
    keepLoading: input.running && !input.hasBundle && !input.hasLiveEvents,
  };
}
