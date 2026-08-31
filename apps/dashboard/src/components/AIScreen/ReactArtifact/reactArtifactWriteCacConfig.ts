/**
 * CAC key: "react_artifact_write_config"
 *
 * Gates whether artifact apps may CHANGE data (useXyneMutate). Reads are gated
 * separately by `react_artifact_config`.
 *
 * This is the only workspace-wide kill switch for app writes. Note that
 * `push-fallback`'s own `allowMutations` flag is NOT one: it is only consulted
 * while Zero fallback mode is active (zeroController.ts), so it does not gate
 * mutations in normal operation.
 *
 * Writes execute as the viewer under their own ACLs, immediately, with no
 * confirmation and no undo — so default off.
 *
 *   key:   react_artifact_write_config
 *   value: { "enabled": true }
 */

export const REACT_ARTIFACT_WRITE_CAC_KEY = 'react_artifact_write_config';

export interface ReactArtifactWriteCacConfig {
  enabled: boolean;
}

export const DEFAULT_REACT_ARTIFACT_WRITE_CAC_CONFIG: ReactArtifactWriteCacConfig = {
  // TEMPORARY (local testing): the key does not exist in Superposition yet, so
  // useCacConfig falls back to this. Set back to `false` before merging.
  enabled: true,
};
