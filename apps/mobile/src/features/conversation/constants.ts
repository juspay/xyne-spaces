/**
 * Metrics for the redesigned conversation screens, from the Figma "Room"
 * frames. Written as numbers because several rows place things explicitly
 * (the thread hook, the fixed-height dividers) instead of letting flex decide.
 */

/** Room header: 44 tall below the safe area, a 36 button with 4 above and below. */
export const ROOM_HEADER_HEIGHT = 44;
export const ROOM_HEADER_BUTTON_SIZE = 36;
export const ROOM_HEADER_BUTTON_ICON_SIZE = 20;
export const ROOM_HEADER_PADDING_LEFT = 10;
export const ROOM_HEADER_PADDING_RIGHT = 12;
export const ROOM_HEADER_CHEVRON_SIZE = 12;
export const ROOM_HEADER_AVATAR_SIZE = 32;
/** A channel's title sits 14 from the back button; a DM leads with its avatar at 4, then the name at 2 past the 8 gap. */
export const ROOM_HEADER_CHANNEL_TITLE_PADDING_LEFT = 14;
export const ROOM_HEADER_DM_AVATAR_PADDING_LEFT = 4;
export const ROOM_HEADER_DM_TITLE_PADDING_LEFT = 2;
/** Between the title's avatar, lock icon and words. */
export const ROOM_HEADER_TITLE_GAP = 8;
/** Between a channel's name and the chevron after it. */
export const ROOM_HEADER_TITLE_CHEVRON_GAP = 4;
/** The call button's chevron tucks this far into the button's right edge. */
export const ROOM_HEADER_CALL_CHEVRON_MARGIN_LEFT = -7;

/**
 * Find in this channel (Figma "Room / Header", Kind=Search): the title and
 * actions give way to a 36 field (radius 18, 12 at the sides, 8 between a 16
 * search icon and the words) and a Cancel with 8 either side, the header
 * ending 8 in so "Cancel" sits 16 from the edge.
 */
/** Android's wait before focusing the find field; global search measured 300 as the first reliable delay. */
export const FIND_ANDROID_FOCUS_DELAY_MS = 300;
export const FIND_HEADER_PADDING_RIGHT = 8;
export const FIND_FIELD_HEIGHT = 36;
export const FIND_FIELD_PADDING_X = 12;
export const FIND_FIELD_GAP = 8;
export const FIND_FIELD_ICON_SIZE = 16;
export const FIND_CANCEL_PADDING_X = 8;
/** The "4 messages" row over the results: 16 at the sides, 12 above and below. */
export const FIND_COUNT_PADDING_X = 16;
export const FIND_COUNT_PADDING_Y = 12;
/** A one-line result: 12 + a 20 header, 2, a 22 line + 12. */
export const FIND_RESULT_ESTIMATED_HEIGHT = 68;
/** The empty and error notes sit this far below the top of the results, 32 in from the sides. */
export const FIND_NOTE_PADDING_TOP = 48;
export const FIND_NOTE_PADDING_X = 32;
/** The find field's words, Figma Type/Body (16 on the body's 22 line). */
export const FIND_FIELD_FONT_SIZE = 16;
export const FIND_FIELD_LETTER_SPACING = -0.176;
/** The next page loads once the results are scrolled within this share of their end. */
export const FIND_LOAD_MORE_THRESHOLD = 0.4;

/** Message row: px 16, py 12, 12 between the avatar and the body. */
export const MESSAGE_PADDING_X = 16;
export const MESSAGE_PADDING_Y = 12;
export const MESSAGE_GAP = 12;
export const MESSAGE_AVATAR_SIZE = 32;
export const MESSAGE_HEADER_GAP = 6;
/** Figma Type/Body: 16 on 22. */
export const MESSAGE_BODY_LINE_HEIGHT = 22;
/** The chat's 7.3 average glyph width is for 15px text; this is it scaled to the 16px body. */
export const MESSAGE_BODY_CHAR_WIDTH = 7.8;
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
 * The empty line the shared renderer adds after a closing list or code block
 * (see `bodyEndsWithGuardLine`): one body line, which the flat row takes back.
 */
export const BODY_GUARD_LINE_HEIGHT = MESSAGE_BODY_LINE_HEIGHT;

/**
 * A second message from the same sender, close in time, joins the block above
 * it: no avatar, no header, and its words sit this far under the last element
 * of the message before.
 */
const CONTINUATION_GAP = 12;
/**
 * The row above keeps its bottom padding, so a continuation pulls up by the
 * difference instead of adding its own top padding (negative: it overlaps that
 * padding, which is empty).
 */
export const CONTINUATION_TOP_OFFSET = CONTINUATION_GAP - MESSAGE_PADDING_Y;

/**
 * Long messages fold to 11 lines, the last two fading into the row, with a
 * coral "Read more" (16 on 22) under them.
 */
export const COLLAPSED_LINES = 11;
export const COLLAPSE_FADE_HEIGHT = MESSAGE_BODY_LINE_HEIGHT * 2;
const READ_MORE_LINE_HEIGHT = 22;
/** The shared "Read more" link keeps its own 4 above and below. */
export const READ_MORE_BLOCK_HEIGHT = READ_MORE_LINE_HEIGHT + 4 * 2;
/** The link's type; its colour is the palette's `readMore`. */
export const READ_MORE_TEXT_STYLE = {
  fontSize: 16,
  lineHeight: READ_MORE_LINE_HEIGHT,
  fontWeight: '600',
} as const;

/**
 * Reactions: 26 tall pills, radius 13, a 16 emoji on a 22 line, 5 before the
 * 12 count, 4 between pills. The add pill ending the row is 32 wide with a 16 plus.
 */
export const REACTION_CHIP_HEIGHT = 26;
export const REACTION_CHIP_RADIUS = 13;
export const REACTION_CHIP_PADDING_X = 8;
export const REACTION_CHIP_GAP = 4;
export const REACTION_CHIP_INNER_GAP = 5;
export const REACTION_EMOJI_SIZE = 16;
export const REACTION_EMOJI_LINE_HEIGHT = 22;
export const ADD_REACTION_CHIP_WIDTH = 32;
export const ADD_REACTION_ICON_SIZE = 16;

/**
 * Who-reacted sheet (Figma screen 15): 40 top corners, 16 padding, the
 * reaction pills as tabs, then a row per person with a 32 face, 12 to the name.
 */
export const REACTIONS_SHEET_RADIUS = 40;
export const REACTIONS_SHEET_PADDING = 16;
export const REACTIONS_SHEET_ROW_PADDING_Y = 8;
export const REACTIONS_SHEET_ROW_GAP = 12;
export const REACTIONS_SHEET_AVATAR_SIZE = 32;
export const REACTIONS_SHEET_EMOJI_SIZE = 22;

/** Agent tag beside the name: 4 / 2 padding, radius 4, a 12/16 label. */
export const AGENT_TAG_RADIUS = 4;
export const AGENT_TAG_PADDING_X = 4;
export const AGENT_TAG_PADDING_Y = 2;

/** File card: 60 tall, a bare 20 icon, 12 padding and gaps. */
export const FILE_CARD_RADIUS = 12;
export const FILE_CARD_PADDING = 12;
export const FILE_CARD_MIN_HEIGHT = 60;
export const FILE_CARD_ICON_SIZE = 20;
export const FILE_CARD_CHEVRON_SIZE = 16;
/** Figma: 0 / 2 blur 3 at 4% and 0 / 1 blur 1 at 6%, #12141C. */
export const FILE_CARD_SHADOW =
  '0px 2px 3px 0px rgba(18, 20, 28, 0.04), 0px 1px 1px 0px rgba(18, 20, 28, 0.06)';

/**
 * Photos in a message (Figma "Photos in a message", 14 Oct): a flat grid at
 * most 300 wide, radius 14 outside, 3 between photos, each photo edged in 1 of
 * 5% black. A lone photo keeps its shape between 4:5 and 2:1.
 */
export const PHOTO_GRID_MAX_WIDTH = 300;
export const PHOTO_GRID_GAP = 3;
export const PHOTO_GRID_RADIUS = 14;
export const PHOTO_GRID_MAX_CELLS = 4;
export const PHOTO_MIN_ASPECT = 4 / 5;
export const PHOTO_MAX_ASPECT = 2;
/** A lone photo whose size the message doesn't carry: the chat's default 4:3. */
export const PHOTO_UNKNOWN_ASPECT = 4 / 3;
/** The hairline around each photo: the foreground at 5%, so it holds in light and dark. */
export const PHOTO_CELL_EDGE_OPACITY = 0.05;
/** The "+N" on the fourth photo: 22 medium white over the 20% scrim. */
export const PHOTO_OVERFLOW_FONT_SIZE = 22;
/** A video's play button: a 44 circle of 20% black with a 20 white triangle. */
export const PHOTO_PLAY_SIZE = 44;
export const PHOTO_PLAY_ICON_SIZE = 20;
/** A video's length: 13 medium white on 20% black, radius 6, 6 / 2 padding, 8 in from the bottom left. */
export const PHOTO_LENGTH_INSET = 8;
export const PHOTO_LENGTH_RADIUS = 6;
export const PHOTO_LENGTH_PADDING_X = 6;
export const PHOTO_LENGTH_PADDING_Y = 2;
/** A placeholder's icon while the photo has no picture yet. */
export const PHOTO_PLACEHOLDER_ICON_SIZE = 24;

/**
 * Cards in a message (Figma "Tickets & code", 14 Oct): a grey frame, radius
 * 20 for a ticket and 16 for a pull request or an agent plan, holding a white
 * card 4 inside it (`MessageCardFrame`).
 */
export const MESSAGE_CARD_FRAME_PADDING = 4;
/**
 * Ticket card: the white stub (radius 16, 16 / 14 padding, 12 between rows)
 * is notched with a 6 radius at the middle of each side. Rows: a 22 line of a
 * 16 target, the number and a 22 face; the title (16 on 20, up to two lines);
 * then status, priority and date, 14 apart, each a 14 / 12 mark 6 from its
 * 12 on 16 word.
 */
export const TICKET_CARD_RADIUS = 20;
export const TICKET_STUB_RADIUS = 16;
export const TICKET_STUB_PADDING_X = 16;
export const TICKET_STUB_PADDING_Y = 14;
export const TICKET_STUB_GAP = 12;
export const TICKET_NOTCH_RADIUS = 6;
export const TICKET_NUMBER_ROW_HEIGHT = 22;
export const TICKET_NUMBER_GAP = 8;
export const TICKET_NUMBER_ICON_SIZE = 16;
export const TICKET_ASSIGNEE_SIZE = 22;
export const TICKET_TITLE_LINE_HEIGHT = 20;
export const TICKET_TITLE_MAX_LINES = 2;
export const TICKET_META_LINE_HEIGHT = 16;
export const TICKET_META_GAP = 14;
export const TICKET_META_MARK_GAP = 6;
export const TICKET_STATUS_SIZE = 14;
/** The status ring is 1.6 thick; its fill is 8 across (a half for in progress). */
export const TICKET_STATUS_RING = 1.6;
export const TICKET_STATUS_FILL = 8;
/** Priority: three 3 wide bars, 2 apart, 5, 8 and 12 tall, radius 1. */
export const TICKET_PRIORITY_BAR_WIDTH = 3;
export const TICKET_PRIORITY_BAR_GAP = 2;
export const TICKET_PRIORITY_BAR_HEIGHTS = [5, 8, 12] as const;
export const TICKET_PRIORITY_BAR_RADIUS = 1;
export const TICKET_DATE_ICON_SIZE = 12;
/** Pull request card: radius 16 outside, a 12 white card with 12 padding, the title (16 on 20, up to two lines) 4 above a 12 on 16 line. */
export const PULL_REQUEST_CARD_RADIUS = 16;
export const PULL_REQUEST_INNER_RADIUS = 12;
export const PULL_REQUEST_INNER_PADDING = 12;
export const PULL_REQUEST_INNER_GAP = 4;
export const PULL_REQUEST_TITLE_LINE_HEIGHT = 20;
export const PULL_REQUEST_TITLE_MAX_LINES = 2;
export const PULL_REQUEST_META_LINE_HEIGHT = 16;
/** A code block in the words (Figma "Code / Block", its code part): radius 12, a hairline, 12.5 on 20 mono. */
export const CODE_BLOCK_RADIUS = 12;
export const CODE_BLOCK_PADDING = 12;
export const CODE_BLOCK_FONT_SIZE = 12.5;
export const CODE_BLOCK_LINE_HEIGHT = 20;

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
export const THREAD_STRIP_CHEVRON_SIZE = 16;
export const THREAD_HOOK_RADIUS = 10;
/** Gap between the avatar and where the hook starts. */
export const THREAD_HOOK_TOP_GAP = 6;
/** Figma "Shadow / Row": 0 / 1 blur 2 at 0x0F and 0 / 2 blur 6 at 0x09, #12141C. */
export const ROW_SHADOW =
  '0px 1px 2px 0px rgba(18, 20, 28, 0.06), 0px 2px 6px 0px rgba(18, 20, 28, 0.035)';

/**
 * Typing bar (Figma "Room / Typing bar"): a 42 "+" plate and a 42 field, 8
 * apart and 16 from the sides, with 8 above (a thread's reply bar has 16 above
 * and below). The field pads 16 left, 3 right and 10 above and below a 16 / 22
 * line, and grows to six lines while focused.
 */
export const TYPING_BAR_PADDING_TOP = 8;
export const TYPING_BAR_REPLY_PADDING_Y = 16;
export const TYPING_BAR_LINE_HEIGHT = 22;
export const TYPING_BAR_MAX_LINES = 6;
export const TYPING_BAR_FIELD_PADDING_Y = 10;
export const TYPING_BAR_FIELD_PADDING_LEFT = 16;
export const TYPING_BAR_FIELD_PADDING_RIGHT = 3;
export const TYPING_BAR_FIELD_HEIGHT = TYPING_BAR_FIELD_PADDING_Y * 2 + TYPING_BAR_LINE_HEIGHT;
export const TYPING_BAR_FIELD_RADIUS = TYPING_BAR_FIELD_HEIGHT / 2;
export const TYPING_BAR_PLUS_SIZE = TYPING_BAR_FIELD_HEIGHT;
export const TYPING_BAR_ICON_SIZE = 20;
/** The mic and Send are 36 circles, 3 inside the field's right edge. */
export const TYPING_BAR_MIC_SIZE = 36;
export const TYPING_BAR_SEND_SIZE = 36;
export const TYPING_BAR_SEND_ICON_SIZE = 21.6;
export const TYPING_BAR_STOP_ICON_SIZE = 14;
export const TYPING_BAR_DICTATING_WIDTH = 128;
/**
 * The 36 controls sit on the field's last line, centred on it: on one line
 * that centres them in the 42 field, and on more it keeps them at the bottom
 * edge (Slack, WhatsApp). This is how far each hangs below the line.
 */
export const TYPING_BAR_TRAILING_DROP = (TYPING_BAR_SEND_SIZE - TYPING_BAR_LINE_HEIGHT) / 2;
/** Space the text keeps from the trailing control. */
export const TYPING_BAR_TRAILING_GUTTER = 4;
/** The mic / Send swap: the incoming control grows from 60% as it fades in. */
export const TYPING_BAR_MORPH_MS = 150;
export const TYPING_BAR_MORPH_SCALE = 0.6;

/*
 * Typing bar, focused: the pill opens into a card. The text keeps 16 on both
 * sides, and under it, 8 below the text, a row of 36 tools whose 20 glyphs
 * start on the text's edge, with mic / Send 3 inside the card's bottom right
 * corner as in the pill.
 */
export const TYPING_BAR_CARD_PADDING_BOTTOM = TYPING_BAR_FIELD_PADDING_RIGHT;
export const TYPING_BAR_TOOL_SIZE = 36;
export const TYPING_BAR_TOOL_GAP = 4;
/** Pulls the row left by a button's inner padding, so the first glyph sits on the text's edge. */
export const TYPING_BAR_TOOL_GLYPH_INSET = (TYPING_BAR_TOOL_SIZE - TYPING_BAR_ICON_SIZE) / 2;
/**
 * Stretches a 36 tool's touch area to 44 tall; sideways only to half the gap,
 * so neighbours' touch areas meet rather than overlap.
 */
export const TYPING_BAR_TOOL_HIT_SLOP = {
  top: (44 - TYPING_BAR_TOOL_SIZE) / 2,
  bottom: (44 - TYPING_BAR_TOOL_SIZE) / 2,
  left: TYPING_BAR_TOOL_GAP / 2,
  right: TYPING_BAR_TOOL_GAP / 2,
} as const;
/** The hairline before the formatting strip's close. */
export const TYPING_BAR_FORMAT_DIVIDER_HEIGHT = 20;
/** The strip fades out over its last 16 before mic / Send; its end scrolls clear of the fade. */
export const TYPING_BAR_FORMAT_FADE_WIDTH = 16;
/** Tools ⇄ formatting: the incoming row grows from 96% as it fades in. */
export const TYPING_BAR_TOOLS_SWAP_MS = 150;
export const TYPING_BAR_TOOLS_SWAP_SCALE = 0.96;

/*
 * Typing bar: edit / also send / attachments, in the room's own language:
 * 32 rows over the field, 16 in from the sides like the bar, and 56 tiles
 * inside the field.
 */
/** The "Editing message" strip and the "Also send" row: 32 tall, a 16 icon or 18 check 8 from the words. */
export const TYPING_BAR_STRIP_HEIGHT = 32;
export const TYPING_BAR_STRIP_ICON_SIZE = 16;
export const TYPING_BAR_STRIP_GAP = 8;
/** Stretches a 32 row's touch area to 44. */
export const TYPING_BAR_STRIP_HIT_SLOP = (44 - TYPING_BAR_STRIP_HEIGHT) / 2;
/** The edit strip grows in from 96% as it fades, and goes a little quicker. */
export const TYPING_BAR_STRIP_ENTER_MS = 150;
export const TYPING_BAR_STRIP_EXIT_MS = 120;
export const TYPING_BAR_STRIP_SCALE = 0.96;
/** The "Also send" check: an 18 circle with a 1.5 ring, filled with a 12 tick when on. */
export const TYPING_BAR_CHECK_SIZE = 18;
export const TYPING_BAR_CHECK_BORDER = 1.5;
export const TYPING_BAR_CHECK_ICON_SIZE = 12;
/** Attachment tiles: 56 square, radius 12, 8 apart, 10 below the field's top and 16 from its sides. */
export const TYPING_BAR_ATTACHMENT_SIZE = 56;
export const TYPING_BAR_ATTACHMENT_RADIUS = 12;
export const TYPING_BAR_ATTACHMENT_GAP = 8;
export const TYPING_BAR_ATTACHMENT_PADDING_TOP = 10;
/** A video tile's play badge: a 20 circle, 6 in from the bottom left, with a 10 triangle. */
export const TYPING_BAR_ATTACHMENT_PLAY_SIZE = 20;
export const TYPING_BAR_ATTACHMENT_PLAY_ICON_SIZE = 10;
export const TYPING_BAR_ATTACHMENT_PLAY_INSET = 6;
/** A file chip: 56 tall, 8 / 12 padding, a 20 icon 8 from a name of at most 168. */
export const TYPING_BAR_FILE_CHIP_PADDING_Y = 8;
export const TYPING_BAR_FILE_CHIP_PADDING_X = 12;
export const TYPING_BAR_FILE_CHIP_ICON_SIZE = 20;
export const TYPING_BAR_FILE_CHIP_GAP = 8;
export const TYPING_BAR_FILE_CHIP_NAME_MAX_WIDTH = 168;
/** Remove: a 20 circle hanging 6 past the top right corner, a 12 cross, a 2 ring in the field's colour. */
export const TYPING_BAR_ATTACHMENT_REMOVE_SIZE = 20;
export const TYPING_BAR_ATTACHMENT_REMOVE_OFFSET = 6;
export const TYPING_BAR_ATTACHMENT_REMOVE_ICON_SIZE = 12;
export const TYPING_BAR_ATTACHMENT_REMOVE_RING = 2;
export const TYPING_BAR_ATTACHMENT_REMOVE_HIT_SLOP = (44 - TYPING_BAR_ATTACHMENT_REMOVE_SIZE) / 2;
/** Retry on a failed upload: a 24 circle with a 14 arrow. */
export const TYPING_BAR_ATTACHMENT_RETRY_SIZE = 24;
export const TYPING_BAR_ATTACHMENT_RETRY_ICON_SIZE = 14;
export const TYPING_BAR_ATTACHMENT_RETRY_HIT_SLOP = (44 - TYPING_BAR_ATTACHMENT_RETRY_SIZE) / 2;
/** An uploading or failed tile shows through at half strength. */
export const TYPING_BAR_ATTACHMENT_PENDING_OPACITY = 0.5;

/**
 * The "+" tray (Figma "Plus tray"): a card floating over the screen and the
 * typing bar, radius 36, 8 inside its bottom edge. Figma's tray is 8 wider
 * than the bar on each side, so it hides the "+" and the send button
 * whatever the bottom inset; the room's bar sits 16 in, the tray 8. A 72
 * header (20 above, 16 below, 24 left, 16 right) holds the title and a 36
 * close plate with a 16 icon; under it, cards of rows 10 apart, 10 below the
 * header and 8 from the sides, radius 16 (the last one's bottom corners are
 * concentric with the tray's). A row is at least 54 tall, pads 16 / 11 and
 * puts 14 between a 20 icon, the words (2 apart) and a 16 chevron.
 */
export const PLUS_TRAY_RADIUS = 36;
export const PLUS_TRAY_SIDE_INSET = 8;
/** Above the screen bottom, as the thread card floats (Android keeps clear of its navigation bar). */
export const PLUS_TRAY_BOTTOM_GAP = 22;
/** The least room left above the tray when its rows outgrow the screen and scroll. */
export const PLUS_TRAY_TOP_GAP = 20;
export const PLUS_TRAY_PADDING_BOTTOM = 8;
export const PLUS_TRAY_HEADER_PADDING_TOP = 20;
export const PLUS_TRAY_HEADER_PADDING_BOTTOM = 16;
export const PLUS_TRAY_HEADER_PADDING_LEFT = 24;
export const PLUS_TRAY_HEADER_PADDING_RIGHT = 16;
export const PLUS_TRAY_HEADER_GAP = 8;
export const PLUS_TRAY_CLOSE_SIZE = 36;
export const PLUS_TRAY_CLOSE_ICON_SIZE = 16;
export const PLUS_TRAY_HEADER_HEIGHT =
  PLUS_TRAY_HEADER_PADDING_TOP + PLUS_TRAY_CLOSE_SIZE + PLUS_TRAY_HEADER_PADDING_BOTTOM;
export const PLUS_TRAY_BODY_PADDING_TOP = 10;
export const PLUS_TRAY_BODY_PADDING_X = 8;
export const PLUS_TRAY_SECTION_GAP = 10;
export const PLUS_TRAY_SECTION_RADIUS = 16;
export const PLUS_TRAY_LAST_SECTION_RADIUS = PLUS_TRAY_RADIUS - PLUS_TRAY_PADDING_BOTTOM;
export const PLUS_TRAY_ROW_MIN_HEIGHT = 54;
export const PLUS_TRAY_ROW_PADDING_X = 16;
export const PLUS_TRAY_ROW_PADDING_Y = 11;
export const PLUS_TRAY_ROW_GAP = 14;
export const PLUS_TRAY_ROW_WORDS_GAP = 2;
export const PLUS_TRAY_ICON_SIZE = 20;
export const PLUS_TRAY_CHEVRON_SIZE = 16;
/** The card slides up as the scrim fades in, and back. */
export const PLUS_TRAY_MOTION_MS = 220;
/** A drag down past this distance, or flung faster than this (pt/s), closes the tray. */
export const PLUS_TRAY_DISMISS_DISTANCE = 96;
export const PLUS_TRAY_DISMISS_VELOCITY = 900;
/** How far a drag goes before it moves the tray instead of tapping a row. */
export const PLUS_TRAY_DRAG_ACTIVATION = 8;

/**
 * Schedule tray and scheduled pill (Figma draws neither): the "+" tray's card
 * and rows for the choices; the confirm step's line sits in a section card,
 * 16 around (a row's 54 for one line), over a 48 rounded Schedule button
 * and a 48 Back text button 4 apart. The pill sits 8 above the field, in line
 * with it: 32 tall, 12 in, a 14 clock and chevron 6 from the words.
 */
export const SCHEDULE_TRAY_SUMMARY_PADDING_X = 16;
export const SCHEDULE_TRAY_SUMMARY_PADDING_Y = 16;
export const SCHEDULE_TRAY_BUTTON_HEIGHT = 48;
export const SCHEDULE_TRAY_ACTIONS_GAP = 4;
/** The steps swap by fading and growing in, from a little smaller. */
export const SCHEDULE_TRAY_STEP_MS = 180;
export const SCHEDULE_TRAY_STEP_SCALE = 0.97;
/**
 * Where "Custom…" starts: the next quarter hour at least 15 minutes away, so
 * Continue works at once (the classic starts one minute out, often past by the tap).
 */
export const SCHEDULE_TRAY_CUSTOM_LEAD_MINUTES = 15;
export const SCHEDULE_TRAY_CUSTOM_STEP_MINUTES = 15;
export const SCHEDULED_PILL_HEIGHT = 32;
export const SCHEDULED_PILL_PADDING_X = 12;
export const SCHEDULED_PILL_GAP = 6;
export const SCHEDULED_PILL_ICON_SIZE = 14;
export const SCHEDULED_PILL_MARGIN_BOTTOM = 8;

/**
 * Mentions card: the @ / # suggestions, floating 8 above the typing bar and 16
 * in from its sides (the bar's own padding). Figma draws only the inserted
 * chip, so this is the "+" tray's card language: radius 24, 6 inside, rows at
 * least 54 tall whose 18 highlight is concentric with the card, a 32 face or
 * icon circle 12 from the words. It shows at most four and a half rows (the
 * half row hints at the scroll) and never more than 30% of the space above the
 * keyboard.
 */
/** How long typing must pause before the suggestion count is spoken. */
export const MENTIONS_CARD_ANNOUNCE_DELAY_MS = 600;
export const MENTIONS_CARD_GAP = 8;
export const MENTIONS_CARD_SIDE_INSET = 16;
export const MENTIONS_CARD_RADIUS = 24;
export const MENTIONS_CARD_PADDING = 6;
export const MENTIONS_CARD_ROW_HEIGHT = 54;
export const MENTIONS_CARD_ROW_RADIUS = MENTIONS_CARD_RADIUS - MENTIONS_CARD_PADDING;
export const MENTIONS_CARD_ROW_PADDING_X = 10;
export const MENTIONS_CARD_ROW_GAP = 12;
export const MENTIONS_CARD_LEADING_SIZE = 32;
export const MENTIONS_CARD_ICON_SIZE = 16;
export const MENTIONS_CARD_MAX_ROWS = 4.5;
export const MENTIONS_CARD_MAX_SHARE = 0.3;
/** It rises 8 and grows from 98% as it fades in, and goes quicker than it came. */
export const MENTIONS_CARD_ENTER_MS = 180;
export const MENTIONS_CARD_EXIT_MS = 120;
export const MENTIONS_CARD_ENTER_OFFSET = 8;
export const MENTIONS_CARD_ENTER_SCALE = 0.98;

/** The "You're all caught up" caption sits this far above the typing bar. */
export const CAUGHT_UP_GAP = 8;

/**
 * Jump arrow (Figma "Room / Jump arrow"): a 40 raised circle on "Shadow / Row"
 * with a 20 chevron, 16 from the right and 8 above the typing bar. It fades in
 * from 90% and goes quicker than it came.
 */
export const JUMP_ARROW_SIZE = 40;
export const JUMP_ARROW_ICON_SIZE = 20;
export const JUMP_ARROW_INSET_RIGHT = 16;
export const JUMP_ARROW_GAP = 8;
export const JUMP_ARROW_ENTER_MS = 160;
export const JUMP_ARROW_EXIT_MS = 120;
export const JUMP_ARROW_ENTER_SCALE = 0.9;

/**
 * Swipe a message (Figma "Room / Swipe action"). The drag starts past 12
 * sideways and fails past 8 vertically, so the list's scroll always wins, and
 * never from the 20 nearest the left edge, where the system back gesture lives.
 */
export const SWIPE_ACTIVATION_X = 12;
export const SWIPE_FAIL_Y = 8;
export const SWIPE_EDGE_EXCLUSION = 20;
/** Right = reply in thread: commits once the row has moved 64 (Figma). */
export const SWIPE_REPLY_THRESHOLD = 64;
/**
 * Left = Ask AI, "all the way across": the pill is fully uncovered at its 16
 * inset plus its ~84 width, and it commits 12 past that, the same margin the
 * reply circle keeps (20 + 32 + 12 = 64).
 */
export const SWIPE_ASK_AI_THRESHOLD = 112;
/** Past a threshold the row resists: it starts at this share of the finger and never gains more than the cap. */
export const SWIPE_RUBBER_BAND_FACTOR = 0.55;
export const SWIPE_RUBBER_BAND_MAX = 40;
/** The affordances grow from this scale as they are uncovered. */
export const SWIPE_REVEAL_SCALE = 0.6;
/** How long an affordance takes to change when the drag crosses its threshold. */
export const SWIPE_ARM_MS = 120;
/** The reply circle: 32, 20 from the left, an 18 icon. */
export const SWIPE_REPLY_SIZE = 32;
export const SWIPE_REPLY_INSET_LEFT = 20;
export const SWIPE_REPLY_ICON_SIZE = 18;
/** The Ask AI pill: 36 tall, 10 / 12 padding, 6 between a 16 spark and the label, 16 from the right. */
export const SWIPE_ASK_AI_HEIGHT = 36;
export const SWIPE_ASK_AI_PADDING_LEFT = 10;
export const SWIPE_ASK_AI_PADDING_RIGHT = 12;
export const SWIPE_ASK_AI_GAP = 6;
export const SWIPE_ASK_AI_ICON_SIZE = 16;
export const SWIPE_ASK_AI_INSET_RIGHT = 16;
/** Figma's accent-container-low (#fef1f0) is the accent at 10% over the row. */
export const SWIPE_ASK_AI_TINT_OPACITY = 0.1;

/**
 * Dividers (date, "New"): text line 18 in Figma's 62 row. Figma splits it 32
 * above / 12 below, which with the rows' own 12 reads as 44 over the words and
 * 24 under; split evenly the words sit centred, 34 from the text on each side.
 */
const DIVIDER_LINE_HEIGHT = 18;
export const DIVIDER_PADDING_Y = 22;
export const DIVIDER_HEIGHT = DIVIDER_PADDING_Y * 2 + DIVIDER_LINE_HEIGHT;
/**
 * The date that floats over the list while it scrolls: the
 * divider's words on a raised chip, outlined and shadowed like the thread
 * strip so it reads as above the messages, not cut into them. 12 / 6 padding,
 * 8 from the top of the list.
 */
export const FLOATING_DATE_PADDING_X = 12;
export const FLOATING_DATE_PADDING_Y = 6;
export const FLOATING_DATE_INSET_TOP = 8;

/**
 * Thread card header: 16 top and sides, 36 controls, then 40 before the root
 * message. Faces are 20, each starting 14 past the last.
 */
export const THREAD_HEADER_PADDING_TOP = 16;
export const THREAD_HEADER_PADDING_X = 16;
export const THREAD_HEADER_BUTTON_SIZE = 36;
export const THREAD_HEADER_ICON_SIZE = 16;
const THREAD_HEADER_GAP_BELOW = 40;
export const THREAD_HEADER_HEIGHT =
  THREAD_HEADER_PADDING_TOP + THREAD_HEADER_BUTTON_SIZE + THREAD_HEADER_GAP_BELOW;
export const THREAD_HEADER_AVATAR_SIZE = 20;
export const THREAD_HEADER_AVATAR_OVERLAP = 6;
export const THREAD_HEADER_MAX_AVATARS = 3;
/** Between the header's controls, and between the faces and the title. */
export const THREAD_HEADER_GAP = 8;
/** Keeps the header above the thread list that scrolls under it. */
export const THREAD_HEADER_Z_INDEX = 40;

/**
 * The thread opens as a card over the room (Figma): inset 10 from the sides,
 * 20 under the status bar, ending 26 above the screen bottom, on a 20% scrim.
 */
export const THREAD_CARD_INSET_X = 10;
export const THREAD_CARD_TOP_GAP = 20;
export const THREAD_CARD_BOTTOM = 26;
/**
 * iOS floats the thread card and the "+" tray over the home indicator by
 * design; Android's navigation bar takes taps, so there they end at least this
 * far above it.
 */
export const FLOATING_CARD_NAV_BAR_GAP = 8;
export const THREAD_CARD_RADIUS = 40;
/** The iOS sheet curve (Vaul and Ionic match it): fast out, long settle. */
export const THREAD_CARD_SHEET_EASING = [0.32, 0.72, 0, 1] as const;
export const THREAD_CARD_ENTER_MS = 500;
/**
 * A thread opened to reply focuses its field once the card is in: the sheet
 * entrance (it has no strip to grow from), plus a beat.
 */
export const THREAD_REPLY_FOCUS_DELAY_MS = 560;
/** Closing is quicker than opening: the user is done with it. */
export const THREAD_CARD_EXIT_MS = 300;
/** The scrim fades in this long, whatever the card does. */
export const THREAD_CARD_SCRIM_MS = 220;
/** Drag to close: past this far (or a quarter of the card), or a flick this fast. */
export const THREAD_CARD_DISMISS_DISTANCE = 160;
export const THREAD_CARD_DISMISS_VELOCITY = 900;
/** Dragging up past rest gives at most this much, on a rubber band. */
export const THREAD_CARD_OVERDRAG_LIMIT = 24;
/** A drag starts after this much vertical travel, so header taps still land. */
export const THREAD_CARD_DRAG_SLOP = 8;
/** A sideways move this far first gives the drag up, so horizontal swipes inside still work. */
export const THREAD_CARD_DRAG_FAIL_X = 24;
/** A drag let go short of closing springs back to rest on this. */
export const THREAD_CARD_SETTLE_SPRING = { duration: 380, dampingRatio: 0.9 } as const;
/** Grown from a strip: how long the strip takes to grow into the card, and to shrink back. */
export const THREAD_CARD_MORPH_ENTER_MS = 460;
export const THREAD_CARD_MORPH_EXIT_MS = 380;
/**
 * Morph: the shrink eases in and out, so it neither snaps off the card nor
 * crawls the last stretch into the strip.
 */
export const THREAD_CARD_MORPH_EXIT_EASING = [0.4, 0, 0.2, 1] as const;
/** Morph: the grow waits for the thread's rows, but never longer than this. */
export const THREAD_CARD_MORPH_START_TIMEOUT_MS = 300;

/** Morph: the share of the grow over which the card fades in over the strip. */
export const THREAD_CARD_MORPH_FADE_SHARE = 0.2;
/**
 * Morph: the thread inside shows from this point of the grow, over the span
 * after it (and goes the same way on the shrink), well before the card fades.
 */
export const THREAD_CARD_MORPH_CONTENT_FROM = 0.3;
export const THREAD_CARD_MORPH_CONTENT_SPAN = 0.3;
/** Morph: a strip tapped longer ago than this is not where the card came from. */
export const THREAD_CARD_SOURCE_MAX_AGE_MS = 2000;

/**
 * A thread of at most this many rows (parent, divider, replies, date rows)
 * opens at its parent and reads down from the top; a longer one opens at its
 * latest reply. Roughly what fits in the card.
 */
export const THREAD_CARD_START_AT_TOP_MAX_ROWS = 8;
/** The 20% black behind the thread card and the "+" tray. */
export const SCRIM_COLOR = 'rgba(0, 0, 0, 0.2)';
/**
 * Figma "Shadow / Tray": #12141C at 26%, 0 / 18, blur 50. The thread card, the
 * "+" tray, the hold menu's reaction bar and its action card all float on it.
 */
export const TRAY_SHADOW = {
  shadowColor: '#12141C',
  shadowOpacity: 0.26,
  shadowOffset: { width: 0, height: 18 },
  shadowRadius: 50,
  elevation: 24,
} as const;

/** The horizontal inset the thread list puts around every row. */
export const THREAD_LIST_INSET = 12;
/**
 * The room and thread lists keep rows drawn this far past each edge (about a
 * screen), so a hard fling lands on rows, not blank space. Opening stays cheap:
 * LegendList draws only the visible rows first and widens to this once ready.
 */
export const CONVERSATION_LIST_DRAW_DISTANCE = 1000;

/** The rule under the thread's root message: 1 thick, inset 16, 12 above and below. */
export const REPLY_RULE_THICKNESS = 1;
export const REPLY_RULE_INSET_X = 16;
export const REPLY_RULE_MARGIN_Y = 12;

/**
 * Hold menu (Figma "Hold a message"): a reaction rail above the lifted
 * message and an action card below it, both inset 11 from the screen edges,
 * all three with radius 20. Rows are a fixed height so the card's height is
 * known without measuring, which the placement math relies on.
 */
export const HOLD_EDGE_INSET = 8;
export const HOLD_SIDE_INSET = 11;
export const HOLD_BLOCK_GAP = 8;
export const HOLD_RADIUS = 20;
export const HOLD_RAIL_HEIGHT = 54;
export const HOLD_RAIL_PADDING = 5;
export const HOLD_REACTION_SIZE = 44;
export const HOLD_REACTION_EMOJI_SIZE = 22;
export const HOLD_MORE_SIZE = 36;
export const HOLD_MORE_ICON_SIZE = 18;
export const HOLD_MENU_PADDING = 8;
export const HOLD_MENU_ROW_HEIGHT = 46;
export const HOLD_MENU_ROW_PADDING_X = 10;
export const HOLD_MENU_ROW_RADIUS = 12;
export const HOLD_MENU_ROW_GAP = 12;
export const HOLD_MENU_ICON_SIZE = 20;
/** The lifted message: 0 / 6 blur 18 at 10% and 0 / 1 blur 3 at 5%, #12141C. */
export const HOLD_CARD_SHADOW =
  '0px 6px 18px 0px rgba(18, 20, 28, 0.10), 0px 1px 3px 0px rgba(18, 20, 28, 0.05)';
/** The lifted message may take at most this share of the free height. */
export const HOLD_MAX_CARD_SHARE = 0.4;
/** A scrolling menu never shrinks below this many rows. */
export const HOLD_MIN_MENU_ROWS = 3;
/** With reduced motion the menu fades in this quickly instead of rising into place. */
export const HOLD_REDUCED_MOTION_MS = 80;
/** The rail rises this far into place and the menu drops it, each growing from its start scale. */
export const HOLD_ENTER_OFFSET = 10;
export const HOLD_RAIL_ENTER_SCALE = 0.92;
export const HOLD_MENU_ENTER_SCALE = 0.96;
/** Focus moves to the first item this long after the enter animation ends. */
export const HOLD_FOCUS_SETTLE_MS = 50;
/** Android draws the menu in the screen's own window, so it must out-stack the headers and composer. */
export const HOLD_ANDROID_Z_INDEX = 11000;

/**
 * Channel info (Figma "9 · Channel info"): a back-only bar (8 / 4 padding, a
 * 36 button), then the details 16 from the sides: a 60 tile (radius 20) and
 * the name block 4 apart with 8 more under the tile, a row of action plates
 * (radius 16, 12 / 4 padding, 6 between a 20 icon and the 12 label, 8 apart),
 * then titled cards inset 4 more (radius 12, 48 rows padded 12, 12 between a
 * 20 icon, the label and a 16 chevron, hairlines between rows).
 */
export const CHANNEL_INFO_BAR_PADDING_X = 8;
export const CHANNEL_INFO_BAR_PADDING_Y = 4;
export const CHANNEL_INFO_PADDING_X = 16;
export const CHANNEL_INFO_PADDING_TOP = 33;
export const CHANNEL_INFO_PADDING_BOTTOM = 24;
export const CHANNEL_INFO_TILE_SIZE = 60;
export const CHANNEL_INFO_TILE_RADIUS = 20;
export const CHANNEL_INFO_TILE_ICON_SIZE = 26;
export const CHANNEL_INFO_NAME_GAP = 4;
/** The extra space between the tile and the name. */
export const CHANNEL_INFO_TILE_GAP = 8;
/** The presence dot on a person's face: 14 with a 2 ring in the screen colour. */
export const CHANNEL_INFO_PRESENCE_SIZE = 14;
export const CHANNEL_INFO_PRESENCE_RING = 2;
export const CHANNEL_INFO_STATUS_EMOJI_SIZE = 16;
export const CHANNEL_INFO_ACTIONS_PADDING_TOP = 18;
export const CHANNEL_INFO_ACTION_GAP = 8;
export const CHANNEL_INFO_ACTION_RADIUS = 16;
export const CHANNEL_INFO_ACTION_PADDING_X = 4;
export const CHANNEL_INFO_ACTION_PADDING_Y = 12;
export const CHANNEL_INFO_ACTION_INNER_GAP = 6;
export const CHANNEL_INFO_ACTION_ICON_SIZE = 20;
/** The Call plate's chevron, 2 after its label. */
export const CHANNEL_INFO_ACTION_CHEVRON_SIZE = 12;
export const CHANNEL_INFO_ACTION_CHEVRON_GAP = 2;
/** Figma steps 14–24 between groups; one even 20 reads as the same rhythm. */
export const CHANNEL_INFO_GROUP_GAP = 20;
export const CHANNEL_INFO_GROUP_INSET_X = 4;
export const CHANNEL_INFO_GROUP_TITLE_GAP = 8;
export const CHANNEL_INFO_CARD_RADIUS = 12;
export const CHANNEL_INFO_ROW_HEIGHT = 48;
export const CHANNEL_INFO_ROW_PADDING_X = 12;
export const CHANNEL_INFO_ROW_GAP = 12;
export const CHANNEL_INFO_ROW_ICON_SIZE = 20;
export const CHANNEL_INFO_ROW_CHEVRON_SIZE = 16;
/** Members row: 28 faces, each 6 into the last, at most three. */
export const CHANNEL_INFO_FACE_SIZE = 28;
export const CHANNEL_INFO_FACE_OVERLAP = 6;
export const CHANNEL_INFO_MAX_FACES = 3;

/**
 * Agent plan card (Figma "Room / Plan card", 27 Oct): the message card frame's
 * 4 rim of surface (radius 16) round a panel (radius 12). The panel's top pads 11 / 12 / 2,
 * 10 between the title and the tag; its steps pad 7 / 12 / 12, 1 apart, each
 * 5 above and below a 16 mark (2 down, 12 tick) 9 from its Body/Small words.
 * The note under the panel pads 9 / 11 / 6. The tag pads 8 / 2, radius 6.
 */
export const PLAN_CARD_RADIUS = 16;
export const PLAN_PANEL_RADIUS = 12;
export const PLAN_PADDING_X = 12;
export const PLAN_TOP_PADDING_TOP = 11;
export const PLAN_TOP_PADDING_BOTTOM = 2;
/** A folded panel is its top alone, so it closes with the top's own 11 for even padding. */
export const PLAN_FOLDED_PADDING_BOTTOM = PLAN_TOP_PADDING_TOP;
export const PLAN_TOP_GAP = 10;
export const PLAN_STEPS_PADDING_TOP = 7;
export const PLAN_STEPS_PADDING_BOTTOM = 12;
export const PLAN_STEP_GAP = 1;
export const PLAN_STEP_PADDING_Y = 5;
export const PLAN_STEP_MARK_GAP = 9;
export const PLAN_MARK_SIZE = 16;
export const PLAN_MARK_TOP = 2;
export const PLAN_MARK_ICON_SIZE = 12;
/** An open step's ring, and the dot inside the running one. */
export const PLAN_MARK_RING = 1.5;
export const PLAN_MARK_DOT_SIZE = 6;
export const PLAN_TAG_RADIUS = 6;
export const PLAN_TAG_PADDING_X = 8;
export const PLAN_TAG_PADDING_Y = 2;
export const PLAN_NOTE_PADDING_TOP = 9;
export const PLAN_NOTE_PADDING_BOTTOM = 6;
export const PLAN_NOTE_PADDING_X = 11;
/** The fold chevron that ends the note. */
export const PLAN_FOLD_ICON_SIZE = 16;

/**
 * Room states Figma does not draw (nothing yet, loading, failed), set in the
 * room's type: a Title line, Body/Small 4 under it, and a 36 surface pill 16
 * below for a retry, centred in the list's own overlay. Skeleton rows are
 * message rows (32 face, 12 to the body) of 12 bars, each centred on a 22
 * body line, pulsing to 55% unless motion is reduced.
 */
export const ROOM_NOTICE_GAP = 4;
export const ROOM_NOTICE_ACTION_GAP = 16;
export const ROOM_NOTICE_ACTION_HEIGHT = 36;
export const ROOM_NOTICE_ACTION_PADDING_X = 16;
export const ROOM_SKELETON_BAR_HEIGHT = 12;
export const ROOM_SKELETON_NAME_WIDTH = 96;
export const ROOM_SKELETON_PULSE_MS = 800;
export const ROOM_SKELETON_PULSE_OPACITY = 0.55;

/**
 * Offline banner over the typing bar: the bar's 16 sides, radius 12, 12 / 8
 * padding, 8 between a 16 icon and the Body/Small words, 8 under it.
 */
export const OFFLINE_BANNER_INSET_X = 16;
export const OFFLINE_BANNER_RADIUS = 12;
export const OFFLINE_BANNER_PADDING_X = 12;
export const OFFLINE_BANNER_PADDING_Y = 8;
export const OFFLINE_BANNER_GAP = 8;
export const OFFLINE_BANNER_ICON_SIZE = 16;
export const OFFLINE_BANNER_MARGIN_BOTTOM = 8;
/** Reconnect is a text button, so its touch area reaches this far past its words. */
export const OFFLINE_BANNER_HIT_SLOP = 8;

/**
 * Parked threads (Figma "Bubbles · park a thread"): a 58 bubble, radius 20,
 * landing 14 from the right edge and 120 from the top; letting go snaps it 14
 * from the nearer side.
 */
export const BUBBLE_SIZE = 58;
export const BUBBLE_RADIUS = 20;
export const BUBBLE_EDGE_INSET = 14;
/** Where a first bubble lands: below the screen headers and Activity's filter chips. */
export const BUBBLE_LAND_TOP = 200;
/** Settled low, it stays this far above the screen bottom, clear of the typing bar. */
export const BUBBLE_BOTTOM_CLEARANCE = 112;
/** With the keyboard up, the bubble keeps this far above it, clear of the composer. */
export const BUBBLE_KEYBOARD_CLEARANCE = 72;
/** Figma "Shadow / Float": 0 / 1 blur 3 at 7% and 0 / 6 blur 18 at 10%, #12141C. */
export const BUBBLE_SHADOW =
  '0px 1px 3px 0px rgba(18, 20, 28, 0.07), 0px 6px 18px 0px rgba(18, 20, 28, 0.1)';
/** Its settle and its snap to a side. */
export const BUBBLE_SPRING = { damping: 24, stiffness: 260 } as const;
/** A fling adds this many seconds of its speed before the nearer side is picked. */
export const BUBBLE_FLING_PROJECTION = 0.1;
/** Held this long, the close target appears without a drag. */
export const BUBBLE_HOLD_MS = 380;
/** A second tap this soon after opening a thread does nothing, so two cards never stack. */
export const BUBBLE_OPEN_GUARD_MS = 800;
/** Pushed this far past a side edge, it tucks away into a tab. */
export const BUBBLE_TUCK_DISTANCE = 36;
/** Each card behind sits 10 further along than the one ahead; at most six trail a drag. */
export const BUBBLE_BEHIND_STEP = 10;
export const BUBBLE_BEHIND_MAX = 6;
/** Figma "Bubble / Behind" by depth (inset in the 58 box, corner, opacity); deeper cards keep the last. */
export const BUBBLE_BEHIND_DEPTHS = [
  { inset: 3, radius: 18, opacity: 0.78 },
  { inset: 6, radius: 16, opacity: 0.5 },
  { inset: 9, radius: 14, opacity: 0.32 },
] as const;
/** The share of its gap a trailing card closes each 60 Hz frame. */
export const BUBBLE_TRAIL_FOLLOW = 0.35;
/** The bubble moved less than this since the last frame: it is at rest, and the trail may stop. */
export const BUBBLE_HEAD_STILL = 0.05;
/** Cards behind fade out and back as a drag starts and ends. */
export const BUBBLE_FOLD_MS = 180;
/** "Working": a 29 x 20 plate, radius 10, on the bottom-left corner; three 3 dots, 2 apart, stepping. */
export const BUBBLE_WORKING_LEFT = -4;
export const BUBBLE_WORKING_TOP = 42;
export const BUBBLE_WORKING_RADIUS = 10;
export const BUBBLE_WORKING_PADDING_X = 8;
export const BUBBLE_WORKING_PADDING_Y = 8.5;
export const BUBBLE_WORKING_DOT = 3;
export const BUBBLE_WORKING_DOT_GAP = 2;
export const BUBBLE_WORKING_STEP_MS = 300;
/** The plate's shadow: 0 / 2 blur 6 at 4% and 0 / 1 blur 2 at 6%, #12141C. */
export const BUBBLE_WORKING_SHADOW =
  '0px 2px 6px 0px rgba(18, 20, 28, 0.04), 0px 1px 2px 0px rgba(18, 20, 28, 0.06)';
/** A dimmed dot's opacity between its steps. */
export const BUBBLE_WORKING_DIM = 0.35;
/** "Answered": a 14 dot with a 1.5 ring in the background colour, top right. */
export const BUBBLE_READY_SIZE = 14;
export const BUBBLE_READY_RING = 1.5;
export const BUBBLE_READY_LEFT = 46;
export const BUBBLE_READY_TOP = -2;
/** The "+N" tile in the last face slot. */
export const BUBBLE_MORE_RADIUS = 7;
/**
 * The list (Figma "Bubble / List row"): 320 x 56 pills, radius 28, padding 11
 * / 10, 12 between a 34 face tile, the words and a 26 remove box with a 16
 * cross; 8 apart, starting 8 past the bubble, with "Clear all" (40, padding 16) last.
 */
export const BUBBLE_LIST_ROW_WIDTH = 320;
export const BUBBLE_LIST_ROW_HEIGHT = 56;
export const BUBBLE_LIST_ROW_PADDING_LEFT = 11;
export const BUBBLE_LIST_ROW_PADDING_RIGHT = 10;
export const BUBBLE_LIST_ROW_GAP = 12;
export const BUBBLE_LIST_TILE_SIZE = 34;
export const BUBBLE_LIST_REMOVE_SIZE = 26;
export const BUBBLE_LIST_ICON_SIZE = 16;
export const BUBBLE_LIST_GAP = 8;
export const BUBBLE_CLEAR_ALL_HEIGHT = 40;
export const BUBBLE_CLEAR_ALL_PADDING_X = 16;
/**
 * Room the scrolling rows keep at their sides for the float shadow (blur 18),
 * which the scroll view would otherwise clip.
 */
export const BUBBLE_LIST_SHADOW_ROOM = 24;
export const BUBBLE_LIST_ENTER_MS = 180;
export const BUBBLE_LIST_EXIT_MS = 120;
export const BUBBLE_LIST_ENTER_SCALE = 0.96;
/** A newly parked bubble pops in from this scale where it lands. */
export const BUBBLE_POP_SCALE = 0.6;
/** The edge tab (Figma "Bubble / Edge tab"): 22 x 64 glass, outer corners 12, a 16 chevron. */
export const BUBBLE_TAB_WIDTH = 22;
export const BUBBLE_TAB_HEIGHT = 64;
export const BUBBLE_TAB_RADIUS = 12;
export const BUBBLE_TAB_ICON_SIZE = 16;
export const BUBBLE_TAB_GLASS_OPACITY = 0.36;
/** Pulled this far off its edge, the tab lets the bubble back out. */
export const BUBBLE_TAB_PULL_DISTANCE = 24;
/**
 * The close target (Figma "Bubble / Close target"): 40 tall glass, padding 18,
 * 6 between a 16 cross and "Close", 34 above the bottom; red and a little
 * bigger with the bubble over it, which counts within 24 of its edge.
 */
export const BUBBLE_CLOSE_HEIGHT = 40;
export const BUBBLE_CLOSE_PADDING_X = 18;
export const BUBBLE_CLOSE_GAP = 6;
export const BUBBLE_CLOSE_ICON_SIZE = 16;
export const BUBBLE_CLOSE_BOTTOM = 34;
export const BUBBLE_CLOSE_SLOP = 24;
/**
 * Above the target the zone reaches further: a bubble let go just over the tab
 * bar or the composer means Close, not a snap back to the side.
 */
export const BUBBLE_CLOSE_REACH_ABOVE = 72;
export const BUBBLE_CLOSE_OVER_SCALE = 1.1;
export const BUBBLE_CLOSE_GLASS_OPACITY = 0.5;
export const BUBBLE_CLOSE_OVER_OPACITY = 0.78;
/** How strongly the page blurs under the tab and the close target. */
export const BUBBLE_GLASS_BLUR = 20;
/**
 * The answer toast (Figma "Bubble / Answer toast"): 48 tall, radius 24,
 * padding 8, gap 10, 10 from each side under the status bar; 28 faces cut 9
 * into each other, a 36 open plate with a 16 chevron. It lifts after 6 s.
 */
export const BUBBLE_TOAST_HEIGHT = 48;
export const BUBBLE_TOAST_PADDING_X = 8;
export const BUBBLE_TOAST_GAP = 10;
export const BUBBLE_TOAST_INSET_X = 10;
export const BUBBLE_TOAST_TOP_GAP = 4;
export const BUBBLE_TOAST_FACE_SIZE = 28;
export const BUBBLE_TOAST_FACE_OVERLAP = 9;
export const BUBBLE_TOAST_OPEN_SIZE = 36;
export const BUBBLE_TOAST_ICON_SIZE = 16;
export const BUBBLE_TOAST_LINGER_MS = 6000;
export const BUBBLE_TOAST_ENTER_MS = 220;
export const BUBBLE_TOAST_EXIT_MS = 160;
export const BUBBLE_TOAST_ENTER_OFFSET = -16;
/** The glow behind the toast, agents only: three blurred ellipses at 35% (Figma "Glow · agents only"). */
export const BUBBLE_TOAST_GLOW_COLORS = ['#673D9E', '#1A73E8', '#C2610C'] as const;
export const BUBBLE_TOAST_GLOW_OPACITY = 0.35;
/** The glow spreads this far past the toast's sides and below it. */
export const BUBBLE_TOAST_GLOW_SPREAD = 14;
/** Where each glow ellipse sits across the toast, and its radius, as shares of its width (Figma). */
export const BUBBLE_TOAST_GLOW_CENTRES = [0.23, 0.52, 0.78] as const;
export const BUBBLE_TOAST_GLOW_RADIUS_SHARE = 0.2;

/**
 * Shared press feedback: a pressed row fades to this, as the message rows do.
 * Every pressable row in the conversation uses it.
 */
export const PRESSED_OPACITY = 0.7;
/** How long a press is held before it counts as a hold, on a message row and the cards in it. */
export const LONG_PRESS_DELAY_MS = 300;

/** Your own face is your initials on the identity colour, 12 on the 32 face and scaled with it elsewhere. */
export const SELF_FACE_INITIALS_SHARE = 12 / MESSAGE_AVATAR_SIZE;
