export const PILL = { width: 120, height: 44 } as const;
export const PANEL = { width: 420, height: 600 } as const;

export const RADIUS = 14;

export const CORNER_RADII = {
  borderTopLeftRadius: RADIUS,
  borderTopRightRadius: 0,
  borderBottomRightRadius: 0,
  borderBottomLeftRadius: RADIUS,
} as const;

export const CLAW_AGENTS_STALE_TIME_MS = 60_000;
