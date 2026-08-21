import { CANVAS_STATUS_ACTIVE, isBaselineCanvasType } from '@xyne/shared';
import { BASELINE_DEFINITIONS } from './baselineDefinitions';
import type { VcsCapability } from './vcs/types';

export const BASELINE_CAPABILITIES: readonly VcsCapability[] = ['READ_REPOSITORY'];
export const ARTIFACT_CAPABILITIES: readonly VcsCapability[] = ['READ_REPOSITORY'];

export function allBaselinesReady(
  canvases: ReadonlyArray<{ canvasType: string; canvasStatus: string }>
): boolean {
  const readyKinds = new Set<string>();
  for (const canvas of canvases) {
    if (!isBaselineCanvasType(canvas.canvasType)) continue;
    if (canvas.canvasStatus !== CANVAS_STATUS_ACTIVE) continue;
    readyKinds.add(canvas.canvasType);
  }
  return BASELINE_DEFINITIONS.every((definition) => readyKinds.has(definition.kind));
}
