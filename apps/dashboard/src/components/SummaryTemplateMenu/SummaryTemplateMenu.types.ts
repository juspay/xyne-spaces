export interface SummaryTemplateOption {
  id: string;
  name: string;
  icon: string;
}

export interface SummaryTemplateMenuProps {
  /** Template the summary was written with. Absent means the built-in default. */
  selectedTemplate?: SummaryTemplateOption | undefined;
  templates: SummaryTemplateOption[];
  /** Swaps the template list for a loading line. */
  isLoading?: boolean | undefined;
  /** Spins the refresh icon and blocks the action while a regeneration is in flight. */
  isRegenerating?: boolean | undefined;
  /** False when there is nothing to regenerate with; disables the refresh action. */
  canRegenerate?: boolean | undefined;
  onSelectTemplate: (templateId: string) => void;
  onRegenerate: () => void;
  onOpenTemplates: () => void;
  onNewTemplate: () => void;
  /**
   * Closes the host's popover. Called before every action so each host keeps
   * ownership of its own open state.
   */
  onRequestClose: () => void;
  /** Analytics category of the host screen, e.g. `RecordingDetailV2`. */
  trackCategory: string;
}
