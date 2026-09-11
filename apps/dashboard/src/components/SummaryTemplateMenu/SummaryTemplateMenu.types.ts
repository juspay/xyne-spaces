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
  /** Shows pending state and blocks actions while a regeneration is in flight. */
  isRegenerating?: boolean | undefined;
  /** Template currently being regenerated, which may differ from the rendered summary. */
  regeneratingTemplateId?: string | undefined;
  /** False when there is nothing to regenerate with; disables the refresh action. */
  canRegenerate?: boolean | undefined;
  onSelectTemplate: (templateId: string) => void;
  onRegenerate: () => void;
  onOpenTemplates: () => void;
  onNewTemplate: () => void;
  /** Closes the host's popover before menu actions. */
  onRequestClose: () => void;
  /** Analytics category of the host screen, e.g. `RecordingDetailV2`. */
  trackCategory: string;
}
