/**
 * CAC key: "react_artifact_agent_config"
 *
 * Gates whether artifact apps may run claw AGENTS (useXyneAgent). Reads are
 * gated by `react_artifact_config` and writes by `react_artifact_write_config`;
 * this is a third, independent switch because an agent run is a different order
 * of cost from either — minutes of wall clock and tens of thousands of tokens,
 * against milliseconds for a query.
 *
 * It is the workspace-wide kill switch: with it off the runtime hook reports
 * unavailable and the backend route refuses, so a bad app cannot spend anything.
 *
 *   key:   react_artifact_agent_config
 *   value: { "enabled": true }
 */

export const REACT_ARTIFACT_AGENT_CAC_KEY = 'react_artifact_agent_config';

export interface ReactArtifactAgentCacConfig {
  enabled: boolean;
}

export const DEFAULT_REACT_ARTIFACT_AGENT_CAC_CONFIG: ReactArtifactAgentCacConfig = {
  // TEMPORARY (local testing): the key does not exist in Superposition yet, so
  // useCacConfig falls back to this. Set back to `false` before merging.
  enabled: true,
};
