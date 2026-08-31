import type { ToolExecutionContext, UiWidget } from "./types.js";
import { uiWidgetValidationError } from "../types/ui-widget.js";

/**
 * Transport-neutral publishing entry point for tool-authored UI widgets.
 * Future widget tools should call this helper instead of POSTing progress
 * endpoints or branching on SSE themselves.
 *
 * Validates before dispatch. The renderer's zod schema runs at the Spaces
 * postMessage boundary — several hops downstream, after the tool has already
 * returned — so a widget that fails there is dropped with nothing reported back
 * to the model. Throwing here turns that silent drop into a tool error the
 * model can read and correct on the next turn.
 */
export async function publishUiWidget(
  context: ToolExecutionContext | undefined,
  widget: UiWidget,
): Promise<void> {
  const invalid = uiWidgetValidationError(widget);
  if (invalid) {
    throw new Error(`Invalid ${widget?.type ?? "unknown"} widget: ${invalid}`);
  }
  if (!context?.emitUiWidget) {
    throw new Error("UI widget delivery is unavailable for this run");
  }
  await context.emitUiWidget(widget);
}
