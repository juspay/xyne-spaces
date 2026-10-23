import { avatarCornerBadgeSize } from '@/src/ui/avatar/avatar.geometry';

/**
 * Row metrics.
 *
 * The classic DMs list's row (`components/chat/dm-list`), written as numbers
 * because this list places every slot explicitly instead of letting flex
 * centre them. The classic row is a 48px avatar between 10px of vertical
 * padding, with a 24px title line, a 2px gap and the preview beneath.
 */

/** Fixed, so LegendList never measures a row. */
export const DM_ROW_HEIGHT = 68;

/** The avatar rect, centred vertically in the row. */
export const DM_AVATAR_SIZE = 48;
export const DM_ROW_PADDING_LEFT = 12;
export const DM_ROW_PADDING_RIGHT = 12;
export const DM_AVATAR_GAP = 12;

export const DM_TEXT_TOP = 12;
export const DM_TITLE_SIZE = 16;
export const DM_TITLE_LINE_HEIGHT = 24;

export const DM_PREVIEW_GAP = 2;
export const DM_PREVIEW_SIZE = 15;
export const DM_PREVIEW_LINE_HEIGHT = 18;
export const DM_PREVIEW_LINES = 1;

/** Timestamp hangs from the top of the text column. */
export const DM_META_TOP = 12;
export const DM_TIMESTAMP_SIZE = 12;
export const DM_TIMESTAMP_LINE_HEIGHT = 14;

/**
 * Badge row starts level with the preview row: title line + gap below the
 * text top, less what the timestamp has already taken.
 */
export const DM_BADGE_GAP = DM_TITLE_LINE_HEIGHT + DM_PREVIEW_GAP - DM_TIMESTAMP_LINE_HEIGHT;

/** The star in the avatar's corner cut-out, with room around it inside the circle. */
export const DM_STAR_SIZE = Math.round(avatarCornerBadgeSize(DM_AVATAR_SIZE) * 0.68);

export const DM_BADGE_SIZE = 22;
export const DM_BADGE_PADDING_X = 6;
export const DM_BADGE_TEXT_SIZE = 12;
