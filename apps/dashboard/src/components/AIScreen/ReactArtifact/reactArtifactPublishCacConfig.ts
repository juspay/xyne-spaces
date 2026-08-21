/**
 * CAC key: "react_artifact_publish_config"
 *
 * Gates saving and publishing generated apps — the Save affordance on an
 * artifact and the Apps tab in the AI Library. Separate from
 * `react_artifact_config` (which gates rendering) so the render path can ship
 * and roll out ahead of the sharing surface.
 *
 * Toggle from Superposition CAC:
 *   key:   react_artifact_publish_config
 *   value: { "enabled": true }
 */

export const REACT_ARTIFACT_PUBLISH_CAC_KEY = 'react_artifact_publish_config';

export interface ReactArtifactPublishCacConfig {
  enabled: boolean;
}

export const DEFAULT_REACT_ARTIFACT_PUBLISH_CAC_CONFIG: ReactArtifactPublishCacConfig = {
  // TEMPORARY (local testing): the key does not exist in Superposition yet, so
  // useCacConfig always falls back to this default. Set back to `false` before
  // merging — rollout is meant to be gated per-user from CAC.
  enabled: true,
};
