import type { FlowComponent, FlowDefinition } from "../types/flowUI";
import {
  flowDefinitionSchema,
  slashCommandArtifactPropsSchema,
  type SlashCommandArtifactProps,
  type SlashCommandArtifactSideEffect,
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
  body: string;
}

export interface BuildSlashCommandArtifactFlowMessageInput {
  command: string;
  body: string;
  sideEffects: SlashCommandArtifactSideEffect[];
  screenId: string;
}

/** Build the standard FlowJSON message envelope used by plan and app flows. */
export const buildSlashCommandArtifactFlowMessage = ({
  command,
  body,
  sideEffects,
  screenId,
}: BuildSlashCommandArtifactFlowMessageInput): string => {
  const flow: FlowDefinition = {
    version: "2.0",
    screenId,
    components: [
      {
        id: `${screenId}:artifact`,
        type: "slash_command_artifact",
        props: {
          command,
          sideEffects,
        },
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

/** Return the typed slash-command artifact encoded in a FlowJSON message. */
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
    body,
  };
};

export type SlashCommandArtifactSideEffectLifecycleStatus =
  | "active"
  | "completed";

/**
 * Persist banner lifecycle in the FlowJSON itself. This is deliberately a
 * content transformation rather than message-metadata state: every channel
 * member receives the same durable side-effect record through normal message
 * replication, even after the associated call falls out of recent-call queries.
 */
export const updateSlashCommandArtifactBannerLifecycle = (
  content: string,
  status: SlashCommandArtifactSideEffectLifecycleStatus,
  callExternalId: string,
): string | null => {
  const parsed = parseSlashCommandArtifactMessage(content);
  if (!parsed) return null;

  let updated = false;
  const patchComponents = (components: FlowComponent[]): FlowComponent[] =>
    components.map((component) => {
      if (component.type === "slash_command_artifact") {
        const propsResult = slashCommandArtifactPropsSchema.safeParse(
          component.props,
        );
        if (!propsResult.success) return component;
        const sideEffects = propsResult.data.sideEffects.map((sideEffect) => {
          if (sideEffect.type !== "banner") return sideEffect;
          // A restarted call replaces the previous call link. Late participant-
          // leave/room-finished events from that previous call must not complete
          // the newer call's side effect.
          if (
            status === "completed" &&
            sideEffect.callExternalId &&
            sideEffect.callExternalId !== callExternalId
          ) {
            return sideEffect;
          }
          updated = true;
          return { ...sideEffect, status, callExternalId };
        });
        return {
          ...component,
          props: { ...propsResult.data, sideEffects },
        };
      }
      return component.children
        ? { ...component, children: patchComponents(component.children) }
        : component;
    });

  const flow = {
    ...parsed.flow,
    components: patchComponents(parsed.flow.components),
  };
  return updated ? serializeFlowDefinitionMessageContent(flow) : null;
};

export interface SlashCommandArtifactCallLike {
  status: string;
  startedAt: number;
  metadata?: unknown;
}

export interface SlashCommandArtifactCallIdentity {
  messageId: string;
}

const getCallLink = (
  metadata: unknown,
): { conversationId?: string; artifactMessageId?: string } => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    return {};
  const value = metadata as Record<string, unknown>;
  return {
    ...(typeof value["conversationId"] === "string" && {
      conversationId: value["conversationId"],
    }),
    ...(typeof value["artifactMessageId"] === "string" && {
      artifactMessageId: value["artifactMessageId"],
    }),
  };
};

/** Resolve the newest call explicitly linked to an artifact message. */
export const findLatestSlashCommandArtifactCall = <
  T extends SlashCommandArtifactCallLike,
>(
  calls: readonly T[],
  artifact: SlashCommandArtifactCallIdentity,
): T | undefined => {
  const candidates = calls.filter(
    (call) =>
      getCallLink(call.metadata).artifactMessageId === artifact.messageId,
  );

  return candidates.reduce<T | undefined>(
    (latest, call) =>
      !latest || call.startedAt > latest.startedAt ? call : latest,
    undefined,
  );
};

export type SlashCommandArtifactCallLifecycleStatus =
  | "pending"
  | "active"
  | "completed";

export interface SlashCommandArtifactCallLifecycle<
  T extends SlashCommandArtifactCallLike,
> {
  status: SlashCommandArtifactCallLifecycleStatus;
  call?: T;
}

/** Side-effect lifecycle shared by the card, banner, and channel indicator. */
export const resolveSlashCommandArtifactCallLifecycle = <
  T extends SlashCommandArtifactCallLike,
>(
  calls: readonly T[],
  artifact: SlashCommandArtifactCallIdentity,
): SlashCommandArtifactCallLifecycle<T> => {
  const call = findLatestSlashCommandArtifactCall(calls, artifact);
  if (!call) return { status: "pending" };
  return {
    status: call.status === "ACTIVE" ? "active" : "completed",
    call,
  };
};
