export const MESSAGE_BAR_ACTION_IDS = [
  'reply',
  'createTicket',
  'createSubTicket',
  'call',
  'notes',
  'askAI',
  'edit',
  'sendToChannel',
  'markUnread',
  'bookmark',
  'pin',
  'copyLink',
  'copyMessage',
  'forward',
] as const;

export type MessageBarActionId = (typeof MESSAGE_BAR_ACTION_IDS)[number];

export const MESSAGE_MENU_LEAD_IDS: readonly MessageBarActionId[] = [
  'reply',
  'askAI',
  'call',
  'notes',
  'createTicket',
  'createSubTicket',
];
export const MESSAGE_MENU_EDIT_IDS: readonly MessageBarActionId[] = ['edit', 'sendToChannel'];
export const MESSAGE_MENU_COPY_IDS: readonly MessageBarActionId[] = [
  'copyLink',
  'copyMessage',
  'forward',
];

export const BAR_TILE_SIZE = 28;
export const BAR_TILE_GLYPH_INSET = 6;
export const BAR_TILE_LIFT = 1.08;
export const BAR_HIDE_SCALE = 0.9;
export const BAR_MAX_TILT = 8;
export const BAR_DROP_REACH = 28;

export const BAR_SOCKET_CLASS =
  'pointer-events-none absolute inset-0 rounded-md border-[1.5px] border-dashed border-foreground/15 bg-foreground/[0.02] opacity-0';
export const BAR_SLOT_CLASS =
  'absolute inset-0 rounded-sm border-[1.5px] border-dashed border-foreground/15 bg-foreground/[0.02]';
export const BAR_PREVIEW_SLOT_CLASS = 'flex size-7 shrink-0 items-center justify-center';
export const BAR_PREVIEW_ICON_SLOT_CLASS = `${BAR_PREVIEW_SLOT_CLASS} text-muted-foreground`;
