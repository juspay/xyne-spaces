/**
 * Metrics for the redesigned conversation screens, from the Figma "Room"
 * frames. Written as numbers because several rows place things explicitly
 * (the thread hook, the fixed-height dividers) instead of letting flex decide.
 */

/** Room header: 44 tall below the safe area, a 36 button with 4 above and below. */
export const ROOM_HEADER_HEIGHT = 44;
export const ROOM_HEADER_BUTTON_SIZE = 36;
export const ROOM_HEADER_BUTTON_ICON_SIZE = 20;
export const ROOM_HEADER_PADDING_LEFT = 14;
export const ROOM_HEADER_PADDING_RIGHT = 20;
export const ROOM_HEADER_TITLE_GAP = 10;
export const ROOM_HEADER_CHEVRON_SIZE = 12;
export const ROOM_HEADER_AVATAR_SIZE = 28;

/** Message row: px 16, py 12, 12 between the avatar and the body. */
export const MESSAGE_PADDING_X = 16;
export const MESSAGE_PADDING_Y = 12;
export const MESSAGE_GAP = 12;
export const MESSAGE_AVATAR_SIZE = 32;
export const MESSAGE_HEADER_GAP = 6;
/** Space between the words and each extra under them (reactions, files, thread). */
export const MESSAGE_EXTRAS_GAP = 8;
/** What the body gives up to the sides: both paddings, the avatar and the gap beside it. */
export const MESSAGE_BODY_HORIZONTAL_CHROME =
  MESSAGE_PADDING_X * 2 + MESSAGE_AVATAR_SIZE + MESSAGE_GAP;
/**
 * The shared markdown renderer subtracts its bubble padding from the width it
 * is given; this is that number, so the flat body can hand it a width that
 * nets out to the real one.
 */
export const RENDERER_BUBBLE_PADDING = 16;

/** The bottom margin the shared content block puts under the words. */
export const CONTENT_INNER_MARGIN = 10;

/**
 * A second message from the same sender, close in time, joins the block above
 * it: no avatar, no header, and its words sit this far under the last element
 * of the message before.
 */
export const CONTINUATION_GAP = 8;
/**
 * The row above keeps its bottom padding, so a continuation pulls up by the
 * difference instead of adding its own top padding (negative: it overlaps that
 * padding, which is empty).
 */
export const CONTINUATION_TOP_OFFSET = CONTINUATION_GAP - MESSAGE_PADDING_Y;

/** Reactions: 26 tall, a 12 label, 4 between pills, no edge. */
export const REACTION_CHIP_HEIGHT = 26;
export const REACTION_CHIP_PADDING_X = 8;
export const REACTION_CHIP_GAP = 4;
export const REACTION_EMOJI_SIZE = 14;

/** Agent tag beside the name: 4 / 2 padding, radius 4, a 12/16 label. */
export const AGENT_TAG_RADIUS = 4;
export const AGENT_TAG_PADDING_X = 4;
export const AGENT_TAG_PADDING_Y = 2;

/** File card: 60 tall, a bare 20 icon, 12 padding and gaps. */
export const FILE_CARD_RADIUS = 12;
export const FILE_CARD_PADDING = 12;
export const FILE_CARD_MIN_HEIGHT = 60;
export const FILE_CARD_ICON_SIZE = 20;

/**
 * Thread strip. Fixed height (20 faces, 12 padding, 1 border each side), so the
 * hook that joins it to the avatar can end at the strip's vertical centre
 * without measuring anything.
 */
export const THREAD_STRIP_HEIGHT = 46;
export const THREAD_STRIP_RADIUS = 12;
export const THREAD_STRIP_PADDING = 12;
export const THREAD_STRIP_GAP = 10;
export const THREAD_STRIP_AVATAR_SIZE = 20;
export const THREAD_STRIP_AVATAR_OVERLAP = 6;
export const THREAD_STRIP_MAX_AVATARS = 3;
export const THREAD_HOOK_RADIUS = 10;
/** Gap between the avatar and where the hook starts. */
export const THREAD_HOOK_TOP_GAP = 6;

/** Dividers: text line 18, 32 above, 12 below. */
const DIVIDER_LINE_HEIGHT = 18;
export const DIVIDER_PADDING_TOP = 32;
export const DIVIDER_PADDING_BOTTOM = 12;
export const DIVIDER_HEIGHT = DIVIDER_PADDING_TOP + DIVIDER_LINE_HEIGHT + DIVIDER_PADDING_BOTTOM;

/** Thread card header. */
export const THREAD_HEADER_HEIGHT = 56;
export const THREAD_HEADER_BUTTON_SIZE = 36;
export const THREAD_HEADER_AVATAR_SIZE = 24;
export const THREAD_HEADER_AVATAR_OVERLAP = 8;
export const THREAD_HEADER_MAX_AVATARS = 3;

/** The horizontal inset the thread list puts around every row. */
export const THREAD_LIST_INSET = 12;

/** The replies divider under the thread's root message: an inset hairline and a label. */
export const REPLY_DIVIDER_PADDING_X = 16;
export const REPLY_DIVIDER_HEIGHT = 40;

/**
 * Hold menu (Figma "Hold a message"): a reaction rail above the lifted
 * message and an action card below it, both inset 16 from the screen edges.
 * Rows are a fixed height so the card's height is known without measuring,
 * which the placement math relies on.
 */
export const HOLD_EDGE_INSET = 8;
export const HOLD_SIDE_INSET = 16;
export const HOLD_BLOCK_GAP = 8;
export const HOLD_RAIL_HEIGHT = 52;
export const HOLD_RAIL_PADDING = 4;
export const HOLD_REACTION_SIZE = 44;
export const HOLD_REACTION_EMOJI_SIZE = 24;
export const HOLD_MENU_RADIUS = 16;
export const HOLD_MENU_PADDING_Y = 8;
export const HOLD_MENU_ROW_HEIGHT = 44;
export const HOLD_MENU_ROW_PADDING_X = 16;
export const HOLD_MENU_ROW_GAP = 12;
export const HOLD_MENU_ICON_SIZE = 20;
/** The lifted message may take at most this share of the free height. */
export const HOLD_MAX_CARD_SHARE = 0.4;
/** A scrolling menu never shrinks below this many rows. */
export const HOLD_MIN_MENU_ROWS = 3;
export const HOLD_BACKDROP_OPACITY = 0.4;
/** Same red the classic actions sheet uses for Delete (no spaces token exists). */
export const HOLD_DESTRUCTIVE_COLOR = '#dc2626';
