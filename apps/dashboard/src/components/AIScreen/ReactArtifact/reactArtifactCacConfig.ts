/**
 * CAC key: "react_artifact_config"
 *
 * Gates rendering of agent-generated React apps (the `create-react-artifact`
 * tool) inside the Ask AI thread. Default off — this is an experiment, and the
 * preview iframe loads its bundler from an external origin.
 *
 * Toggle from Superposition CAC:
 *   key:   react_artifact_config
 *   value: { "enabled": true }
 */

export const REACT_ARTIFACT_CAC_KEY = 'react_artifact_config';

export interface ReactArtifactCacConfig {
  enabled: boolean;
}

export const DEFAULT_REACT_ARTIFACT_CAC_CONFIG: ReactArtifactCacConfig = {
  // TEMPORARY (local testing): flipped on because the `react_artifact_config`
  // key does not exist in Superposition yet, so useCacConfig always falls back
  // to this default. Set back to `false` before merging — rollout is meant to
  // be gated per-user from CAC, not on by default.
  enabled: true,
};
