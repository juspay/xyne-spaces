interface FollowUpPayload {
  options?: unknown;
  purpose?: string;
}

interface FollowUpConversationRow {
  id: string;
  parentId: string | null;
  role: string;
  content: string;
  agentSlug: string;
}

export interface FollowUpConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface LateFollowUpCallback {
  sessionId: string;
  suggestions: string[];
  startedAt: string;
  completedAt: string;
  answerLength?: number;
  enabledByV2Flag: boolean;
  generationInput?: string;
  conversationMessageCount?: number;
  agentContextProvided?: boolean;
  agentContextName?: string;
  agentContextDescription?: string;
  generationSource?: "model" | "fallback";
  generationModel?: string;
  failureCode?: "missing_api_key" | "http_error" | "invalid_payload" | "request_error";
  failureMessage?: string;
  httpStatus?: number;
}

type LateFollowUpCallbackParseResult =
  | { success: true; data: LateFollowUpCallback }
  | { success: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number, allowEmpty = false): value is string {
  if (typeof value !== "string" || value.length > maxLength) return false;
  return allowEmpty || value.trim().length > 0;
}

function isOptionalBoundedString(
  value: unknown,
  maxLength: number,
  allowEmpty = false,
): value is string | undefined {
  return value === undefined || isBoundedString(value, maxLength, allowEmpty);
}

function isOptionalInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number | undefined {
  return value === undefined ||
    (typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum);
}

function isIsoDate(value: unknown): value is string {
  return isBoundedString(value, 40) && Number.isFinite(Date.parse(value));
}

function isGenerationSource(value: unknown): value is "model" | "fallback" {
  return value === "model" || value === "fallback";
}

function isFailureCode(value: unknown): value is NonNullable<LateFollowUpCallback["failureCode"]> {
  return value === "missing_api_key" ||
    value === "http_error" ||
    value === "invalid_payload" ||
    value === "request_error";
}

export function parseLateFollowUpCallback(value: unknown): LateFollowUpCallbackParseResult {
  if (!isRecord(value)) return { success: false };

  const sessionId = value["sessionId"];
  const rawSuggestions = value["suggestions"];
  const startedAt = value["startedAt"];
  const completedAt = value["completedAt"];
  const answerLength = value["answerLength"];
  const enabledByV2Flag = value["enabledByV2Flag"];
  const outcome = value["outcome"];
  const generationInput = value["generationInput"];
  const conversationMessageCount = value["conversationMessageCount"];
  const agentContextProvided = value["agentContextProvided"];
  const agentContextName = value["agentContextName"];
  const agentContextDescription = value["agentContextDescription"];
  const generationSource = value["generationSource"];
  const generationModel = value["generationModel"];
  const failureCode = value["failureCode"];
  const failureMessage = value["failureMessage"];
  const httpStatus = value["httpStatus"];

  if (
    !isBoundedString(sessionId, 200) ||
    !Array.isArray(rawSuggestions) ||
    rawSuggestions.length !== 3 ||
    !isIsoDate(startedAt) ||
    !isIsoDate(completedAt) ||
    Date.parse(completedAt) < Date.parse(startedAt) ||
    !isOptionalInteger(answerLength, 0, 10_000_000) ||
    typeof enabledByV2Flag !== "boolean" ||
    (outcome !== undefined && outcome !== "delivered_late") ||
    !isOptionalBoundedString(generationInput, 50_000, true) ||
    !isOptionalInteger(conversationMessageCount, 0, 12) ||
    (agentContextProvided !== undefined && typeof agentContextProvided !== "boolean") ||
    !isOptionalBoundedString(agentContextName, 200) ||
    !isOptionalBoundedString(agentContextDescription, 10_000) ||
    (generationSource !== undefined && !isGenerationSource(generationSource)) ||
    !isOptionalBoundedString(generationModel, 300) ||
    (failureCode !== undefined && !isFailureCode(failureCode)) ||
    !isOptionalBoundedString(failureMessage, 1_000) ||
    !isOptionalInteger(httpStatus, 100, 599)
  ) {
    return { success: false };
  }

  const suggestions = rawSuggestions.map((suggestion) =>
    typeof suggestion === "string" ? suggestion.trim() : ""
  );
  if (
    suggestions.some((suggestion) => suggestion.length === 0 || suggestion.length > 500) ||
    new Set(suggestions).size !== suggestions.length
  ) {
    return { success: false };
  }

  return {
    success: true,
    data: {
      sessionId: sessionId.trim(),
      suggestions,
      startedAt,
      completedAt,
      enabledByV2Flag,
      ...(answerLength !== undefined ? { answerLength } : {}),
      ...(generationInput !== undefined ? { generationInput } : {}),
      ...(conversationMessageCount !== undefined ? { conversationMessageCount } : {}),
      ...(agentContextProvided !== undefined ? { agentContextProvided } : {}),
      ...(agentContextName !== undefined ? { agentContextName: agentContextName.trim() } : {}),
      ...(agentContextDescription !== undefined
        ? { agentContextDescription: agentContextDescription.trim() }
        : {}),
      ...(generationSource !== undefined ? { generationSource } : {}),
      ...(generationModel !== undefined ? { generationModel: generationModel.trim() } : {}),
      ...(failureCode !== undefined ? { failureCode } : {}),
      ...(failureMessage !== undefined ? { failureMessage: failureMessage.trim() } : {}),
      ...(httpStatus !== undefined ? { httpStatus } : {}),
    },
  };
}

export function extractLateFollowUpSessionId(value: unknown): string | undefined {
  if (!isRecord(value) || !isBoundedString(value["sessionId"], 200)) return undefined;
  return value["sessionId"].trim();
}

export function isInternalFollowUpInvocation(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const invocation = value as { toolName?: unknown; args?: unknown };
  if (invocation.toolName === "internal-follow-up-diagnostics") return true;
  if (
    invocation.toolName !== "ask-user-question" ||
    !invocation.args ||
    typeof invocation.args !== "object" ||
    Array.isArray(invocation.args)
  ) {
    return false;
  }
  return (invocation.args as { purpose?: unknown }).purpose === "follow_up_suggestions";
}

export function buildFollowUpConversationHistory(
  messages: FollowUpConversationRow[],
  leafMessageId: string | null | undefined,
  agentSlug: string,
): FollowUpConversationMessage[] {
  if (!leafMessageId) return [];
  const byId = new Map(
    messages
      .filter((message) => message.agentSlug === agentSlug)
      .map((message) => [message.id, message]),
  );
  const path: FollowUpConversationMessage[] = [];
  const seen = new Set<string>();
  let cursor = byId.get(leafMessageId);
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    const content = cursor.content.trim();
    if ((cursor.role === "user" || cursor.role === "assistant") && content) {
      path.push({ role: cursor.role, content: content.slice(0, 2_000) });
    }
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return path.reverse().slice(-12);
}

export function extractFollowUpSuggestions(
  value: unknown,
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as FollowUpPayload;
    if (
      candidate.purpose !== "follow_up_suggestions" ||
      !Array.isArray(candidate.options)
    ) {
      continue;
    }
    const suggestions = candidate.options.filter(
      (option): option is string =>
        typeof option === "string" && option.trim().length > 0,
    );
    if (suggestions.length === 3) return suggestions;
  }
  return undefined;
}

export function extractFollowUpSuggestionsFromInvocations(
  value: unknown,
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const followUpInvocations = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const invocation = item as { toolName?: string; args?: unknown };
    if (
      invocation.toolName !== "ask-user-question" ||
      !invocation.args ||
      typeof invocation.args !== "object"
    ) {
      return [];
    }
    return [invocation.args];
  });
  return extractFollowUpSuggestions(followUpInvocations);
}

export function buildLateFollowUpInvocations(args: {
  sessionId: string;
  suggestions: string[];
  startedAt: string;
  completedAt: string;
  answerLength?: number;
  enabledByV2Flag: boolean;
  generationInput?: string;
  conversationMessageCount?: number;
  agentContextProvided?: boolean;
  agentContextName?: string;
  agentContextDescription?: string;
  generationSource?: string;
  generationModel?: string;
  failureCode?: string;
  failureMessage?: string;
  httpStatus?: number;
}): Array<Record<string, unknown>> {
  const rawDurationMs =
    new Date(args.completedAt).getTime() - new Date(args.startedAt).getTime();
  const durationMs = Number.isFinite(rawDurationMs)
    ? Math.max(0, rawDurationMs)
    : 0;
  const questionId = `parallel-follow-up-${args.sessionId}`;
  return [
    {
      toolName: "ask-user-question",
      args: {
        questionId,
        question: "Related questions",
        options: args.suggestions,
        purpose: "follow_up_suggestions",
      },
      result: "Follow-up suggestions recorded.",
      isError: false,
      startedAt: args.startedAt,
      durationMs,
      status: "completed",
      toolCallId: `follow-up-${questionId}`,
    },
    {
      toolName: "internal-follow-up-diagnostics",
      args: {
        purpose: "follow_up_debug",
        enabled: true,
        enabledByV2Flag: args.enabledByV2Flag,
        ...(args.answerLength !== undefined ? { answerLength: args.answerLength } : {}),
        hadExistingRecorder: false,
        outcome: "delivered_late",
        suggestionCount: args.suggestions.length,
        ...(args.generationInput ? { generationInput: args.generationInput } : {}),
        ...(args.conversationMessageCount !== undefined
          ? { conversationMessageCount: args.conversationMessageCount }
          : {}),
        ...(args.agentContextProvided !== undefined
          ? { agentContextProvided: args.agentContextProvided }
          : {}),
        ...(args.agentContextName ? { agentContextName: args.agentContextName } : {}),
        ...(args.agentContextDescription
          ? { agentContextDescription: args.agentContextDescription }
          : {}),
        ...(args.generationSource ? { generationSource: args.generationSource } : {}),
        ...(args.generationModel ? { generationModel: args.generationModel } : {}),
        ...(args.failureCode ? { failureCode: args.failureCode } : {}),
        ...(args.failureMessage ? { failureMessage: args.failureMessage } : {}),
        ...(args.httpStatus !== undefined ? { httpStatus: args.httpStatus } : {}),
      },
      result: "Follow-up generation delivered_late.",
      isError: false,
      startedAt: args.startedAt,
      durationMs,
      status: "completed",
      // Stable across callback retries so appendToolInvocation replaces rather
      // than duplicates this diagnostic row.
      toolCallId: `follow-up-debug-${args.sessionId}`,
    },
  ];
}
