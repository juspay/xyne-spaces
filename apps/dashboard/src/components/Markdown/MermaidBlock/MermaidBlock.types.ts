export interface MermaidBlockProps {
  chart: string;
  messageId?: string;
  controlsOnHover?: boolean;
  /** Shows an Edit control; the caller reveals its own editable source. */
  onEdit?: () => void;
  /** Shows a Delete control. Only a diagram that lives in a document — a canvas
   *  block — can be removed; one rendered inside a chat message cannot. */
  onDelete?: () => void;
  /**
   * Whether clicking the diagram opens the enlarged preview. False where the
   * click means "select this block" instead, which moves the preview onto its
   * own toolbar button.
   */
  previewOnClick?: boolean;
}

export type ViewMode = 'diagram' | 'code';
