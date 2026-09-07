/** Not `canvasId`: SDLC stamps that on message mentions too. */
export function isCanvasActivity(activity: { actionSource?: string | null }): boolean {
  return activity.actionSource === 'canvas' || activity.actionSource === 'canvas_comment';
}
