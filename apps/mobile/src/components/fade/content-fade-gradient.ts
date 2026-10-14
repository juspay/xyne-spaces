import { withAlpha } from '@/src/utils/color';

const CONTENT_FADE_ALPHAS = [0, 0x60 / 285, 0xb0 / 285, 0xe8 / 285] as const;

export const CONTENT_FADE_EDGE_DP = 48;

type FadeColors = [string, string, string, string, string];
type FadeLocations = [number, number, number, number, number];

export function contentFadeGradient(
  color: string,
  direction: 'top' | 'bottom',
  zoneHeight: number,
  edgeDp: number = CONTENT_FADE_EDGE_DP,
): { colors: FadeColors; locations: FadeLocations } {
  const edge = Math.max(1, Math.min(edgeDp, zoneHeight));
  const edgeEnd = edge / zoneHeight;
  const third = edgeEnd / 3;

  const [a0, a1, a2, a3] = CONTENT_FADE_ALPHAS.map(alpha => withAlpha(color, alpha)) as [
    string,
    string,
    string,
    string,
  ];

  if (direction === 'bottom') {
    return {
      colors: [a0, a1, a2, a3, a3],
      locations: [0, third, third * 2, edgeEnd, 1],
    };
  }

  return {
    colors: [a3, a3, a2, a1, a0],
    locations: [0, 1 - edgeEnd, 1 - third * 2, 1 - third, 1],
  };
}
