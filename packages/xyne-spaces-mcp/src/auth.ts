/**
 * Spaces auth for MCP server — custom auth via localhost Electron server.
 *
 * Flow: POST /auth/request → Electron shows consent dialog → token returned.
 * Token is cached in memory for the session.
 */

const BASE = process.env.SPACES_API_URL || "https://spaces.xyne.juspay.net"

/**
 * Shown in the Spaces consent dialog so the user can tell which client is asking.
 * Set SPACES_AGENT_NAME per client (e.g. "Claude Code", "Cursor") — the default is
 * accurate but says nothing about who is driving the server.
 */
const AGENT_NAME = process.env.SPACES_AGENT_NAME || "Xyne Spaces MCP"

interface TokenData {
  accessToken: string
  expiresAt: number
}

let cachedToken: TokenData | undefined

/**
 * In-flight authorization, shared by concurrent callers.
 *
 * The desktop app allows only one consent dialog at a time and answers 429 to
 * anything that arrives while one is open. Without this, an agent invoking
 * several tools in parallel would fire a request per tool and all but the first
 * would fail.
 */
let pendingAuth: Promise<string> | undefined

/**
 * Get a valid access token, requesting authorization if needed.
 */
export async function getAccessToken(): Promise<string> {
  // Return cached token if still valid
  if (cachedToken && Date.now() < cachedToken.expiresAt - 30000) {
    return cachedToken.accessToken
  }

  if (pendingAuth) return pendingAuth

  pendingAuth = requestAuthorization().finally(() => {
    pendingAuth = undefined
  })
  return pendingAuth
}

async function requestAuthorization(): Promise<string> {
  // Request new authorization
  const response = await fetch(`${BASE}/auth/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentName: AGENT_NAME,
      agentType: "mcp",
      description: `${AGENT_NAME} is requesting access to Spaces via MCP`,
    }),
  })

  if (!response.ok) {
    throw new Error(`Auth request failed: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as {
    status: string
    accessToken?: string
    expiresAt?: number
  }

  if (data.status !== "approved" || !data.accessToken) {
    throw new Error("Authorization was not approved in Spaces app")
  }

  cachedToken = {
    accessToken: data.accessToken,
    expiresAt: data.expiresAt ?? Date.now() + 5 * 60 * 1000,
  }

  return cachedToken.accessToken
}

/**
 * Make an authenticated request to the Spaces server.
 */
export async function spacesFetch(
  path: string,
  init?: RequestInit
): Promise<unknown> {
  const token = await getAccessToken()
  const url = `${BASE}${path}`

  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Spaces API ${response.status}: ${text}`)
  }

  return response.json()
}

/**
 * Clear the cached token (for logout/reset).
 */
export function clearToken(): void {
  cachedToken = undefined
}
