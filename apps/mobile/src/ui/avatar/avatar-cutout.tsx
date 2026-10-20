import MaskedView from '@react-native-masked-view/masked-view';
import { type ReactElement, type ReactNode } from 'react';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';

import type { AvatarRect } from './avatar.geometry';

type AvatarCutoutProps = {
  width: number;
  height: number;
  /** Rounded rects to cut away, in this box's coordinates. May overlap. */
  holes: readonly AvatarRect[];
  children: ReactNode;
};

/**
 * Cuts holes out of its children with a real alpha mask.
 *
 * A luminance mask rather than an even-odd path, so holes that overlap — the
 * front face and the count bubble over the back face — still read as one
 * cut-out instead of cancelling each other out.
 *
 * With nothing to cut it draws its children as they are: a single avatar with
 * no badge, which is most of them, pays nothing for this.
 */
export function AvatarCutout({ width, height, holes, children }: AvatarCutoutProps): ReactElement {
  if (holes.length === 0) return <>{children}</>;

  return (
    <MaskedView
      // The native mask is drawn once per layout; a new set of holes is a new mask.
      key={holes.map(hole => `${hole.x},${hole.y},${hole.width},${hole.height}`).join('|')}
      style={{ width, height }}
      maskElement={
        <Svg width={width} height={height}>
          <Defs>
            <Mask
              id='avatar-cutout'
              maskUnits='userSpaceOnUse'
              x={0}
              y={0}
              width={width}
              height={height}
            >
              <Rect width={width} height={height} fill='#fff' />
              {holes.map((hole, index) => (
                <Rect
                  key={index}
                  x={hole.x}
                  y={hole.y}
                  width={hole.width}
                  height={hole.height}
                  rx={hole.radius}
                  ry={hole.radius}
                  fill='#000'
                />
              ))}
            </Mask>
          </Defs>
          <Rect width={width} height={height} fill='#000' mask='url(#avatar-cutout)' />
        </Svg>
      }
    >
      {children}
    </MaskedView>
  );
}
