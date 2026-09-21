/**
 * Placeholder slot resolution for the canvas editors.
 *
 * BlockNote exposes two distinct placeholder slots:
 *  - `emptyDocument` renders only while the document is a single empty block.
 *  - `default` renders on ANY focused empty block, including after the document
 *    already has content.
 *
 * Assigning one string to both makes an onboarding hint reappear on every new
 * line, so the two slots are resolved independently here.
 *
 * Kept in its own module, free of BlockNote imports, so the fallback matrix is
 * unit-testable without mounting an editor.
 */

export const DEFAULT_CANVAS_PLACEHOLDER = "Write something, or press '/' for commands";

export interface CanvasPlaceholderSlots {
  /** Shown on a focused empty block, including once the document has content. */
  default: string;
  /** Shown only while the whole document is a single empty block. */
  emptyDocument: string;
}

/**
 * Resolve the two slots from the editor props.
 *
 * - Neither prop: the generic canvas hint in both slots.
 * - `placeholder` only: that string in both slots — the behaviour callers had
 *   before the slots were split, so untouched call sites are unchanged.
 * - `blockPlaceholder` only: it applies to focused empty blocks while the empty
 *   document keeps the generic hint.
 * - Both: each slot takes its own string. Pass `blockPlaceholder: ''` to show
 *   nothing once the user has typed anything — BlockNote attaches the
 *   decoration but an empty string renders no text.
 */
export const resolveCanvasPlaceholders = (
  placeholder?: string,
  blockPlaceholder?: string,
): CanvasPlaceholderSlots => ({
  default: blockPlaceholder ?? placeholder ?? DEFAULT_CANVAS_PLACEHOLDER,
  emptyDocument: placeholder ?? DEFAULT_CANVAS_PLACEHOLDER,
});
