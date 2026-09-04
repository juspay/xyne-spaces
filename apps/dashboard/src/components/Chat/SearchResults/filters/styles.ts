/**
 * Shared Tailwind class strings for the search filter bar and its modal.
 *
 * Constants rather than a `.css` file on purpose: these are Tailwind utility strings that
 * `cn()` composes with per-instance classes, so they have to stay in TS to keep the
 * conditional variants (`CHIP_ACTIVE`, hover/focus states) type-checked and purgeable —
 * Tailwind only emits classes it can see in source.
 */

export const CHIP_BASE =
  'rounded-lg h-6 px-2 text-xs font-medium gap-1.5 border-border hover:bg-muted whitespace-nowrap data-[state=open]:ring-0 data-[state=open]:outline-none';

export const CHIP_ACTIVE =
  'border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground';

export const POPOVER_CONTENT = 'z-[60] bg-popover border border-border rounded-lg shadow-md';

/** One row in a dropdown menu. Shared with the bar's From/In popovers. */
export const MENU_ITEM =
  'flex w-full items-center gap-2 px-3 py-1.5 text-sm rounded text-left focus:outline-none';

export const FIELD_LABEL = 'block pb-1.5 text-sm font-semibold';

// .fbox — 36px tall, 6px radius, borders brighten on hover. Wraps so tokens can stack.
export const FIELD_BOX =
  'flex w-full flex-wrap items-center gap-1.5 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm text-foreground min-h-9 box-border text-left transition-colors hover:border-muted-foreground focus-within:border-primary';

// .selbox — a select is one line with the chevron pushed right, so it must not wrap.
export const SELECT_BOX = 'flex-nowrap justify-between';

export const BARE_INPUT =
  'min-w-[120px] flex-1 bg-transparent outline-none placeholder:text-muted-foreground';

// .tok
export const TOKEN =
  'inline-flex max-w-full items-center gap-1.5 rounded bg-muted px-1.5 py-0.5 text-[13px] text-foreground';

// .fmenu — anchored under its field rather than a page-level popover.
export const FIELD_MENU =
  'absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-[212px] overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md';

// Checks sit in a 2-col grid (design: `grid-template-columns:repeat(2,1fr); gap:2px 16px`).
// Checkbox labels sit at the same 14px as field values — the size presets are 12px/13px,
// which read as a different scale inside the form.
export const CHECK_LABEL = 'text-sm text-foreground';

export const CHECK_GRID = 'grid grid-cols-2 gap-x-4 gap-y-0.5 pt-0.5';

export const MENU_ROW =
  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted focus:outline-none';

export const SUGGESTIONS =
  'mt-1 max-h-40 overflow-y-auto rounded-md border border-border bg-popover';
