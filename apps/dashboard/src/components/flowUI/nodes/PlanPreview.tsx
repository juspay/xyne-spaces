import React from 'react';
import { ArtifactPreview, InsideArtifactPreviewContext } from './ArtifactPreview';

/**
 * Back-compat alias: PlanNode (and any nested-card guard) reads this to hide its
 * Maximize inside the preview's thread panel. The context itself now lives in
 * ArtifactPreview and is shared by every artifact card (plan, agent creation,
 * entity update).
 */
export const InsidePlanPreviewContext = InsideArtifactPreviewContext;

/**
 * PlanPreview — the EXPANDED plan view.
 *
 * Thin wrapper over the shared ArtifactPreview split screen (left = artifact,
 * right = live thread): it pins the plan's header label, analytics category and
 * historical dialog id prefix. See ArtifactPreview for the layout contract;
 * `todos` maps to the generic `body` slot.
 */
interface PlanPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Stable id for markdown code-block keys (the plan message id). */
  messageId: string;
  title: string;
  desc?: string | undefined;
  /** Detailed markdown plan (agent-authored). Rendered below the todo checklist
   *  when present; omitted when absent. */
  document?: string | undefined;
  /** Thread the card belongs to — rendered on the right. */
  conversationId?: string | undefined;
  /** Phase-specific controls shown in the left panel footer (actions / audit). */
  footer?: React.ReactNode;
  /** The todo checklist — the SAME selection state as the compact card. */
  todos?: React.ReactNode;
}

export const PlanPreview: React.FC<PlanPreviewProps> = ({ todos, ...rest }) => (
  <ArtifactPreview
    {...rest}
    label='Plan'
    body={todos}
    trackCategory='PLAN_ARTIFACT'
    idPrefix='plan-preview'
  />
);
