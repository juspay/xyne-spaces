import type { SdlcBaselineKind } from '@xyne/shared';
import { BASELINE_DEFINITIONS } from './baselineDefinitions';
import type { VcsCapability } from './vcs/types';

export const BASELINE_CAPABILITIES: readonly VcsCapability[] = ['READ_REPOSITORY'];
export const ARTIFACT_CAPABILITIES: readonly VcsCapability[] = ['READ_REPOSITORY'];
export const START_WORK_CAPABILITIES: readonly VcsCapability[] = [
  'READ_REPOSITORY',
  'PUSH_BRANCH',
  'CREATE_PULL_REQUEST',
];

export function allBaselinesApproved(
  canvases: ReadonlyArray<{ metadata: unknown }>,
): boolean {
  const approvedKinds = new Set<SdlcBaselineKind>();
  for (const canvas of canvases) {
    const metadata = canvas.metadata as Record<string, unknown> | null;
    if (
      metadata?.artifactKind === 'BASELINE' &&
      typeof metadata.baselineKind === 'string' &&
      typeof metadata.approvedAt === 'string'
    ) {
      approvedKinds.add(metadata.baselineKind as SdlcBaselineKind);
    }
  }
  return BASELINE_DEFINITIONS.every(definition => approvedKinds.has(definition.kind));
}
