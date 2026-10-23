export const DRAG_THRESHOLD = 4;
export const DRAG_SHIFT_MS = 250;
export const DRAG_REDUCED_SHIFT_MS = 120;
export const DRAG_ROW_LIFT = 1.02;
export const DRAG_ABSORB_SCALE = 0.8;
export const DRAG_TILT_VELOCITY = 1600;
export const DRAG_TILT_SPRING = { stiffness: 320, damping: 24, mass: 0.6 } as const;
export const DRAG_EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
export const DRAG_EASE_OUT_CURVE = [0.23, 1, 0.32, 1] as const;
export const DRAG_CURSOR_CSS = '*{cursor:grabbing!important;user-select:none!important}';

export const DRAG_MORPH_SPRING = { type: 'spring', duration: 0.3, bounce: 0 } as const;
export const DRAG_SCALE_SPRING = { type: 'spring', duration: 0.3, bounce: 0.2 } as const;
export const DRAG_SNAP_SPRING = { type: 'spring', duration: 0.35, bounce: 0 } as const;
export const DRAG_LANDING_SPRING = { type: 'spring', duration: 0.35, bounce: 0.15 } as const;
export const DRAG_ABSORB_SPRING = { type: 'spring', duration: 0.28, bounce: 0 } as const;
export const DRAG_FLY_SPRING = { type: 'spring', duration: 0.35, bounce: 0.12 } as const;

export const DRAG_LIFTED_SHADOW_CLASS =
  'shadow-[0_0_0_1px_hsl(var(--foreground)/0.06),0_2px_4px_-1px_rgb(0_0_0/0.08),0_10px_20px_-6px_rgb(0_0_0/0.2),0_24px_48px_-12px_rgb(0_0_0/0.24)]';
export const DRAG_HINT_CLASS =
  'absolute whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md';
