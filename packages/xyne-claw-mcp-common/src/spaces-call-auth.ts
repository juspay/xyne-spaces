export const PER_CALL_AUTH_SERVER_TYPES = new Set<string>(["xyne-spaces"]);

const META_KEY = "xyneSpacesAuth";

/** Spaces credentials sent in a tool call's `_meta`, applied by the Spaces server before the call. */
export function spacesCallAuthMeta(credentials: Record<string, unknown>): Record<string, unknown> | undefined {
  const agentToken = credentials["agentToken"];
  if (typeof agentToken === "string" && agentToken) return { [META_KEY]: { agentToken } };
  const token = credentials["token"];
  if (typeof token !== "string" || !token) return undefined;
  const sessionId = credentials["sessionId"];
  return { [META_KEY]: { token, ...(typeof sessionId === "string" ? { sessionId } : {}) } };
}

export function applySpacesCallAuth(meta: unknown, env: NodeJS.ProcessEnv = process.env): void {
  if (!meta || typeof meta !== "object") return;
  const auth = (meta as Record<string, unknown>)[META_KEY];
  if (!auth || typeof auth !== "object") return;
  const { agentToken, token, sessionId } = auth as { agentToken?: unknown; token?: unknown; sessionId?: unknown };
  if (typeof agentToken === "string" && agentToken) env["XYNE_SPACES_AGENT_TOKEN"] = agentToken;
  if (typeof token === "string" && token) env["XYNE_SPACES_TOKEN"] = token;
  if (typeof sessionId === "string") env["XYNE_SPACES_SESSION_ID"] = sessionId;
}
