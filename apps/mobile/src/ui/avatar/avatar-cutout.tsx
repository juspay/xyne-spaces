import { type ReactElement, type ReactNode } from 'react';

import { CutoutView } from '@/modules/xyne-cutout';

import type { AvatarRect } from './avatar.geometry';

type AvatarCutoutProps = {
  width: number;
  height: number;
  /** Rounded rects to cut away, in this box's coordinates. May overlap. */
  holes: readonly AvatarRect[];
  children: ReactNode;
};

/**
 * Cuts holes out of its children with a real alpha cut-out, so whatever is
 * behind the avatar shows through.
 *
 * Holes that overlap — the front face and the count bubble over the back face
 * — still read as one cut-out instead of cancelling each other out.
 *
 * Always the same native view, holes or not: a list row recycled from a
 * starred conversation onto a plain one keeps its avatar and only drops the
 * hole, instead of tearing the avatar down and mounting a new one.
 */
export function AvatarCutout({ width, height, holes, children }: AvatarCutoutProps): ReactElement {
  return (
    <CutoutView holes={holes} style={{ width, height }}>
      {children}
    </CutoutView>
  );
}
