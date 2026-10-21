/**
 * AI provider roster and name resolution.
 *
 * Providers are a fixed list defined in code (there is no `providers` table),
 * so a name the user or an agent says is resolved here against that roster.
 *
 * This file used to ALSO infer intent from the user's message — scanning for
 * provider keywords and posting a connect card on a match. That offered
 * "Connect OpenAI Codex" to a user already connected to it, and fired the whole
 * roster at "what model are you using?", a question about the AGENT. Intent now
 * comes only from the agent's `suggest-providers` call; nothing here reads user
 * text.
 */

export const SUPPORTED_PROVIDERS = [
  "codex",
  "claude",
  "copilot",
  "openrouter",
  "litellm",
  "spaces",
] as const;

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<string, string> = {
  codex: "OpenAI Codex",
  claude: "Anthropic Claude",
  copilot: "GitHub Copilot",
  openrouter: "OpenRouter",
  litellm: "LiteLLM (own key)",
  spaces: "Spaces",
};

export const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  codex: "Your ChatGPT account, signed in through OpenAI.",
  claude: "Your Anthropic account, signed in through Claude.",
  copilot: "Your GitHub Copilot seat.",
  openrouter: "One key, many models across providers.",
  litellm: "Point at your own LiteLLM gateway.",
  spaces: "The built-in default. Always available, nothing to connect.",
};

/** How the card connects each one — anything else is not a valid action. */
export const PROVIDER_CONNECT_METHOD: Record<string, "oauth" | "device" | "api_key" | "none"> = {
  codex: "oauth",
  claude: "oauth",
  copilot: "device",
  openrouter: "api_key",
  litellm: "api_key",
  spaces: "none",
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * User-facing aliases: nobody types our internal keys. Matched as a WHOLE
 * token by normalizeProviderName, never scanned for inside free text — that
 * substring scan is what turned "use opus for this" into a connect card.
 */
const PROVIDER_ALIASES: Record<string, readonly string[]> = {
  claude: ["claude", "anthropic", "sonnet", "opus", "haiku"],
  codex: ["codex", "openai", "open ai", "chatgpt", "gpt"],
  copilot: ["copilot", "github copilot"],
  openrouter: ["openrouter", "open router"],
  litellm: ["litellm", "lite llm"],
  spaces: ["spaces", "spaces default", "xyne default"],
};

export function stripAddressedAgentMention(text: string, agentSlug?: string): string {
  if (!text.trim() || !agentSlug?.trim()) return text;
  const pattern = agentSlug.trim().split("-").map(escapeRegExp).join("[\\s-]*");
  return text
    .replace(new RegExp(`@\\s*${pattern}\\b`, "gi"), " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function normalizeProviderName(raw: string): SupportedProvider | null {
  const token = raw.trim().toLowerCase();
  if (!token) return null;
  const exact = SUPPORTED_PROVIDERS.find((provider) => provider === token);
  if (exact) return exact;
  for (const [provider, aliases] of Object.entries(PROVIDER_ALIASES)) {
    if (aliases.includes(token)) return provider as SupportedProvider;
  }
  return null;
}

export function normalizeProviderOrder(raw: readonly string[]): {
  providers: SupportedProvider[];
  unknown: string[];
} {
  const providers: SupportedProvider[] = [];
  const unknown: string[] = [];
  for (const entry of raw) {
    const match = normalizeProviderName(entry);
    if (!match) {
      const trimmed = entry.trim();
      if (trimmed && !unknown.includes(trimmed)) unknown.push(trimmed);
      continue;
    }
    if (!providers.includes(match)) providers.push(match);
  }
  return { providers, unknown };
}

