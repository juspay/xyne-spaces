export const COLLABORATIVE_CANVAS_BETA_CHANNELS: readonly string[] = ['canvas-test'] as const;

export function isBetaCanvasChannel(channelName: string | undefined | null): boolean {
  if (!channelName) return false;
  return COLLABORATIVE_CANVAS_BETA_CHANNELS.includes(channelName);
}
