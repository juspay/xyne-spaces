export const PER_CALL_AUTH_SERVER_TYPES = new Set<string>(["xyne-spaces"]);

const META_KEY = "xyneSpacesAuth";

export function spacesCallAuthMeta(credentials: Record<string, unknown>): Record<string, unknown> | undefined {
  const token = credentials["token"];
  if (typeof token !== "string" || !token) return undefined;
  const sessionId = credentials["sessionId"];
  return { [META_KEY]: { token, ...(typeof sessionId === "string" ? { sessionId } : {}) } };
}

export function applySpacesCallAuth(meta: unknown, env: NodeJS.ProcessEnv = process.env): void {
  if (!meta || typeof meta !== "object") return;
  const auth = (meta as Record<string, unknown>)[META_KEY];
  if (!auth || typeof auth !== "object") return;
  const { token, sessionId } = auth as { token?: unknown; sessionId?: unknown };
  if (typeof token === "string" && token) env["XYNE_SPACES_TOKEN"] = token;
  if (typeof sessionId === "string") env["XYNE_SPACES_SESSION_ID"] = sessionId;
}
