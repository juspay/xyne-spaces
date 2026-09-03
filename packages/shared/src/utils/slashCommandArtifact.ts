import type { FlowComponent, FlowDefinition } from "../types/flowUI";
import {
  flowDefinitionSchema,
  slashCommandArtifactPropsSchema,
  type SlashCommandArtifactClosed,
  type SlashCommandArtifactEndedCall,
  type SlashCommandArtifactProps,
} from "../validation/flowSchema";

const FLOW_JSON_ATTRIBUTE_PATTERN = /data-flow-json="([^"]+)"/i;

/**
 * Produce a stable, non-reversible-enough correlation key for random entity IDs.
 * Logs can be joined across the client and server without emitting raw message,
 * conversation, channel, or call identifiers. This is diagnostics-only; it is
 * not a cryptographic primitive and must never be used for authorization.
 */
export const getSlashCommandArtifactDiagnosticKey = (
  value: string | null | undefined,
): string => {
  if (!value) return "missing";

  // 64-bit FNV-1a is deterministic in every ES2020 runtime used by the repo.
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
};

// ── Command registry ──────────────────────────────────────────────────────
// Everything a slash-command artifact does — how it is labelled and, more
// importantly, who it is allowed to notify — is defined here and keyed by
// command. Message content only carries the command identifier, so a client
// cannot hand-craft FlowJSON that grants itself a channel-wide audience.

export interface SlashCommandArtifactDefinition {
  /** Identifier persisted in message content; matches the `/name` typed by the user. */
  command: string;
  /** Short label rendered on the card, banner, and activity row. */
  badge: string;
  title: string;
  description: string;
  category: string;
  viewActionLabel: string;
  /** Composer header while the artifact is being drafted: "<composerLabel> in #channel". */
  composerLabel: string;
  /** Noun used in composer validation copy: "Describe the <bodyNoun> before sending". */
  bodyNoun: string;
  /** Placeholder shown in the composer while drafting the artifact body. */
  composerPlaceholder: string;
  /** Verb phrase used in the activity feed: "<actor> <activityActionLabel> <channel>". */
  activityActionLabel: string;
  /**
   * Server-authoritative. When true the message is delivered to the whole
   * channel through the existing `@channel` broadcast pipeline, including in
   * thread replies where broadcasts are otherwise suppressed.
   */
  notifiesChannel: boolean;
  /** Whether the artifact exposes call controls and tracks a linked call. */
  linksCall: boolean;
}

export const SEV2_SLASH_COMMAND = "sev2";

export const SLASH_COMMAND_ARTIFACT_DEFINITIONS: Record<
  string,
  SlashCommandArtifactDefinition
> = {
  [SEV2_SLASH_COMMAND]: {
    command: SEV2_SLASH_COMMAND,
    badge: "SEV2",
    title: "Active incident",
    description: "Declare a SEV2 incident in this conversation",
    category: "Incident",
    viewActionLabel: "View incident",
    composerLabel: "Declaring an incident",
    bodyNoun: "incident",
    composerPlaceholder: "What broke? Impact, scope, current status…",
    activityActionLabel: "declared a SEV2 in",
    notifiesChannel: true,
    linksCall: true,
  },
};

export const getSlashCommandArtifactDefinition = (
  command: string | null | undefined,
): SlashCommandArtifactDefinition | null =>
  command
    ? (SLASH_COMMAND_ARTIFACT_DEFINITIONS[command] ?? null)
    : null;

const decodeHtmlAttribute = (value: string): string =>
  value
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#10;/g, "\n")
    .replace(/&#13;/g, "\r")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    // Decode ampersands last so user text containing an entity-looking string
    // remains literal rather than being decoded twice.
    .replace(/&amp;/g, "&");

const encodeHtmlAttribute = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/** Serialize a validated FlowDefinition using the repository's standard envelope. */
export const serializeFlowDefinitionMessageContent = (
  flow: FlowDefinition,
): string => {
  const validated = flowDefinitionSchema.parse(flow);
  return `<div data-flow-json="${encodeHtmlAttribute(JSON.stringify(validated))}">Flow JSON</div>`;
};

export interface ParsedSlashCommandArtifact {
  flow: FlowDefinition;
  component: FlowComponent;
  props: SlashCommandArtifactProps;
  definition: SlashCommandArtifactDefinition;
  body: string;
}

export interface BuildSlashCommandArtifactFlowMessageInput {
  command: string;
  body: string;
  screenId: string;
}

/**
 * Build the standard FlowJSON message envelope used by plan and app flows.
 * Only the command identifier and the body are persisted — presentation and
 * side-effect policy are resolved from the registry at render/handle time.
 */
export const buildSlashCommandArtifactFlowMessage = ({
  command,
  body,
  screenId,
}: BuildSlashCommandArtifactFlowMessageInput): string => {
  const flow: FlowDefinition = {
    version: "2.0",
    screenId,
    components: [
      {
        id: `${screenId}:artifact`,
        type: "slash_command_artifact",
        props: { command },
        children: [
          {
            id: `${screenId}:body`,
            type: "text",
            props: { content: body },
          },
        ],
      },
    ],
    state: {
      values: {},
      touched: {},
      errors: {},
      submitting: false,
      submitted: false,
      history: [],
      loadingComponentIds: [],
    },
  };

  return serializeFlowDefinitionMessageContent(flow);
};

/** Parse and validate a FlowJSON envelope from persisted message content. */
export const extractFlowDefinitionFromMessageContent = (
  content: string | null | undefined,
): FlowDefinition | null => {
  if (!content) return null;
  const encoded = content.match(FLOW_JSON_ATTRIBUTE_PATTERN)?.[1];
  if (!encoded) return null;

  try {
    const parsed: unknown = JSON.parse(decodeHtmlAttribute(encoded));
    const result = flowDefinitionSchema.safeParse(parsed);
    return result.success ? (result.data as FlowDefinition) : null;
  } catch {
    return null;
  }
};

const findSlashCommandArtifactComponent = (
  components: FlowComponent[],
): FlowComponent | null => {
  for (const component of components) {
    if (component.type === "slash_command_artifact") return component;
    const nested = component.children
      ? findSlashCommandArtifactComponent(component.children)
      : null;
    if (nested) return nested;
  }
  return null;
};

/**
 * Return the typed slash-command artifact encoded in a FlowJSON message.
 * Unregistered commands resolve to null so an unknown identifier renders as a
 * plain flow message instead of an unhandled card.
 */
export const parseSlashCommandArtifactMessage = (
  content: string | null | undefined,
): ParsedSlashCommandArtifact | null => {
  const flow = extractFlowDefinitionFromMessageContent(content);
  if (!flow) return null;

  const component = findSlashCommandArtifactComponent(flow.components);
  if (!component) return null;

  const propsResult = slashCommandArtifactPropsSchema.safeParse(
    component.props,
  );
  if (!propsResult.success) return null;
  const definition = getSlashCommandArtifactDefinition(propsResult.data.command);
  if (!definition) return null;

  const bodyComponent = component.children?.[0];
  const body =
    bodyComponent?.type === "text" &&
    typeof bodyComponent.props?.["content"] === "string"
      ? bodyComponent.props["content"]
      : "";

  return {
    flow,
    component,
    props: propsResult.data,
    definition,
    body,
  };
};

export interface SlashCommandArtifactProjection {
  command: string;
  messagePreview: string;
}

/**
 * Fields the `message_artifacts` row copies from message content. Lifecycle
 * (status / linked call) is never read from content — it lives only on the
 * artifact row, which is the single source of truth for it.
 */
export const getSlashCommandArtifactProjection = (
  content: string | null | undefined,
): SlashCommandArtifactProjection | null => {
  const artifact = parseSlashCommandArtifactMessage(content);
  if (!artifact) return null;

  return {
    command: artifact.props.command,
    messagePreview: artifact.body.replace(/\s+/g, " ").trim(),
  };
};

/** One-line label used in channel/DM lists and notification previews. */
export const getSlashCommandArtifactPreviewText = (
  content: string | null | undefined,
): string | null => {
  const artifact = parseSlashCommandArtifactMessage(content);
  if (!artifact) return null;

  const body = artifact.body.replace(/\s+/g, " ").trim();
  return body
    ? `${artifact.definition.badge} · ${body}`
    : artifact.definition.title;
};

/**
 * Merge extra props into the artifact component of a FlowJSON message.
 *
 * Returns null when the content is not a recognised artifact, so the caller can
 * skip the write entirely rather than rewriting a message it does not
 * understand.
 */
const withSlashCommandArtifactProps = (
  content: string,
  props: Partial<SlashCommandArtifactProps>,
): string | null => {
  const parsed = parseSlashCommandArtifactMessage(content);
  if (!parsed) return null;

  const patchComponents = (components: FlowComponent[]): FlowComponent[] =>
    components.map((component) => {
      if (component.type === "slash_command_artifact") {
        return { ...component, props: { ...component.props, ...props } };
      }
      return component.children
        ? { ...component, children: patchComponents(component.children) }
        : component;
    });

  return serializeFlowDefinitionMessageContent({
    ...parsed.flow,
    components: patchComponents(parsed.flow.components),
  });
};

/**
 * Bake the summary of a finished call into the artifact's FlowJSON.
 *
 * Called once when a linked call ends — the same pattern the standard call
 * system message uses.
 */
export const withSlashCommandArtifactEndedCall = (
  content: string,
  endedCall: SlashCommandArtifactEndedCall,
): string | null => withSlashCommandArtifactProps(content, { endedCall });

/**
 * Bake the "closed by its author" marker into the artifact's FlowJSON.
 *
 * The artifact row moves to a terminal status at the same time, which removes
 * it from the ACTIVE-only subscription — this marker is what tells the card it
 * was closed rather than never started.
 */
export const withSlashCommandArtifactClosed = (
  content: string,
  closed: SlashCommandArtifactClosed,
): string | null => withSlashCommandArtifactProps(content, { closed });
