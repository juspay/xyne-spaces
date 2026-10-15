import type { ReactNode } from 'react';
import type { CommandDef } from '@xyne/shared/commands';
import type { ClawAgentModel } from '../../services/clawAgentModelsService';
import type { AccessibleClawAgent } from '../../services/clawAgentListService';
import type { UserTag } from '../Chat/XyneAISidebar/utils/XyneAITypes';

/** Characters that open a menu while typing. */
export type TriggerChar = '@' | '#' | '/';

/** The menu the caret is in right now: the trigger and the text typed after it. */
export interface ActiveTrigger {
  char: TriggerChar;
  query: string;
  /** Doc range covering the trigger character and its query. */
  from: number;
  to: number;
}

/** Everything the @ and # menus can attach. One kind per pill family. */
export type PickKind =
  | 'channel'
  | 'person'
  | 'message'
  | 'attachment'
  | 'canvas'
  | 'ticket'
  | 'call'
  | 'app';

/** A pill's identity — what links the tray pill and the inline mention. */
export interface ContextRef {
  kind: PickKind;
  id: string;
}

/**
 * One item picked from the @ or # menu. `label` is the tray pill; `mention` is
 * the shorter inline token ("Samit Barai", "Prakhar's message") that reads as
 * part of the sentence.
 */
export type PickedContext = ContextRef & {
  label: string;
  mention: string;
} & (
    | { kind: 'channel'; isPrivate: boolean }
    | { kind: 'person' }
    | { kind: 'message'; conversationId?: string; channelId?: string }
    | { kind: 'attachment'; conversationId?: string; channelId?: string }
    | { kind: 'canvas'; canvasId?: string }
    | {
        kind: 'ticket';
        xyneId?: string;
        status?: string;
        channelId?: string;
        conversationId?: string;
      }
    | { kind: 'call'; channelId?: string; conversationId?: string; externalId?: string }
    | { kind: 'app' }
  );

/** One pill in the context tray above the composer. */
export interface ComposerTrayItem {
  key: string;
  icon: ReactNode;
  label: string;
  title?: string;
  /** Opens what the pill points at (the canvas, the thread, …). */
  onClick?: () => void;
  onRemove?: () => void;
  /** Set for pills that came from the @/# menu, so removing the pill also
   *  removes its inline mention. */
  ref?: ContextRef;
  /** Collections, scoped KB files and other agent-side scopes. */
  tone?: 'default' | 'accent';
}

/** A file attached from the device — a preview card in the box, like the chat composer's. */
export interface ComposerAttachment {
  key: string;
  file: File;
  onRemove: () => void;
}

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high';

export interface ComposerAgentControl {
  agents: AccessibleClawAgent[];
  /** null = Ask AI (or Auto, when `isAuto`). */
  selectedSlug: string | null;
  isAuto: boolean;
  /** Offered only where Auto can route (the composer has an assistant). */
  canAuto: boolean;
  onSelect: (slug: string | null) => void;
  onSelectAuto: () => void;
  disabled?: boolean;
}

export interface ComposerModelControl {
  models: ClawAgentModel[];
  /** The agent's configured model — what "Auto" runs. */
  defaultModel: string | null;
  defaultModelName: string | null;
  selectedModel: string | null;
  onSelectModel: (model: string | null) => void;
  thinkingLevel: ThinkingLevel | null;
  onSelectThinking: (level: ThinkingLevel | null) => void;
  /** The list belongs to the previous agent while the new one loads. */
  loading?: boolean;
  disabled?: boolean;
}

/** One knowledge-base scope: a collection, a folder in one, or a single file. */
export interface KnowledgeScope {
  id: string;
  name: string;
}

export interface KnowledgeSelection {
  collections: KnowledgeScope[];
  folders: KnowledgeScope[];
  /** id = the CollectionItem row id, the id attached_context 'file' items carry. */
  files: KnowledgeScope[];
}

/** The "+" menu's Collections picker. */
export interface ComposerKnowledgeControl extends KnowledgeSelection {
  /** Narrows the list to what this agent can read; null = everything the user can. */
  agent: AccessibleClawAgent | null;
  onChange: (next: KnowledgeSelection) => void;
}

export interface ComposerPlusControl {
  onAttachFiles: () => void;
  knowledge: ComposerKnowledgeControl;
  createCanvasEnabled: boolean;
  onCreateCanvasToggle?: () => void;
  webSearchEnabled: boolean;
  webSearchAccessible: boolean;
  onWebSearchToggle?: () => void;
  deepResearchEnabled: boolean;
  deepResearchAccessible: boolean;
  onDeepResearchToggle?: () => void;
  /** Extra rows a host needs (the desktop sandbox switch). */
  extra?: ReactNode;
}

export type SubmitTrigger = 'button' | 'enter';

export interface ComposerProps {
  /** Plain text of the editor, mentions serialized ("@Samit Barai", "#general"). */
  value: string;
  onValueChange: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** A reply is streaming: the send button becomes stop. */
  isStreaming: boolean;
  onSubmit: (trigger: SubmitTrigger) => void;
  onStop: () => void;
  /** JSON for the send button's analytics row. */
  sendTrackingMetadata?: string;

  trayItems: ComposerTrayItem[];
  /** Files from the device, shown as preview cards under the text. */
  attachments?: ComposerAttachment[];
  /** `${kind}:${id}` of every attached @/# item — drives the menus' check marks. */
  pickedRefs: ReadonlySet<string>;
  /** Attach a picked item. Returns false when refused (a cap), so no mention is inserted. */
  onPick: (item: PickedContext) => boolean;
  /** Detach an item whose last inline mention was deleted, or that was toggled off. */
  onUnpick: (ref: ContextRef) => void;

  commands: readonly CommandDef[];
  plus: ComposerPlusControl;
  agent: ComposerAgentControl | null;
  model: ComposerModelControl | null;

  onEnterVoiceMode?: () => void;
  /** Files pasted into the editor (a large text paste arrives as a file). */
  onFilesPasted: (files: File[]) => void;
  /** People mentioned inline, keyed "<Name>" like the transcript's mention chips. */
  onUserTagsChange?: (tags: Record<string, UserTag>) => void;
  /** Onboarding hides the toolbar. */
  hideToolbar?: boolean;
  /**
   * Which edge of the composer stays put. 'bottom' (a chat): it grows upward,
   * menus open above it and the context tray pushes up. 'top' (a new chat,
   * near the top of an empty page): it grows downward, menus open below it,
   * and the tray rises into the space above without moving anything.
   */
  anchor?: 'top' | 'bottom';
  /** Host popovers that hang from the composer's top edge. */
  children?: ReactNode;
  className?: string;
}

export interface ComposerHandle {
  focus: () => void;
  clear: () => void;
  /** Replace the text (mentions are not restored). */
  setText: (text: string) => void;
  insertText: (text: string) => void;
  /** Types a trigger at the caret, exactly as if the key was pressed. */
  openTrigger: (char: '@' | '/') => void;
  /** A menu is open — Enter selects in it rather than sending. */
  isMenuOpen: () => boolean;
  /** Strip unfinished dictation right before a send. */
  abortDictation: () => void;
}
