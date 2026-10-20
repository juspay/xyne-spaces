import {
  HOLD_BLOCK_GAP,
  HOLD_EDGE_INSET,
  HOLD_MAX_CARD_SHARE,
  HOLD_MENU_PADDING_Y,
  HOLD_MENU_ROW_HEIGHT,
  HOLD_MIN_MENU_ROWS,
  HOLD_RAIL_HEIGHT,
} from '../constants';

/** The slice of the classic `MessageAction` the menu orders and relabels. */
export type HoldMenuActionInput = {
  id: string;
  label: string;
  visible: boolean;
  variant?: 'default' | 'destructive' | undefined;
};

/** The Figma menu leads with these four, in this order. */
const FIGMA_ORDER = ['reply-in-thread', 'bookmark', 'copy-message', 'ask-ai'] as const;

/**
 * Figma wording where the design names an action; everything else keeps the
 * classic label. Bookmark toggles by the label the classic hook produced.
 */
const FIGMA_LABELS = new Map<string, string | ((classicLabel: string) => string)>([
  ['reply-in-thread', 'Reply in thread'],
  [
    'bookmark',
    (classic: string): string =>
      classic.startsWith('Remove') ? 'Remove from Starred' : 'Add to Starred',
  ],
  ['copy-message', 'Copy text'],
  ['ask-ai', 'Ask Xyne about this'],
]);

export function holdMenuLabel(id: string, classicLabel: string): string {
  const mapped = FIGMA_LABELS.get(id);
  if (mapped === undefined) return classicLabel;
  return typeof mapped === 'function' ? mapped(classicLabel) : mapped;
}

/**
 * The classic actions in the order the hold menu shows them: the four Figma
 * rows first, the rest in the classic order, destructive rows last. Hidden
 * actions are dropped. Pure; never invents or removes a visible action.
 */
export function orderHoldMenuActions<T extends HoldMenuActionInput>(
  actions: readonly T[],
): (T & { menuLabel: string })[] {
  const visible = actions.filter(action => action.visible);
  const rank = (action: T): number => {
    if (action.variant === 'destructive') return 2;
    return (FIGMA_ORDER as readonly string[]).includes(action.id) ? 0 : 1;
  };
  const figmaIndex = (action: T): number => (FIGMA_ORDER as readonly string[]).indexOf(action.id);

  return visible
    .map((action, index) => ({ action, index }))
    .sort((a, b) => {
      const byRank = rank(a.action) - rank(b.action);
      if (byRank !== 0) return byRank;
      if (rank(a.action) === 0) return figmaIndex(a.action) - figmaIndex(b.action);
      return a.index - b.index;
    })
    .map(({ action }) => ({ ...action, menuLabel: holdMenuLabel(action.id, action.label) }));
}

export type HoldRect = { x: number; y: number; width: number; height: number };

export type HoldLayoutInput = {
  windowHeight: number;
  insetTop: number;
  insetBottom: number;
  /** Where the held row sits, relative to the overlay; null when it could not be measured. */
  rect: Pick<HoldRect, 'y' | 'height'> | null;
  showRail: boolean;
  menuRowCount: number;
};

export type HoldLayout = {
  /** Top of the rail (unused when the rail is hidden). */
  railTop: number;
  /** Top of the lifted message; equals the middle of the stack when there is no message. */
  cardTop: number;
  cardHeight: number;
  /** cardTop minus where the row really is, so the card can glide into place. */
  cardShift: number;
  menuTop: number;
  menuHeight: number;
  /** The menu's natural height exceeded the space and it scrolls. */
  menuScrolls: boolean;
};

export const holdMenuNaturalHeight = (rows: number): number =>
  rows * HOLD_MENU_ROW_HEIGHT + HOLD_MENU_PADDING_Y * 2;

/**
 * Stacks rail, message and menu, then slides the stack so all of it stays
 * inside the safe area: a row near the bottom pushes the stack up, one near
 * the top pushes it down. A tall message is clipped to a share of the screen
 * and a long menu scrolls inside its card.
 */
export function computeHoldLayout(input: HoldLayoutInput): HoldLayout {
  const { windowHeight, insetTop, insetBottom, rect, showRail, menuRowCount } = input;
  const minTop = insetTop + HOLD_EDGE_INSET;
  const maxBottom = windowHeight - insetBottom - HOLD_EDGE_INSET;
  const free = Math.max(0, maxBottom - minTop);

  const railBlock = showRail ? HOLD_RAIL_HEIGHT + HOLD_BLOCK_GAP : 0;
  const cardHeight = rect ? Math.min(rect.height, free * HOLD_MAX_CARD_SHARE) : 0;
  const cardBlock = cardHeight > 0 ? cardHeight + HOLD_BLOCK_GAP : 0;

  const natural = holdMenuNaturalHeight(menuRowCount);
  const minMenu = holdMenuNaturalHeight(Math.min(menuRowCount, HOLD_MIN_MENU_ROWS));
  const roomForMenu = Math.max(minMenu, free - railBlock - cardBlock);
  const menuHeight = Math.min(natural, roomForMenu);

  const stackHeight = railBlock + cardBlock + menuHeight;
  const desiredTop = rect ? rect.y - railBlock : minTop + (free - stackHeight) / 2;
  const stackTop = Math.max(minTop, Math.min(desiredTop, maxBottom - stackHeight));

  const cardTop = stackTop + railBlock;
  return {
    railTop: stackTop,
    cardTop,
    cardHeight,
    cardShift: rect ? cardTop - rect.y : 0,
    menuTop: cardTop + cardBlock,
    menuHeight,
    menuScrolls: menuHeight < natural,
  };
}
