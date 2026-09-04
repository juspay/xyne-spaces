/**
 * Maps what a user asked for onto connectors that could do it.
 *
 * Exists because prompt-driven suggestion is unreliable: the model has to
 * notice the gap, know the connector exists, know it is not connected, and
 * choose to call a tool. It frequently gets one of those wrong — most often by
 * assuming a connector is already connected and explaining the shortfall in
 * prose instead of offering the fix.
 *
 * So the server decides too. After a run, the user's own words are matched
 * against these signals; any connector that matches and is NOT connected can be
 * offered regardless of what the model did.
 *
 * Two kinds of signal, deliberately kept apart:
 *
 *   `domains`  — matched by parsing URLs out of the text and comparing the
 *                HOSTNAME exactly (or as a subdomain). Never by regex: a
 *                substring test for "github.com" also matches
 *                `github.com.attacker.net` and `evil-github.com`, which is the
 *                unanchored-host bug CodeQL flags.
 *
 *   `keywords` — whole-word prose matches ("summarise my figma file"). These
 *                never touch URLs, so anchoring does not apply. Kept
 *                conservative: a product's own name, never a generic word like
 *                "document" or "search", since a wrong card is worse than none.
 */

export interface ConnectorHint {
  /** `mcp_servers.type` this hint points at. */
  serverType: string;
  /** Registrable hostnames. Subdomains match; lookalikes do not. */
  domains?: readonly string[];
  /** Whole-word prose signals, lowercase. */
  keywords?: readonly string[];
  connectKeywords?: readonly string[];
}

export const CONNECTOR_HINTS: readonly ConnectorHint[] = [
  { serverType: "github", domains: ["github.com"], keywords: ["github"] },
  { serverType: "bitbucket", domains: ["bitbucket.org"], keywords: ["bitbucket"] },
  {
    serverType: "google",
    domains: ["docs.google.com", "drive.google.com", "sheets.google.com", "mail.google.com"],
    keywords: ["gmail", "google doc", "google docs", "google drive", "google sheet", "google sheets", "google calendar", "google meet"],
    connectKeywords: ["google", "google workspace"],
  },
  {
    serverType: "microsoft",
    domains: ["outlook.com", "outlook.office.com", "sharepoint.com"],
    keywords: ["onedrive", "outlook", "teams", "sharepoint"],
    connectKeywords: ["microsoft", "microsoft 365", "office 365"],
  },
  { serverType: "slack", domains: ["slack.com"], keywords: ["slack"] },
  { serverType: "notion", domains: ["notion.so"], keywords: ["notion"] },
  { serverType: "figma", domains: ["figma.com"], keywords: ["figma"] },
  { serverType: "jira", domains: ["atlassian.net"], keywords: ["jira"] },
  { serverType: "asana", domains: ["asana.com"], keywords: ["asana"] },
  { serverType: "linear", domains: ["linear.app"], keywords: ["linear"] },
  { serverType: "grafana", keywords: ["grafana"] },
  { serverType: "shopify", domains: ["myshopify.com"], keywords: ["shopify"] },
  { serverType: "hubspot", domains: ["hubspot.com"], keywords: ["hubspot"] },
  { serverType: "salesforce", domains: ["salesforce.com", "force.com"], keywords: ["salesforce"] },
  { serverType: "intercom", domains: ["intercom.com"], keywords: ["intercom"] },
  { serverType: "amplitude", domains: ["amplitude.com"], keywords: ["amplitude"] },
  { serverType: "mixpanel", domains: ["mixpanel.com"], keywords: ["mixpanel"] },
  { serverType: "bigquery", keywords: ["bigquery"] },
  { serverType: "databricks", domains: ["databricks.com"], keywords: ["databricks"] },
];

/** Finds http(s) URLs; the host itself is then parsed, never regex-matched. */
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;

interface FoundUrl {
  host: string;
  at: number;
}

function extractUrls(text: string): FoundUrl[] {
  const found: FoundUrl[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    try {
      const host = new URL(match[0]).hostname.toLowerCase().replace(/\.$/, "");
      if (host) found.push({ host, at: match.index ?? 0 });
    } catch {
      /* not a usable URL — ignore */
    }
  }
  return found;
}

/**
 * True when `host` IS the domain or a subdomain of it.
 *
 * The dot in the suffix check is what makes this safe: "github.com" matches
 * `api.github.com` but not `github.com.attacker.net` (different registrable
 * domain) or `evil-github.com` (no dot boundary).
 */
function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Escapes a keyword so it cannot smuggle regex syntax into the matcher. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Blanks out URLs so keyword matching only ever sees prose.
 *
 * Without this, `github.com.attacker.net` would trip the "github" KEYWORD even
 * though its hostname was correctly rejected — reintroducing the lookalike bug
 * through the back door. Replaced with spaces of equal length so the character
 * offsets used for ordering stay accurate.
 */
function maskUrls(text: string): string {
  return text.replace(URL_PATTERN, (match) => " ".repeat(match.length));
}

function keywordIndex(text: string, keyword: string): number {
  const pattern = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i");
  return text.search(pattern);
}

/** Connector types the text implies, in the order they first appear. */
export interface ConnectorMatchOptions {
  includeKeywords?: boolean;
  includeConnectKeywords?: boolean;
}

export function connectorTypesFromText(
  text: string,
  options: ConnectorMatchOptions = {},
): string[] {
  if (!text.trim()) return [];

  const urls = extractUrls(text);
  const prose = maskUrls(text);
  const hits: { serverType: string; at: number }[] = [];

  for (const hint of CONNECTOR_HINTS) {
    let earliest = -1;

    for (const domain of hint.domains ?? []) {
      for (const url of urls) {
        if (hostMatches(url.host, domain) && (earliest === -1 || url.at < earliest)) {
          earliest = url.at;
        }
      }
    }

    const prosePatterns = [
      ...(options.includeKeywords ? (hint.keywords ?? []) : []),
      ...(options.includeConnectKeywords ? (hint.connectKeywords ?? []) : []),
    ];
    for (const keyword of prosePatterns) {
      const at = keywordIndex(prose, keyword);
      if (at >= 0 && (earliest === -1 || at < earliest)) earliest = at;
    }

    if (earliest >= 0) hits.push({ serverType: hint.serverType, at: earliest });
  }

  return hits.sort((a, b) => a.at - b.at).map((h) => h.serverType);
}

/**
 * Verbs that mean "wire this up", as opposed to merely naming a product.
 * Deliberately narrow: "link" and "add" are excluded because they appear far
 * more often as nouns or unrelated verbs ("paste the link", "add the numbers")
 * than as connect intent, and a false positive here bypasses the
 * already-usable filter.
 */
const CONNECT_INTENT =
  /\b(re)?connect(ed|ing|ion|ions)?\b|\bauthori[sz]e\b|\bintegrate\b|\bset ?up\b|\bsign in\b|\blog in\b|\bhook up\b/i;

const SHOW_CONNECTOR_INTENT =
  /\b(show|see|view|open|display|list|find|bring up|pull up)\b[^.?!\n]{0,60}\b(connector|connectors|mcp|mcps|integration|integrations)\b/i;

/**
 * Connector types the HUMAN explicitly asked for, read from their own message —
 * either to connect one or to be shown one. The model cannot be trusted to
 * report this: it has an incentive to claim explicit intent so its card is
 * shown, and has been observed doing so for plain task requests.
 */
export function connectorTypesUserAskedFor(text: string): string[] {
  if (!text.trim()) return [];
  if (!CONNECT_INTENT.test(text) && !SHOW_CONNECTOR_INTENT.test(text)) return [];
  return connectorTypesFromText(text, { includeKeywords: true, includeConnectKeywords: true });
}
