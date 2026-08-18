const OPERATIONS = new Set(["interactive", "baseline", "artifact", "work"]);
const BASELINE_KINDS = new Set([
  "CORE_CODE_MAP",
  "FRONTEND_DESIGN_SYSTEM",
  "CODE_LINT_STANDARDS",
  "RUN_GUIDE",
  "TEST_GUIDE",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nullableString(value: unknown): boolean {
  return value === null || nonEmptyString(value);
}

export function parseSdlcAgentRunContext(value: unknown): Record<string, unknown> | null {
  const input = record(value);
  const repository = record(input?.["repository"]);
  const permissions = record(input?.["permissions"]);
  const gates = record(input?.["gates"]);
  const execution = record(input?.["execution"]);
  const artifact = record(input?.["artifact"]);
  if (
    input?.["version"] !== 1 ||
    !nonEmptyString(input["operation"]) ||
    !OPERATIONS.has(input["operation"]) ||
    !nonEmptyString(input["workspaceId"]) ||
    !nonEmptyString(input["projectId"]) ||
    !nonEmptyString(input["channelId"]) ||
    !nonEmptyString(input["actorUserId"]) ||
    !nonEmptyString(repository?.["id"]) ||
    !nonEmptyString(repository["name"]) ||
    !nonEmptyString(repository["url"]) ||
    !nonEmptyString(repository["baseBranch"]) ||
    !permissions ||
    !["ADMIN", "MEMBER"].includes(String(permissions["repositoryRole"] ?? "")) ||
    typeof permissions["writeRequested"] !== "boolean" ||
    !gates ||
    !nonEmptyString(gates["accessStatus"]) ||
    !(
      gates["accessCredentialRevision"] === null ||
      (Number.isInteger(gates["accessCredentialRevision"]) && Number(gates["accessCredentialRevision"]) > 0)
    ) ||
    !Array.isArray(gates["capabilities"]) ||
    typeof gates["allBaselinesApproved"] !== "boolean" ||
    !execution ||
    !nullableString(execution["workflowExecutionId"]) ||
    !nullableString(execution["sessionId"]) ||
    !nullableString(execution["conversationId"]) ||
    !artifact ||
    !nullableString(artifact["kind"]) ||
    !nullableString(artifact["id"]) ||
    !nullableString(artifact["sourceType"]) ||
    !nullableString(artifact["sourceId"])
  ) {
    return null;
  }
  if (
    input["operation"] === "baseline" &&
    (!nonEmptyString(input["setupExecutionId"]) ||
      !nonEmptyString(input["baselineKind"]) ||
      !BASELINE_KINDS.has(input["baselineKind"]) ||
      !nonEmptyString(execution["workflowExecutionId"]) ||
      !nonEmptyString(execution["sessionId"]))
  ) return null;
  if (
    input["operation"] === "artifact" &&
    (!["PRD", "TECH_DOC"].includes(String(artifact["kind"] ?? "")) ||
      !nonEmptyString(execution["workflowExecutionId"]) ||
      !nonEmptyString(execution["sessionId"]))
  ) return null;
  if (
    input["operation"] === "work" &&
    (!nonEmptyString(input["ticketId"]) ||
      permissions["writeRequested"] !== true ||
      !nonEmptyString(execution["workflowExecutionId"]) ||
      !nonEmptyString(execution["sessionId"]))
  ) return null;
  if (input["operation"] === "interactive" && !nonEmptyString(execution["conversationId"])) {
    return null;
  }
  return input;
}

export function injectSdlcBaselineRunContext(
  params: Record<string, unknown>,
  runMetadata: unknown,
): Record<string, unknown> {
  const metadata = record(runMetadata);
  const context = parseSdlcAgentRunContext(metadata?.["sdlcContext"]);
  if (!context || context["operation"] !== "baseline") return params;
  const repository = record(context["repository"]);
  const execution = record(context["execution"]);
  const repoId = repository?.["id"];
  const setupExecutionId = context["setupExecutionId"];
  const workflowExecutionId = execution?.["workflowExecutionId"];
  const baselineKind = context["baselineKind"];
  if (
    typeof repoId !== "string" ||
    typeof setupExecutionId !== "string" ||
    typeof workflowExecutionId !== "string" ||
    typeof baselineKind !== "string" ||
    !BASELINE_KINDS.has(baselineKind)
  ) {
    return params;
  }
  return { ...params, repoId, setupExecutionId, workflowExecutionId, baselineKind };
}
