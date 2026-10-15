export const EMOJI_PICKER_CELL_SIZE = 42;
export const EMOJI_PICKER_ROW_HEIGHT = EMOJI_PICKER_CELL_SIZE;
export const EMOJI_PICKER_HEADER_HEIGHT = 28;
export const EMOJI_PICKER_CUSTOM_EMOJI_SIZE = 32;
export const EMOJI_PICKER_CATEGORY_BAR_HEIGHT = 44;
export const EMOJI_PICKER_SHEET_HEIGHT_RATIO = 0.52;
// Gorhom's default handle occupies part of the sheet snap height. The picker
// panel must use the remaining viewport, otherwise its fixed category bar is
// pushed below a half-height sheet.
export const EMOJI_PICKER_SHEET_HANDLE_HEIGHT = 24;

export const getEmojiPickerSheetHeight = (windowHeight: number): number =>
  Math.round(windowHeight * EMOJI_PICKER_SHEET_HEIGHT_RATIO);

export const getEmojiPickerPanelHeight = (windowHeight: number): number =>
  Math.max(0, getEmojiPickerSheetHeight(windowHeight) - EMOJI_PICKER_SHEET_HANDLE_HEIGHT);

export const EMOJI_PICKER_SEARCH_DEBOUNCE_MS = 80;
export const FREQUENT_EMOJI_STORAGE_KEY = '@lotus_frequent_emojis_v1';
export const FREQUENT_EMOJI_MAX_ITEMS = 16;

// Two grid rows on either side of the viewport. This keeps a fast-scroll buffer
// without retaining a large number of custom-image cells in memory.
export const EMOJI_PICKER_LIST_DRAW_DISTANCE = EMOJI_PICKER_ROW_HEIGHT * 2;

export const EMOJI_PICKER_VIEWABILITY_CONFIG = {
  itemVisiblePercentThreshold: 40,
  minimumViewTime: 80,
};
