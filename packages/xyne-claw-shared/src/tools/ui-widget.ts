import type { ToolExecutionContext, UiWidget } from "./types.js";

/**
 * Transport-neutral publishing entry point for tool-authored UI widgets.
 * Future widget tools should call this helper instead of POSTing progress
 * endpoints or branching on SSE themselves.
 */
export async function publishUiWidget(
  context: ToolExecutionContext | undefined,
  widget: UiWidget,
): Promise<void> {
  if (!context?.emitUiWidget) {
    throw new Error("UI widget delivery is unavailable for this run");
  }
  await context.emitUiWidget(widget);
}
