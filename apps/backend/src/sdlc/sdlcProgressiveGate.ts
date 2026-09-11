import { CANVAS_STATUS_ACTIVE, isBaselineCanvasType } from '@xyne/shared';
import { BASELINE_DEFINITIONS } from './baselineDefinitions';
import type { VcsCapability } from './vcs/types';

export const BASELINE_CAPABILITIES: readonly VcsCapability[] = ['READ_REPOSITORY'];

export function allBaselinesReady(
  artifacts: ReadonlyArray<{ artifactType: string; artifactStatus: string }>
): boolean {
  const readyKinds = new Set<string>();
  for (const artifact of artifacts) {
    if (!isBaselineCanvasType(artifact.artifactType)) continue;
    if (artifact.artifactStatus !== CANVAS_STATUS_ACTIVE) continue;
    readyKinds.add(artifact.artifactType);
  }
  return BASELINE_DEFINITIONS.every((definition) => readyKinds.has(definition.kind));
}
