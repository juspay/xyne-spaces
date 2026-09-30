export const WORKFLOW_SESSION_PREFIX = "wf-";

export function isWorkflowEngineSession(sessionId: unknown): boolean {
  return typeof sessionId === "string" && sessionId.startsWith(WORKFLOW_SESSION_PREFIX);
}

export function automationRunAllowsSandboxWrite(input: {
  sessionId: unknown;
  requested: boolean | undefined;
  sdlcProfile: boolean;
}): boolean {
  return input.requested === true || input.sdlcProfile || isWorkflowEngineSession(input.sessionId);
}
