/**
 * StageCanvas
 *
 * The data-agnostic half of the stage: measures itself, asks `computeStageLayout` where every
 * tile goes and hosts each one in an `AnimatedTileFrame`. What goes *inside* a tile is supplied
 * by `renderTile`, so the same canvas serves the LiveKit stage and offline previews.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import {
  computeStageLayout,
  type PipCorner,
  type StageInsets,
  type StageMode,
  type StageTile,
  type TileLayout,
} from '../callStage.utils';
import { AnimatedTileFrame } from './AnimatedTileFrame';

interface StageCanvasProps {
  mode: StageMode;
  tiles: readonly StageTile[];
  insets: StageInsets;
  heroKey: string | null;
  /** 1:1 only: the tile shown as the draggable self-view, if any. */
  pipKey: string | null;
  pipCorner: PipCorner;
  onPipCornerChange: (corner: PipCorner) => void;
  /** Tapping the self-view (swap views). */
  onPipPress: () => void;
  onStageTap: () => void;
  backdrop: React.ReactNode;
  renderTile: (tile: StageTile, layout: TileLayout) => React.ReactNode;
}

export function StageCanvas({
  mode,
  tiles,
  insets,
  heroKey,
  pipKey,
  pipCorner,
  onPipCornerChange,
  onPipPress,
  onStageTap,
  backdrop,
  renderTile,
}: StageCanvasProps): React.ReactElement {
  const [stage, setStage] = useState({ width: 0, height: 0 });

  const handleLayout = useCallback((event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    setStage(current =>
      current.width === width && current.height === height ? current : { width, height },
    );
  }, []);

  const layout = useMemo(
    () => computeStageLayout({ mode, stage, insets, tiles, heroKey, pipKey, pipCorner }),
    [mode, stage, insets, tiles, heroKey, pipKey, pipCorner],
  );

  return (
    <View testID='call-stage' style={StyleSheet.absoluteFill} onLayout={handleLayout}>
      {backdrop}
      {/* Taps on the stage toggle the chrome in immersive layouts. Tiles are plain views, so the
          touch bubbles up here; the PiP and in-tile buttons are deeper pressables and win their
          own taps. */}
      <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onStageTap}>
        {tiles.map(tile => {
          const tileLayout = layout[tile.key];
          if (!tileLayout) return null;
          const isPip = tileLayout.variant === 'pip';
          const content = renderTile(tile, tileLayout);
          return (
            <AnimatedTileFrame
              key={tile.key}
              frame={tileLayout.frame}
              drag={isPip ? { stage, insets, onCornerChange: onPipCornerChange } : undefined}
            >
              {/* Constant wrapper: only the PiP is pressable (swap views); for every other tile the
                  disabled Pressable lets the touch fall through to the stage tap. Keeping the
                  same tree shape means a tile changing role is never remounted. */}
              <Pressable
                disabled={!isPip}
                accessible={isPip}
                {...(isPip
                  ? { accessibilityRole: 'button' as const, accessibilityLabel: 'Swap views' }
                  : {})}
                onPress={onPipPress}
                style={StyleSheet.absoluteFill}
              >
                {content}
              </Pressable>
            </AnimatedTileFrame>
          );
        })}
      </Pressable>
    </View>
  );
}
