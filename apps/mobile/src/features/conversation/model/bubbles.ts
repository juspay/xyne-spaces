import {
  BUBBLE_BEHIND_STEP,
  BUBBLE_CLEAR_ALL_HEIGHT,
  BUBBLE_CLOSE_REACH_ABOVE,
  BUBBLE_CLOSE_SLOP,
  BUBBLE_EDGE_INSET,
  BUBBLE_FLING_PROJECTION,
  BUBBLE_KEYBOARD_CLEARANCE,
  BUBBLE_LIST_GAP,
  BUBBLE_LIST_ROW_HEIGHT,
  BUBBLE_SIZE,
  BUBBLE_TUCK_DISTANCE,
} from '../constants';

/** A thread put down with the header's "−": what its bubble and list row draw, read when it was parked. */
export type ParkedThread = Readonly<{
  channelId: string;
  threadId: string;
  /** The message the thread hangs off, on one line (threads have no names). */
  title: string;
  /** Where it came from ("#payments-core", a DM's name): what tells two threads of the same people apart. */
  channelName: string;
  /** Agents first, then people in the order they joined the thread. */
  faceIds: readonly string[];
  /** The route params the room opened it with, so it reopens the same way. */
  surface?: string | undefined;
  scopeType?: string | undefined;
}>;

/** The agents running in a thread right now, as its progress feed reports them. */
export type WorkingAgents = Readonly<{ agentIds: readonly string[]; agentName: string | null }>;

/** A parked thread's agent: none, still answering, or answered since it was parked. */
export type BubbleAgentState =
  | Readonly<{ kind: 'resting' }>
  | Readonly<{ kind: 'working' } & WorkingAgents>
  | Readonly<{ kind: 'answered' } & WorkingAgents>;

export const RESTING: BubbleAgentState = { kind: 'resting' };

/** Parks a thread in front: newest first, each thread once. */
export function withParked(
  parked: readonly ParkedThread[],
  thread: ParkedThread,
): readonly ParkedThread[] {
  return [thread, ...parked.filter(entry => entry.threadId !== thread.threadId)];
}

export function withoutParked(
  parked: readonly ParkedThread[],
  threadId: string,
): readonly ParkedThread[] {
  return parked.some(entry => entry.threadId === threadId)
    ? parked.filter(entry => entry.threadId !== threadId)
    : parked;
}

/**
 * The faces a parked thread shows: whoever started it, then each replier in
 * the order they first replied, each person once; an agent's thread starts
 * with the agent, so agents move to the front.
 */
export function bubbleFaceIds(
  rootSenderId: string | undefined,
  replierIds: readonly string[],
  isAgent: (userId: string) => boolean,
): string[] {
  const ordered: string[] = [];
  for (const id of [rootSenderId, ...replierIds]) {
    if (id && !ordered.includes(id)) ordered.push(id);
  }
  return [...ordered.filter(isAgent), ...ordered.filter(id => !isAgent(id))];
}

type FaceSlot = Readonly<{ left: number; top: number; size: number }>;

/**
 * Where faces sit, by how many there are (Figma "Bubble / Thread" at 58 and
 * "Bubble / Row tile" at 34). Library sizes only: never a resized face.
 */
const FACE_SLOTS: Record<'bubble' | 'row', readonly (readonly FaceSlot[])[]> = {
  bubble: [
    [{ left: 13, top: 13, size: 32 }],
    [
      { left: 6, top: 6, size: 24 },
      { left: 28, top: 28, size: 24 },
    ],
    [
      { left: 5, top: 15, size: 28 },
      { left: 33, top: 7, size: 20 },
      { left: 33, top: 31, size: 20 },
    ],
  ],
  row: [
    [{ left: 5, top: 5, size: 24 }],
    [
      { left: 0, top: 0, size: 20 },
      { left: 14, top: 14, size: 20 },
    ],
    [
      { left: 0, top: 7, size: 20 },
      { left: 18, top: 0, size: 16 },
      { left: 18, top: 18, size: 16 },
    ],
  ],
};

type FaceMosaic = Readonly<{
  faces: readonly Readonly<{ userId: string; slot: FaceSlot }>[];
  /** More than three: the last slot says "+N" instead of a face. */
  more: Readonly<{ count: number; slot: FaceSlot }> | null;
}>;

export function faceMosaic(faceIds: readonly string[], tile: 'bubble' | 'row'): FaceMosaic {
  const layouts = FACE_SLOTS[tile];
  const slots = layouts[Math.min(faceIds.length, layouts.length) - 1];
  if (!slots) return { faces: [], more: null };
  const overflow = faceIds.length > slots.length;
  const shown = overflow ? slots.length - 1 : faceIds.length;
  const faces = faceIds.slice(0, shown).map((userId, index) => ({
    userId,
    slot: slots[index] as FaceSlot,
  }));
  const moreSlot = slots[slots.length - 1];
  return {
    faces,
    more: overflow && moreSlot ? { count: faceIds.length - shown, slot: moreSlot } : null,
  };
}

/**
 * A parked thread's agent after a progress update: working while any agent
 * runs, and answered once they have all finished, which stays until the
 * thread is opened. `answeredNow` is the moment it turns, for the toast.
 */
export function nextAgentState(
  previous: BubbleAgentState,
  working: WorkingAgents | null,
): { state: BubbleAgentState; answeredNow: boolean } {
  if (working !== null) {
    return { state: { kind: 'working', ...working }, answeredNow: false };
  }
  if (previous.kind === 'working') {
    const { agentIds, agentName } = previous;
    return { state: { kind: 'answered', agentIds, agentName }, answeredNow: true };
  }
  return { state: previous, answeredNow: false };
}

export type BubbleSide = 'left' | 'right';

/** The bubble's x when it rests against a side. */
export function bubbleRestX(side: BubbleSide, screenWidth: number): number {
  'worklet';
  return side === 'left' ? BUBBLE_EDGE_INSET : screenWidth - BUBBLE_EDGE_INSET - BUBBLE_SIZE;
}

/** The side a released bubble snaps to: the nearer one, after a short projection of a fling. */
export function bubbleSettleSide(x: number, velocityX: number, screenWidth: number): BubbleSide {
  'worklet';
  const centre = x + BUBBLE_SIZE / 2 + velocityX * BUBBLE_FLING_PROJECTION;
  return centre < screenWidth / 2 ? 'left' : 'right';
}

/** The edge a released bubble tucks into, when it was pushed far enough past one. */
export function bubbleTuckSide(x: number, screenWidth: number): BubbleSide | null {
  'worklet';
  if (x < -BUBBLE_TUCK_DISTANCE) return 'left';
  if (x + BUBBLE_SIZE > screenWidth + BUBBLE_TUCK_DISTANCE) return 'right';
  return null;
}

/** The bubble's x when tucked: just past that edge, so it slides off rather than vanishing. */
export function bubbleTuckedX(side: BubbleSide, screenWidth: number): number {
  'worklet';
  return side === 'left' ? -BUBBLE_SIZE - BUBBLE_EDGE_INSET : screenWidth + BUBBLE_EDGE_INSET;
}

export function clampBubbleY(y: number, minY: number, maxY: number): number {
  'worklet';
  return Math.min(Math.max(y, minY), Math.max(minY, maxY));
}

/**
 * How far a bubble at `y` rides up while the keyboard is `keyboardHeight` tall:
 * a low bubble sits clear of the composer above it, a high one stays put.
 */
export function bubbleKeyboardLift(
  y: number,
  screenHeight: number,
  keyboardHeight: number,
): number {
  'worklet';
  if (keyboardHeight <= 0) return 0;
  const highest = screenHeight - keyboardHeight - BUBBLE_KEYBOARD_CLEARANCE - BUBBLE_SIZE;
  return Math.min(0, highest - y);
}

/** Cards behind sit below the bubble, or above it once it is in the bottom half. */
export function behindDirection(y: number, screenHeight: number): 1 | -1 {
  'worklet';
  return y + BUBBLE_SIZE / 2 > screenHeight / 2 ? -1 : 1;
}

export type ScreenRect = Readonly<{ x: number; y: number; width: number; height: number }>;

/**
 * Whether the dragged bubble's centre is over the close target, give or take
 * its slop, which reaches further above it.
 */
export function isOverCloseTarget(x: number, y: number, target: ScreenRect): boolean {
  'worklet';
  const centreX = x + BUBBLE_SIZE / 2;
  const centreY = y + BUBBLE_SIZE / 2;
  return (
    centreX > target.x - BUBBLE_CLOSE_SLOP &&
    centreX < target.x + target.width + BUBBLE_CLOSE_SLOP &&
    centreY > target.y - BUBBLE_CLOSE_REACH_ABOVE &&
    centreY < target.y + target.height + BUBBLE_CLOSE_SLOP
  );
}

/**
 * One frame of the cards behind, as flat [x1, y1, x2, y2, …] pairs. Spread,
 * each card chases the one ahead of it (the first chases the bubble) to a
 * step along; folded, they all gather at the first card's place. `follow` is
 * the share of the gap closed this frame (1 lands at once).
 */
export function stepTrail(
  trail: readonly number[],
  headX: number,
  headY: number,
  direction: 1 | -1,
  spread: boolean,
  follow: number,
): number[] {
  'worklet';
  const next = trail.slice();
  const step = BUBBLE_BEHIND_STEP * direction;
  for (let index = 0; index < next.length; index += 2) {
    const leadX = !spread || index === 0 ? headX : (next[index - 2] as number);
    const leadY = !spread || index === 0 ? headY : (next[index - 1] as number);
    const x = next[index] as number;
    const y = next[index + 1] as number;
    next[index] = x + (leadX - x) * follow;
    next[index + 1] = y + (leadY + step - y) * follow;
  }
  return next;
}

/** Whether every card is within half a point of where it is heading. */
export function trailSettled(trail: readonly number[], target: readonly number[]): boolean {
  'worklet';
  for (let index = 0; index < trail.length; index += 1) {
    if (Math.abs((trail[index] as number) - (target[index] as number)) > 0.5) return false;
  }
  return true;
}

/** The frame-rate-independent share of a per-60 Hz-frame `follow`, for a frame `elapsedMs` long. */
export function frameFollow(follow: number, elapsedMs: number): number {
  'worklet';
  if (follow >= 1) return 1;
  return 1 - Math.pow(1 - follow, Math.max(elapsedMs, 0) / (1000 / 60));
}

export type BubbleListPlacement = Readonly<{
  side: BubbleSide;
  sideInset: number;
  /** Distance from the top of the screen when it grows down, from the bottom when it grows up. */
  edgeOffset: number;
  growsDown: boolean;
  /**
   * The most the list may take, from `edgeOffset` to the far safe edge less
   * the edge inset. Rows past it scroll; "Clear all" always shows.
   */
  maxHeight: number;
}>;

/**
 * Where the list opens: lined up with the bubble's side edge, stacked away
 * from it toward the middle of the screen (down from a bubble in the top
 * half, up from one in the bottom half), newest nearest the bubble.
 */
export function bubbleListPlacement(
  bubbleX: number,
  bubbleY: number,
  screenWidth: number,
  screenHeight: number,
  safeTop = 0,
  safeBottom = 0,
): BubbleListPlacement {
  const side: BubbleSide = bubbleX + BUBBLE_SIZE / 2 < screenWidth / 2 ? 'left' : 'right';
  const sideInset = Math.max(
    side === 'left' ? bubbleX : screenWidth - bubbleX - BUBBLE_SIZE,
    BUBBLE_EDGE_INSET,
  );
  const growsDown = behindDirection(bubbleY, screenHeight) === 1;
  const edgeOffset = growsDown
    ? bubbleY + BUBBLE_SIZE + BUBBLE_LIST_GAP
    : screenHeight - bubbleY + BUBBLE_LIST_GAP;
  const farEdge = (growsDown ? safeBottom : safeTop) + BUBBLE_EDGE_INSET;
  const maxHeight = Math.max(screenHeight - edgeOffset - farEdge, 0);
  return { side, sideInset, edgeOffset, growsDown, maxHeight };
}

/**
 * How tall the scrolling rows may be: the list's room less "Clear all" and
 * the gap above it, but never under one row, so a cramped list still shows one.
 */
export function bubbleListRowsMaxHeight(maxHeight: number): number {
  return Math.max(maxHeight - BUBBLE_CLEAR_ALL_HEIGHT - BUBBLE_LIST_GAP, BUBBLE_LIST_ROW_HEIGHT);
}

/**
 * Route segments the bubbles stay hidden under: a thread (the card is the
 * thread itself), calls (native and the web call), recordings, the web
 * canvases, and full-screen viewers and flows.
 */
const BUBBLE_HIDDEN_SEGMENTS: ReadonlySet<string> = new Set([
  '[threadId]',
  'native-call',
  'call-prejoin',
  '[callId]',
  '[recordingId]',
  'canvas',
  'channel-canvas',
  'rca',
  'attachments-viewer',
  'quick-look',
  'create-workspace',
  'share-target',
]);

/**
 * Whether parked bubbles float over the screen at `segments`. A ticket screen
 * showing a parked thread (`shownThreadId`) is that thread, so they hide there too.
 */
export function bubblesShowOver(
  segments: readonly string[],
  shownThreadId?: string | null,
  parkedThreadIds: readonly string[] = [],
): boolean {
  if (segments.some(segment => BUBBLE_HIDDEN_SEGMENTS.has(segment))) return false;
  if (segments.includes('[ticketId]') && shownThreadId && parkedThreadIds.includes(shownThreadId)) {
    return false;
  }
  return true;
}
