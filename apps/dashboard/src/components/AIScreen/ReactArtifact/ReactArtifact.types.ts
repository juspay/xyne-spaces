import type {
  MessageAttachment,
  ReactArtifactManifest,
} from '../../Chat/XyneAISidebar/utils/XyneAITypes';
import type { ArtifactDataRequirement } from './artifactData.constants';

/** Full project as emitted by the `create-react-artifact` tool, stored as the
 *  attachment's bytes. Mirrors ReactArtifactPayload in xyne-claw-shared. */
export interface ReactArtifactPayload {
  version: number;
  title: string;
  entry: string;
  template: 'react-ts';
  files: Array<{ path: string; content: string }>;
  dependencies: Record<string, string>;
  dataRequirements: ArtifactDataRequirement[];
  /** Declared by the agent when the app calls useXyneMutate. Drives the header
   *  badge only — it grants nothing, since there is no mutation allowlist. */
  writes?: boolean;
  /** Declared when the app calls useXyneAgent. Drives the header badge only. */
  invokesAgents?: boolean;
  /** Agents the app prefers. A narrowing hint: the viewer's own access decides
   *  what actually runs, so this can never grant anything. */
  agents?: string[];
}

/**
 * An artifact as the UI addresses it. `attachmentId` is only usable once the
 * attachment has been persisted — during the run that produced it the id is a
 * client-side placeholder and the bytes arrive inline as `inlineData` instead.
 */
export interface ReactArtifactRef {
  attachmentId: string;
  manifest: ReactArtifactManifest;
  /** Base64 payload present only on the live (just-generated) path. */
  inlineData?: string;
  /** Set once the artifact has been saved, so the header can show its state. */
  savedAppId?: string;
}

/**
 * A saved app addressed by its own id rather than by the chat attachment it came
 * from. This is how a published app reaches someone who was never in the
 * originating conversation.
 */
export interface SavedArtifactRef {
  savedAppId: string;
  /** Owners may request a specific build; non-owners always get the pinned one. */
  versionId?: string;
  manifest: ReactArtifactManifest;
}

export interface ReactArtifactViewProps {
  artifact: ReactArtifactRef;
  /** Fill the available height (side panel) instead of the fixed inline height. */
  fill?: boolean;
  /** Shows an expand affordance when the artifact can also open full-screen. */
  onExpand?: (artifact: ReactArtifactRef) => void;
  /** Shows a close affordance; set when rendered inside the full-screen dialog. */
  onClose?: () => void;
  /** Shows a save affordance. Omitted when already saved or behind the flag. */
  onSave?: (artifact: ReactArtifactRef) => void;
  /** Drives the save button's appearance without the view owning the request. */
  saveState?: 'idle' | 'saving' | 'saved';
}

/** Narrow an attachment to an artifact ref, or null when it isn't one. */
export function toArtifactRef(attachment: MessageAttachment): ReactArtifactRef | null {
  const manifest = attachment.metadata?.reactArtifact;
  if (!manifest || !attachment.id) return null;
  return {
    attachmentId: attachment.id,
    manifest,
    ...(attachment.data ? { inlineData: attachment.data } : {}),
  };
}
