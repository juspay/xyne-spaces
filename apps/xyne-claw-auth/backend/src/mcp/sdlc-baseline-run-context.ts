import { SDLC_BASELINE_KINDS, sdlcAgentContextSchema } from "@xyne/shared/sdlc";

const BASELINE_KINDS = new Set<string>(SDLC_BASELINE_KINDS);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseSdlcAgentRunContext(value: unknown): Record<string, unknown> | null {
  const parsed = sdlcAgentContextSchema.safeParse(value);
  return parsed.success ? (value as Record<string, unknown>) : null;
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
