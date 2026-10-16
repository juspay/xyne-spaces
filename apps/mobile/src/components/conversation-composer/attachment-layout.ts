export const ATTACHMENT_GRID_HEIGHT = 180;
export const ATTACHMENT_GRID_GAP = 2;
export const FILE_ATTACHMENT_CARD_HEIGHT = 74;

/**
 * Narrowest chat-bubble content box across every surface that hosts a
 * `FileAttachmentCard` inside a message bubble:
 *
 * - v2 channel/DM list (`chat-message-list-row`): row `px-4`, bubble `max-w-[78%]`
 * - v2 thread (`chat-thread`):                    row `px-3`, bubble `max-w-[78%]`
 * - v3 rows (`ChatListRow` + `MessageRow`):        row `px-4`, bubble `maxWidth: 0.78W - 12`
 *
 * All bubbles have `px-2` inner padding. The v2 channel row is the tightest,
 * so `(W - 32) * 0.78 - 16` is a lower bound for all of them. Using the lower
 * bound means the card always fits, whichever surface renders it.
 */
export const CHAT_BUBBLE_MAX_WIDTH_RATIO = 0.78;
export const CHAT_ROW_HORIZONTAL_PADDING_PX = 32;
export const CHAT_BUBBLE_INNER_HORIZONTAL_PADDING_PX = 16;

export const FILE_ATTACHMENT_CARD_PREFERRED_MIN_WIDTH = 256;
export const FILE_ATTACHMENT_CARD_MAX_WIDTH = 360;

export const getChatBubbleContentMinAvailableWidth = (windowWidth: number): number =>
  Math.max(
    0,
    (windowWidth - CHAT_ROW_HORIZONTAL_PADDING_PX) * CHAT_BUBBLE_MAX_WIDTH_RATIO -
      CHAT_BUBBLE_INNER_HORIZONTAL_PADDING_PX,
  );

/**
 * The card prefers 256dp, but a hard 256dp `minWidth` is wider than the bubble
 * on viewports below ~381dp (most Android phones, and any phone with a larger
 * display size setting). Yoga honours `minWidth` over the parent's width, so
 * the card painted outside the bubble. Clamp it to what every bubble can give.
 */
export const getFileAttachmentCardMinWidth = (windowWidth: number): number =>
  Math.min(
    FILE_ATTACHMENT_CARD_PREFERRED_MIN_WIDTH,
    getChatBubbleContentMinAvailableWidth(windowWidth),
  );
