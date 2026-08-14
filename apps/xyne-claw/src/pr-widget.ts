import { prScreenId, type PrProvider, type PrWidgetPayload, type UiWidget } from "xyne-claw-shared";

const PR_TOOL_STATUS: Record<string, "created" | "merged"> = {
  create_pull_request: "created",
  merge_pull_request: "merged",
};

function detectProvider(toolName: string): PrProvider {
  const name = toolName.toLowerCase();
  if (name.includes("github")) return "github";
  if (name.includes("bitbucket")) return "bitbucket";
  if (name.includes("gitlab")) return "gitlab";
  return "other";
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const brace = text.indexOf("{");
    if (brace <= 0) return undefined;
    try {
      return JSON.parse(text.slice(brace));
    } catch {
      return undefined;
    }
  }
}

/** Resolve provider-specific MCP envelopes and nested PR response objects. */
function resolvePayload(text: string): Record<string, unknown> | undefined {
  const parsed = parseJson(text);
  if (!parsed || typeof parsed !== "object") return undefined;
  let record = parsed as Record<string, unknown>;

  const content = record["content"];
  if (Array.isArray(content)) {
    const inner = content
      .filter((item): item is { type?: string; text?: string } => !!item && typeof item === "object")
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("");
    const innerParsed = inner ? parseJson(inner) : undefined;
    if (innerParsed && typeof innerParsed === "object") record = innerParsed as Record<string, unknown>;
  }

  for (const key of ["pull_request", "pullRequest", "pullrequest", "merge_request", "mergeRequest", "pr"]) {
    const nested = record[key];
    if (nested && typeof nested === "object") return nested as Record<string, unknown>;
  }
  return record;
}

function extractUrl(payload: Record<string, unknown> | undefined, text: string): string | undefined {
  if (payload) {
    const links = payload["links"] as Record<string, unknown> | undefined;
    const self = links?.["self"];
    const selfHref = Array.isArray(self)
      ? (self[0] as Record<string, unknown> | undefined)?.["href"]
      : (self as Record<string, unknown> | undefined)?.["href"];
    const html = links?.["html"] as Record<string, unknown> | undefined;
    const url = firstString(payload["web_url"], payload["html_url"], payload["url"], selfHref, html?.["href"]);
    if (url) return url;
  }
  return text.match(/https?:\/\/[^\s"')\]]*(?:pull-?requests?|\/pull\/|merge_requests)[^\s"')\]]*/i)?.[0]
    ?? text.match(/https?:\/\/[^\s"')\]]+/i)?.[0];
}

function identityFromUrl(provider: PrProvider, url: string | undefined): { repo?: string; number?: string } {
  if (!url) return {};
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    if (provider === "github") {
      const match = path.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)$/i);
      return match ? { repo: `${match[1]!}/${match[2]!}`, number: match[3]! } : {};
    }
    if (provider === "bitbucket") {
      const server = path.match(/^\/projects\/([^/]+)\/repos\/([^/]+)\/pull-requests\/(\d+)$/i);
      if (server) return { repo: `${server[1]!}/${server[2]!}`, number: server[3]! };
      const cloud = path.match(/^\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)$/i);
      return cloud ? { repo: `${cloud[1]!}/${cloud[2]!}`, number: cloud[3]! } : {};
    }
    if (provider === "gitlab") {
      const match = path.match(/^\/(.+)\/-\/merge_requests\/(\d+)$/i);
      return match ? { repo: match[1]!, number: match[2]! } : {};
    }
  } catch {
    // Provider responses occasionally contain a non-URL link. The explicit
    // args/payload identity below remains a valid fallback.
  }
  return {};
}

/**
 * Convert a completed provider create/merge PR tool invocation to the generic
 * UiWidget contract. Non-PR tools, failed tools, and results without a stable
 * PR identity return null.
 */
export function prWidgetFromInvocation(invocation: unknown): Extract<UiWidget, { type: "pr" }> | null {
  const inv = (invocation ?? {}) as {
    toolName?: unknown;
    args?: unknown;
    result?: unknown;
    isError?: unknown;
    status?: unknown;
  };
  if (typeof inv.toolName !== "string" || inv.isError === true || inv.status === "running") return null;

  const bareName = (inv.toolName.includes("__") ? inv.toolName.slice(inv.toolName.indexOf("__") + 2) : inv.toolName)
    .toLowerCase()
    .replace(/-/g, "_");
  const status = PR_TOOL_STATUS[bareName];
  if (!status) return null;

  const args = inv.args && typeof inv.args === "object" ? inv.args as Record<string, unknown> : {};
  const resultText = typeof inv.result === "string"
    ? inv.result
    : (() => {
        try { return JSON.stringify(inv.result); } catch { return String(inv.result ?? ""); }
      })();
  if (!resultText.trim()) return null;
  const payload = resolvePayload(resultText);

  const url = extractUrl(payload, resultText) ?? firstString(args["url"], args["prUrl"], args["pullRequestUrl"]);
  const provider = detectProvider(inv.toolName);
  const urlIdentity = identityFromUrl(provider, url);
  const number = firstString(
    urlIdentity.number,
    payload?.["id"], payload?.["number"], payload?.["iid"],
    args["pull_request_id"], args["pullRequestId"], args["pr_number"], args["prNumber"], args["number"],
  );
  if (!url && !number) return null;

  const repo = firstString(
    urlIdentity.repo,
    args["workspace"] && args["repository"] ? `${String(args["workspace"])}/${String(args["repository"])}` : undefined,
    args["projectKey"] && args["repoSlug"] ? `${String(args["projectKey"])}/${String(args["repoSlug"])}` : undefined,
    args["owner"] && args["repo"] ? `${String(args["owner"])}/${String(args["repo"])}` : undefined,
    args["repoName"], args["repoSlug"], args["repository"], args["repo"],
  );
  const title = firstString(payload?.["title"], args["title"], args["ticketTitle"]) ?? "Pull request";
  const desc = firstString(payload?.["description"], payload?.["body"], args["description"], args["ticketDescription"]);
  const ticketId = firstString(args["xyneId"], args["ticketId"]);
  const detailsUrl = firstString(args["detailsUrl"], args["ticketUrl"]);

  const widgetPayload: PrWidgetPayload = {
    provider,
    status,
    title,
    ...(url ? { url } : {}),
    ...(desc ? { desc } : {}),
    ...(ticketId ? { ticketId } : {}),
    ...(detailsUrl ? { detailsUrl } : {}),
    ...(number ? { number } : {}),
    ...(repo ? { repo } : {}),
  };
  const screenId = prScreenId({ provider, ...(repo ? { repo } : {}), ...(number ? { number } : {}), ...(url ? { url } : {}) });

  return { id: `pr:${screenId}`, type: "pr", operation: "upsert", payload: widgetPayload };
}
