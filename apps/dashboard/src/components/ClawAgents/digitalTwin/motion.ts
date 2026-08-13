/**
 * Programmatic Digital Twin motion primitives. Keep these values aligned with
 * the CSS custom properties in `digital-twin-motion.css`.
 */
export const DIGITAL_TWIN_EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const DIGITAL_TWIN_EASE_IN = [0.7, 0, 0.84, 0] as const;
export const DIGITAL_TWIN_EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

export const DIGITAL_TWIN_MOTION = {
  press: 0.12,
  feedback: 0.18,
  state: 0.24,
  layout: 0.3,
  route: 0.34,
  entrance: 0.42,
} as const;

/** Cap choreography so long result sets never feel slow. */
export const digitalTwinStaggerDelay = (index: number): number =>
  Math.min(Math.max(index, 0), 6) * 0.035;
