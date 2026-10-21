/** Shared EnrichedTextInput typography — keep emoji size within the line box. */
export const COMPOSER_INPUT_FONT_SIZE = 16;
export const COMPOSER_INPUT_LINE_HEIGHT = 18;

/** `setImage` dimensions for inline custom emojis (must not exceed line height). */
export const COMPOSER_INPUT_INLINE_EMOJI_SIZE = COMPOSER_INPUT_FONT_SIZE;

/** The inline attachment action's glyph and unfocused hit target dimensions. */
export const COMPOSER_INPUT_ATTACHMENT_ICON_SIZE = 24;
export const COMPOSER_INPUT_ATTACHMENT_BUTTON_PADDING = 4;
export const COMPOSER_INPUT_ATTACHMENT_BUTTON_SIZE =
  COMPOSER_INPUT_ATTACHMENT_ICON_SIZE + COMPOSER_INPUT_ATTACHMENT_BUTTON_PADDING * 2;

/** Focused send control — always 32×32; dim when `canSend` is false, never hide. */
export const COMPOSER_SEND_BUTTON_SIZE = COMPOSER_INPUT_ATTACHMENT_BUTTON_SIZE;
export const COMPOSER_SEND_DISABLED_OPACITY = 0.4;

export const composerSendOpacity = (canSend: boolean): number =>
  canSend ? 1 : COMPOSER_SEND_DISABLED_OPACITY;

/** Tunable gap between the attachment action and composer text. */
export const COMPOSER_INPUT_TEXT_GAP = 6;

/**
 * Leading inset so collapsed text clears the overlay + control.
 * Applied as native `paddingLeft` (not a wrapper) so wrap width equals the
 * visible field. Focused and edit mode have no overlay +, so this is 0.
 */
export const composerInputLeadingInset = (
  isInputFocused: boolean,
  hasLeadingAttachmentAction: boolean,
): number =>
  !isInputFocused && hasLeadingAttachmentAction
    ? COMPOSER_INPUT_ATTACHMENT_BUTTON_SIZE + COMPOSER_INPUT_TEXT_GAP
    : 0;

/**
 * Trailing inset for the collapsed pill so a long ellipsised line does not sit
 * flush against the rounded edge. Focused wrap must stay full-width — the
 * previous 64px right gutter made wrap width wider than the visible field.
 */
export const COMPOSER_INPUT_COLLAPSED_TRAILING_INSET = 8;

export const composerInputTrailingInset = (isInputFocused: boolean): number =>
  isInputFocused ? 0 : COMPOSER_INPUT_COLLAPSED_TRAILING_INSET;

/**
 * Blurred, the composer is exactly one line tall. The unfocused preview is a
 * single ellipsised line centred over the field, so any multiline height left
 * over from typing would read as dead space above and below that line.
 */
export const COMPOSER_INPUT_COLLAPSED_HEIGHT = 24;

/**
 * Focused, the field grows to about four lines before scrolling internally.
 * Must clear a custom-emoji wrap off a full third line (16px overlay on an
 * 18px line box) so a second inline image is not clipped.
 */
export const COMPOSER_INPUT_EXPANDED_MAX_HEIGHT = 96;

/** Fixed width for DM status placeholder text before the trailing status emoji. */
export const COMPOSER_STATUS_PLACEHOLDER_TEXT_WIDTH = 180;
export const PLACEHOLDER_MAX_LENGTH = 20;
