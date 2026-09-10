/**
 * AI provider recognition, read from the user's own words.
 *
 * Providers are a fixed list defined in code (there is no `providers` table),
 * so unlike connectors the server can answer "what do I have?" completely on
 * its own — no catalog round-trip and no dependence on the model choosing to
 * call a tool.
 *
 * UNSUPPORTED_PROVIDERS exists so "connect me to gemini" is recognised as a
 * provider request we cannot fulfil, rather than falling through as unrelated
 * prose. Without it the model is left to improvise an answer, which is how the
 * figma connector card ended up being described but never rendered.
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

interface ProviderHint {
  provider: SupportedProvider;
  keywords: readonly string[];
}

/**
 * Nobody types our internal keys. "anthropic" and "chatgpt" are what users
 * actually say, so the aliases matter more than the canonical name.
 */
const PROVIDER_HINTS: readonly ProviderHint[] = [
  { provider: "claude", keywords: ["claude", "anthropic", "sonnet", "opus", "haiku"] },
  { provider: "codex", keywords: ["codex", "openai", "open ai", "chatgpt", "gpt"] },
  { provider: "copilot", keywords: ["copilot", "github copilot"] },
  { provider: "openrouter", keywords: ["openrouter", "open router"] },
  { provider: "litellm", keywords: ["litellm", "lite llm"] },
  { provider: "spaces", keywords: ["spaces default", "xyne default"] },
];

/**
 * Named often enough to be worth answering precisely. Anything here gets a
 * truthful "not supported" instead of silence or an invented card.
 */
const UNSUPPORTED_PROVIDERS: Record<string, readonly string[]> = {
  Gemini: ["gemini", "bard", "google ai"],
  Mistral: ["mistral"],
  Llama: ["llama", "meta ai"],
  Perplexity: ["perplexity"],
  Grok: ["grok"],
  Cohere: ["cohere"],
  DeepSeek: ["deepseek", "deep seek"],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentions(text: string, keyword: string): number {
  return text.search(new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i"));
}

/** Providers the text names, in the order they first appear. */
export function providerTypesFromText(text: string): SupportedProvider[] {
  if (!text.trim()) return [];
  const hits: { provider: SupportedProvider; at: number }[] = [];
  for (const hint of PROVIDER_HINTS) {
    let earliest = -1;
    for (const keyword of hint.keywords) {
      const at = mentions(text, keyword);
      if (at >= 0 && (earliest === -1 || at < earliest)) earliest = at;
    }
    if (earliest >= 0) hits.push({ provider: hint.provider, at: earliest });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.provider);
}

/** Display names of providers the text names that Xyne does not offer. */
export function unsupportedProvidersFromText(text: string): string[] {
  if (!text.trim()) return [];
  const found: string[] = [];
  for (const [label, keywords] of Object.entries(UNSUPPORTED_PROVIDERS)) {
    if (keywords.some((k) => mentions(text, k) >= 0)) found.push(label);
  }
  return found;
}

const PROVIDER_NOUN = /\b(ai provider|ai providers|provider|providers|model|models|llm|llms)\b/i;

/**
 * The message is about an AGENT's configuration, not the user's own accounts.
 *
 * "which provider will this agent use" and "create a PR agent with anthropic"
 * both name a provider, but neither is a request to connect one — the card was
 * posted on both and read as noise. An agent's provider lives in its own Keys
 * dialog, so a user-level connect card is the wrong answer here regardless.
 */
const AGENT_CONTEXT = /\bagents?\b|\bsubagents?\b|@[a-z0-9-]+/i;

const ROSTER_INTENT =
  /\b(show|see|view|open|display|list|find|browse|bring up|pull up|what|which|how many|any)\b/i;

const CONNECT_INTENT =
  /\b(re)?connect(ed|ing|ion|ions)?\b|\bauthori[sz]e\b|\badd\b|\bset ?up\b|\bsign in\b|\blog in\b|\bconfigure\b|\benable\b|\bhook up\b|\bswitch to\b|\buse\b/i;

/**
 * "What providers do I have?" — a roster ask, provided no specific provider was
 * named. Naming one is a request for that provider, not for the whole list.
 */
export function wantsProviderRoster(text: string): boolean {
  if (!text.trim()) return false;
  if (AGENT_CONTEXT.test(text)) return false;
  if (!PROVIDER_NOUN.test(text)) return false;
  // "I want to connect a provider" without naming one is also a roster ask —
  // they cannot name what they have not been shown yet.
  if (!ROSTER_INTENT.test(text) && !CONNECT_INTENT.test(text)) return false;
  return providerTypesFromText(text).length === 0 && unsupportedProvidersFromText(text).length === 0;
}

/**
 * Providers the user explicitly asked to connect or switch to. Read from their
 * own message — the model does not get a vote, for the same reason it does not
 * for connectors: it has an incentive to claim intent so its card is shown.
 */
export function providersUserAskedFor(text: string): SupportedProvider[] {
  if (!text.trim()) return [];
  if (AGENT_CONTEXT.test(text)) return [];
  if (!CONNECT_INTENT.test(text) && !PROVIDER_NOUN.test(text)) return [];
  return providerTypesFromText(text);
}
