/**
 * Shared look for a card inside a browse dialog.
 *
 * The border is always rendered — transparent when unselected — so picking a
 * card tints it without nudging the layout by the border's width. Colours come
 * from `--status-success` at the same 12% / 30% mix the success Pill uses.
 */
export const BROWSE_CARD =
  'flex w-full flex-col items-start justify-center gap-2 overflow-hidden rounded-[10px] border-[0.8px] border-transparent p-4 text-left transition-colors';

export const BROWSE_CARD_SELECTED =
  'border-[color-mix(in_srgb,var(--status-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--status-success)_12%,transparent)]';

export const BROWSE_CARD_IDLE = 'hover:bg-muted/50';
