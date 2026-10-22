/**
 * Pure logic behind the in-call stage: which layout to use, where every tile goes,
 * how the call status reads. No React / React Native / LiveKit imports so it can be
 * unit-tested under node and shared with worklets ('worklet' directives are inert
 * outside Reanimated).
 */

import { isAiAgentIdentity } from './callIdentity';
import { getRingStatusLabel, type RingStatusValue } from './callRoster.utils';
import { callLayout, callRadii } from './callTheme';

// ─── Geometry ────────────────────────────────────────────────────────────────

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TileFrame extends Rect {
  radius: number;
  zIndex: number;
}

export interface StageInsets {
  /** Space taken by the safe area + header. */
  top: number;
  /** Space taken by the control bar + safe area. */
  bottom: number;
}

/** How a tile presents itself; drives avatar size, name chip and typography. */
export type TileVariant = 'hero' | 'card' | 'pip' | 'strip';

export type StageMode = 'solo' | 'oneToOne' | 'grid' | 'screenShare';

export type PipCorner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

export interface StageTile {
  key: string;
  kind: 'participant' | 'pending' | 'overflow' | 'screen';
  isLocal: boolean;
}

export interface TileLayout {
  frame: TileFrame;
  variant: TileVariant;
}

// ─── Identity helpers ────────────────────────────────────────────────────────

/** [avatar colour, dark backdrop colour] — same pairs as the dashboard. */
const AVATAR_COLOR_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['#10B981', '#0D3D2E'],
  ['#F59E0B', '#3D2F0B'],
  ['#3B82F6', '#1E3A5F'],
  ['#8B5CF6', '#2D1F4D'],
  ['#EC4899', '#4D1F35'],
  ['#06B6D4', '#0D3D44'],
  ['#F97316', '#3D2510'],
  ['#14B8A6', '#0D3D36'],
];

export function getAvatarColors(identity: string | undefined): {
  avatar: string;
  background: string;
} {
  const safe = identity || 'unknown';
  let hash = 0;
  for (let i = 0; i < safe.length; i++) {
    hash = safe.charCodeAt(i) + ((hash << 5) - hash);
  }
  const pair =
    AVATAR_COLOR_PAIRS[Math.abs(hash) % AVATAR_COLOR_PAIRS.length] ?? AVATAR_COLOR_PAIRS[0]!;
  return { avatar: pair[0], background: pair[1] };
}

/**
 * The AI agent sits in every call to transcribe, so its tile is noise until someone actually
 * invokes it (the AI button). Same rule as the dashboard's `filterAgentTiles`: hide agent
 * identities unless `showAgent`.
 */
export function filterAgentIdentities<T extends { identity: string }>(
  items: readonly T[],
  showAgent: boolean,
): T[] {
  return showAgent ? [...items] : items.filter(item => !isAiAgentIdentity(item.identity));
}

// ─── Chrome ──────────────────────────────────────────────────────────────────

/** Distance from the screen bottom to the control bar: the safe area, but never flush. */
export function getControlBarOffset(safeAreaBottom: number): number {
  return Math.max(safeAreaBottom, 12);
}

// ─── Time ────────────────────────────────────────────────────────────────────

/** `05:12`, or `1:05:12` once past an hour. */
export function formatCallDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const ss = seconds.toString().padStart(2, '0');
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${ss}`;
  return `${minutes.toString().padStart(2, '0')}:${ss}`;
}

// ─── Status line ─────────────────────────────────────────────────────────────

type CallPhase = 'initiating' | 'joining' | 'connecting' | 'connected';
export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface CallStatusInput {
  phase: CallPhase;
  /** livekit ConnectionState value ('connected', 'reconnecting', …). */
  connectionState: string;
  remoteHumanCount: number;
  /** Ring status of the invitee currently being rung (1:1 DM calls only), if any. */
  ringing: RingStatusValue | null;
}

export interface CallStatus {
  text: string;
  tone: StatusTone;
  /** When true the header renders the running timer instead of `text`. */
  showTimer: boolean;
}

export function isReconnectingState(state: string): boolean {
  return state === 'reconnecting' || state === 'signalReconnecting';
}

/**
 * The header's status line. Wording follows the dashboard's states: "Starting call…" while the call
 * is created, "Joining call…" while connecting, then — once in the room and alone — the ring label of
 * the invitee being rung. A ring label only ever comes from the backend's ringStatus, never from us.
 */
export function resolveCallStatus(input: CallStatusInput): CallStatus {
  const { phase, connectionState } = input;

  if (phase === 'initiating') return { text: 'Starting call…', tone: 'neutral', showTimer: false };
  if (phase === 'joining' || phase === 'connecting') {
    return { text: 'Joining call…', tone: 'neutral', showTimer: false };
  }

  if (isReconnectingState(connectionState)) {
    return { text: 'Reconnecting…', tone: 'warning', showTimer: false };
  }
  if (connectionState === 'disconnected') {
    return { text: 'Disconnected', tone: 'danger', showTimer: false };
  }

  if (input.remoteHumanCount > 0) return { text: '', tone: 'success', showTimer: true };
  if (input.ringing) {
    return {
      text: getRingStatusLabel(input.ringing),
      tone: input.ringing === 'busy' ? 'warning' : 'neutral',
      showTimer: false,
    };
  }
  return { text: 'Waiting for others to join', tone: 'neutral', showTimer: false };
}

// ─── Stage mode ──────────────────────────────────────────────────────────────

export function resolveStageMode(params: {
  hasScreenShare: boolean;
  /** Participant + pending tiles (excluding overflow / screen). */
  occupantCount: number;
}): StageMode {
  if (params.hasScreenShare) return 'screenShare';
  if (params.occupantCount <= 1) return 'solo';
  if (params.occupantCount === 2) return 'oneToOne';
  return 'grid';
}

/** Grid holds 6 slots; the 6th becomes the "+N" overflow tile when there are more. */
export const MAX_GRID_SLOTS = 6;

/**
 * Splits `items` so that at most `capacity` slots are used. When there are more items
 * than slots the last slot is reserved for an overflow tile.
 */
export function limitToSlots<T>(
  items: readonly T[],
  capacity: number,
): { visible: T[]; hidden: T[] } {
  if (capacity <= 0) return { visible: [], hidden: [...items] };
  if (items.length <= capacity) return { visible: [...items], hidden: [] };
  return { visible: items.slice(0, capacity - 1), hidden: items.slice(capacity - 1) };
}

/** How many person tiles fit in the screen-share filmstrip. */
export function getStripCapacity(stageWidth: number): number {
  const usable = stageWidth - callLayout.stagePadding * 2;
  const slot = callLayout.stripTileWidth + callLayout.stageGap;
  return Math.max(1, Math.floor((usable + callLayout.stageGap) / slot));
}

// ─── Grid ────────────────────────────────────────────────────────────────────

/** Tiles per row, indexed by occupied-slot count (2+1 keeps the last tile full width). */
const ROW_PATTERNS: ReadonlyArray<readonly number[]> = [
  [],
  [1],
  [1, 1],
  [2, 1],
  [2, 2],
  [2, 2, 1],
  [2, 2, 2],
];

function layoutRows(
  pattern: readonly number[],
  width: number,
  height: number,
  gap: number,
): Rect[] {
  const rows = pattern.length;
  const rowHeight = Math.max(0, (height - gap * (rows - 1)) / rows);
  const rects: Rect[] = [];
  pattern.forEach((cols, rowIndex) => {
    const colWidth = Math.max(0, (width - gap * (cols - 1)) / cols);
    for (let c = 0; c < cols; c++) {
      rects.push({
        x: c * (colWidth + gap),
        y: rowIndex * (rowHeight + gap),
        width: colWidth,
        height: rowHeight,
      });
    }
  });
  return rects;
}

function computeGridRects(count: number, area: Rect, gap: number): Rect[] {
  if (count <= 0) return [];
  const slots = Math.min(count, MAX_GRID_SLOTS);
  const pattern = ROW_PATTERNS[slots] ?? ROW_PATTERNS[MAX_GRID_SLOTS]!;
  const landscape = area.width > area.height * 1.15;

  if (landscape) {
    // Transpose so wide screens (tablets) split into columns instead of thin rows.
    return layoutRows(pattern, area.height, area.width, gap).map(r => ({
      x: area.x + r.y,
      y: area.y + r.x,
      width: r.height,
      height: r.width,
    }));
  }
  return layoutRows(pattern, area.width, area.height, gap).map(r => ({
    x: area.x + r.x,
    y: area.y + r.y,
    width: r.width,
    height: r.height,
  }));
}

// ─── Picture-in-picture ──────────────────────────────────────────────────────

/** Region the self-view may occupy: clear of the header and the control bar. */
function getPipBounds(stage: Size, insets: StageInsets): Rect {
  'worklet';
  const margin = callLayout.pipMargin;
  return {
    x: margin,
    y: insets.top + 4,
    width: Math.max(0, stage.width - margin * 2),
    height: Math.max(0, stage.height - insets.top - insets.bottom - 8),
  };
}

export function getPipRect(corner: PipCorner, stage: Size, insets: StageInsets): Rect {
  'worklet';
  const bounds = getPipBounds(stage, insets);
  const width = callLayout.pipWidth;
  const height = callLayout.pipHeight;
  const left = corner === 'topLeft' || corner === 'bottomLeft';
  const top = corner === 'topLeft' || corner === 'topRight';
  return {
    x: left ? bounds.x : bounds.x + bounds.width - width,
    y: top ? bounds.y : bounds.y + bounds.height - height,
    width,
    height,
  };
}

/**
 * Corner a dropped PiP should snap to. `vx`/`vy` (px/s) let a flick carry the tile to the
 * far corner even when the finger stopped short.
 */
export function nearestPipCorner(
  centerX: number,
  centerY: number,
  vx: number,
  vy: number,
  stage: Size,
  insets: StageInsets,
): PipCorner {
  'worklet';
  const bounds = getPipBounds(stage, insets);
  const projectedX = centerX + vx * 0.18;
  const projectedY = centerY + vy * 0.18;
  const midX = bounds.x + bounds.width / 2;
  const midY = bounds.y + bounds.height / 2;
  const isLeft = projectedX < midX;
  const isTop = projectedY < midY;
  if (isTop) return isLeft ? 'topLeft' : 'topRight';
  return isLeft ? 'bottomLeft' : 'bottomRight';
}

// ─── Hero ───────────────────────────────────────────────────────────────────

/**
 * Key of the tile shown full-bleed, or null when the layout has none. In a 1:1 the other person
 * is the hero unless the user swapped views.
 */
export function resolveHeroKey(
  mode: StageMode,
  tiles: readonly StageTile[],
  preferredKey?: string | null,
): string | null {
  if (tiles.length === 0) return null;
  if (mode === 'solo') return tiles[0]!.key;
  if (mode === 'oneToOne') {
    const hero =
      tiles.find(t => t.key === preferredKey) ?? tiles.find(t => !t.isLocal) ?? tiles[0]!;
    return hero.key;
  }
  return null;
}

// ─── Full layout ─────────────────────────────────────────────────────────────

interface StageLayoutInput {
  mode: StageMode;
  stage: Size;
  insets: StageInsets;
  /** Tiles in display order. For `oneToOne`, `heroKey` picks the full-bleed one. */
  tiles: readonly StageTile[];
  heroKey?: string | null;
  /** oneToOne: key of the self-view tile, or null to hide it. */
  pipKey?: string | null;
  pipCorner?: PipCorner;
}

/**
 * Frame + variant for every tile that should be on screen. Tiles that are not part of the
 * result must not be rendered (e.g. the self-view while the camera is off in a 1:1 call).
 */
export function computeStageLayout(input: StageLayoutInput): Record<string, TileLayout> {
  const { mode, stage, insets, tiles } = input;
  const layout: Record<string, TileLayout> = {};
  if (stage.width <= 0 || stage.height <= 0 || tiles.length === 0) return layout;

  const pad = callLayout.stagePadding;
  const gap = callLayout.stageGap;
  const safe: Rect = {
    x: pad,
    y: insets.top,
    width: Math.max(0, stage.width - pad * 2),
    height: Math.max(0, stage.height - insets.top - insets.bottom),
  };
  const fullBleed: TileFrame = {
    x: 0,
    y: 0,
    width: stage.width,
    height: stage.height,
    radius: 0,
    zIndex: 0,
  };

  if (mode === 'solo') {
    const only = tiles[0]!;
    layout[only.key] = { frame: fullBleed, variant: 'hero' };
    return layout;
  }

  if (mode === 'oneToOne') {
    const hero = tiles.find(t => t.key === resolveHeroKey(mode, tiles, input.heroKey)) ?? tiles[0]!;
    layout[hero.key] = { frame: fullBleed, variant: 'hero' };
    const pip = input.pipKey ? tiles.find(t => t.key === input.pipKey) : undefined;
    if (pip && pip.key !== hero.key) {
      const rect = getPipRect(input.pipCorner ?? 'bottomRight', stage, insets);
      layout[pip.key] = {
        frame: { ...rect, radius: callRadii.pip, zIndex: 10 },
        variant: 'pip',
      };
    }
    return layout;
  }

  if (mode === 'screenShare') {
    const share = tiles.find(t => t.kind === 'screen') ?? tiles[0]!;
    const people = tiles.filter(t => t.key !== share.key);
    const stripHeight = people.length > 0 ? callLayout.stripTileHeight + gap : 0;
    layout[share.key] = {
      frame: {
        x: safe.x,
        y: safe.y,
        width: safe.width,
        height: Math.max(0, safe.height - stripHeight),
        radius: callRadii.tile,
        zIndex: 1,
      },
      variant: 'card',
    };

    const capacity = getStripCapacity(stage.width);
    const shown = people.slice(0, capacity);
    const totalWidth =
      shown.length * callLayout.stripTileWidth + Math.max(0, shown.length - 1) * gap;
    const startX = safe.x + Math.max(0, (safe.width - totalWidth) / 2);
    const stripY = safe.y + safe.height - callLayout.stripTileHeight;
    shown.forEach((tile, i) => {
      layout[tile.key] = {
        frame: {
          x: startX + i * (callLayout.stripTileWidth + gap),
          y: stripY,
          width: callLayout.stripTileWidth,
          height: callLayout.stripTileHeight,
          radius: callRadii.tileCompact,
          zIndex: 2,
        },
        variant: 'strip',
      };
    });
    return layout;
  }

  // grid
  const rects = computeGridRects(tiles.length, safe, gap);
  tiles.forEach((tile, i) => {
    const rect = rects[i];
    if (!rect) return;
    layout[tile.key] = {
      frame: { ...rect, radius: callRadii.tile, zIndex: 1 },
      variant: 'card',
    };
  });
  return layout;
}

// ─── Audio output ────────────────────────────────────────────────────────────

export type AudioOutputType = 'speaker' | 'earpiece' | 'bluetooth' | 'headset';

const AUDIO_OUTPUT_TYPES: readonly AudioOutputType[] = [
  'speaker',
  'earpiece',
  'bluetooth',
  'headset',
];

export const AUDIO_OUTPUT_LABELS: Record<AudioOutputType, string> = {
  speaker: 'Speaker',
  earpiece: 'Phone',
  bluetooth: 'Bluetooth',
  headset: 'Headset',
};

export function isAudioOutputType(value: string): value is AudioOutputType {
  return (AUDIO_OUTPUT_TYPES as readonly string[]).includes(value);
}

/** LiveKit's automatic Android routing order — used to guess the active output. */
const DEFAULT_OUTPUT_PRIORITY: readonly AudioOutputType[] = [
  'bluetooth',
  'headset',
  'speaker',
  'earpiece',
];

export function guessActiveAudioOutput(outputs: readonly string[]): AudioOutputType | null {
  for (const type of DEFAULT_OUTPUT_PRIORITY) {
    if (outputs.includes(type)) return type;
  }
  return null;
}

/** True when the only choices are the built-in speaker and earpiece (a plain toggle suffices). */
export function isSpeakerEarpieceOnly(outputs: readonly string[]): boolean {
  const known = outputs.filter(isAudioOutputType);
  return known.length > 0 && known.every(o => o === 'speaker' || o === 'earpiece');
}
