export const SERVER = {
  port: Number(process.env["XYNE_CLAW_PORT"] ?? 3002),
  s2sKey: process.env["XYNE_CLAW_S2S_KEY"] ?? "",
  authServiceUrl: process.env["XYNE_CLAW_AUTH_URL"] ?? "http://localhost:3003",
} as const;

export const PATHS = {
  dataDir: process.env["XYNE_CLAW_DATA_DIR"] ?? "./data",
  agentDir: process.env["XYNE_CLAW_AGENT_DIR"] ?? "",
} as const;

export const LITELLM = {
  url: process.env["LITELLM_URL"] ?? "http://localhost:4000",
  apiKey: process.env["LITELLM_API_KEY"] ?? "",
  model: process.env["LITELLM_MODEL"] ?? "claude-sonnet-4-20250514",
} as const;

export const AGENT = {
  thinkingLevel: process.env["XYNE_CLAW_THINKING"] ?? "medium",
} as const;
