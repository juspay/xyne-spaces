/**
 * Enriched selection documents for Hub stage-C retrieval.
 * Each catalog item becomes: name + description + tool blurbs + skill summary
 * + synthetic "Use when…" query templates (heuristic; offline LLM optional).
 */

export interface SelectionDoc {
  id: string;
  hub: "mcp" | "builtin" | "subagent" | "skill" | "knowledge";
  name: string;
  description: string;
  /** Full text indexed by BM25. */
  text: string;
  useWhen: string[];
}

function truncate(s: string, n: number): string {
  const t = (s ?? "").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

/** Heuristic Use-when templates from name/description tokens. */
export function syntheticUseWhen(name: string, description: string, extra: string[] = []): string[] {
  const base = `${name} ${description}`.toLowerCase();
  const out: string[] = [];
  const push = (q: string) => {
    const t = q.trim();
    if (t.length >= 12 && !out.includes(t)) out.push(t);
  };

  push(`use when the agent needs ${name}`);
  if (description.trim()) push(`use when ${truncate(description, 80).toLowerCase()}`);
  for (const e of extra) push(`use when ${e}`);

  if (/\b(slack|standup)\b/.test(base)) {
    push("use when posting standups or reading slack channels");
  }
  if (/\b(github|pull.?request|code\s*review)\b/.test(base)) {
    push("use when reviewing pull requests or github issues");
  }
  if (/\b(email|gmail|outlook|inbox|digest)\b/.test(base)) {
    push("use when sending email digests or reading inbox");
  }
  if (/\b(spaces|xyne)\b/.test(base)) {
    push("use when messaging in xyne spaces dms or channels");
  }
  if (/\b(web\s*search|browse|webfetch|research)\b/.test(base)) {
    push("use when researching on the web or looking up competitors");
  }
  if (/\b(jira|ticket|issue)\b/.test(base)) {
    push("use when triaging jira tickets or issue trackers");
  }
  if (/\b(notion|wiki|docs|knowledge)\b/.test(base)) {
    push("use when reading product docs or a knowledge base");
  }
  if (/\b(calendar|meeting|schedule)\b/.test(base)) {
    push("use when scheduling meetings or reading calendars");
  }
  if (/\b(api\s*design|design\s*review)\b/.test(base)) {
    push("use when reviewing api design documents");
  }
  return out.slice(0, 10);
}

export function enrichSubagentDoc(s: {
  name: string;
  description: string;
}): SelectionDoc {
  const useWhen = syntheticUseWhen(s.name, s.description, ["delegating specialty work"]);
  return {
    id: s.name,
    hub: "subagent",
    name: s.name,
    description: s.description,
    text: [s.name, s.description, ...useWhen].join("\n"),
    useWhen,
  };
}

export function enrichIntegrationDoc(i: {
  slug: string;
  label: string;
  kind?: string;
  readTools: Array<{ name: string; description: string }>;
  writeTools: Array<{ name: string; description: string }>;
}): SelectionDoc {
  const isBuiltin =
    i.slug.startsWith("custom:") ||
    i.slug.startsWith("builtin:") ||
    i.kind === "builtin" ||
    i.kind === "custom";
  const toolBlurbs = [...i.readTools, ...i.writeTools]
    .slice(0, 12)
    .map((t) => `${t.name}: ${truncate(t.description, 80)}`);
  const useWhen = syntheticUseWhen(i.label, toolBlurbs.join(" "), [
    ...toolBlurbs.slice(0, 4).map((b) => b.split(":")[0]!.trim()),
  ]);
  return {
    id: i.slug,
    hub: isBuiltin ? "builtin" : "mcp",
    name: i.label || i.slug,
    description: toolBlurbs.join("; "),
    text: [i.slug, i.label, ...toolBlurbs, ...useWhen].join("\n"),
    useWhen,
  };
}

export function enrichSkillDoc(s: {
  slug: string;
  name: string;
  description: string;
  content?: string;
}): SelectionDoc {
  const contentSummary = truncate((s.content ?? "").replace(/\s+/g, " "), 240);
  const useWhen = syntheticUseWhen(s.name, s.description || contentSummary, [
    contentSummary ? `following procedure ${s.slug}` : `skill ${s.slug}`,
  ]);
  return {
    id: s.slug,
    hub: "skill",
    name: s.name,
    description: s.description || contentSummary,
    text: [s.slug, s.name, s.description, contentSummary, ...useWhen].join("\n"),
    useWhen,
  };
}

export function enrichKnowledgeDoc(k: { id: string; name: string }): SelectionDoc {
  const useWhen = syntheticUseWhen(k.name, "knowledge collection", [
    "answering from product docs",
    "looking up handbook or wiki",
  ]);
  return {
    id: k.id,
    hub: "knowledge",
    name: k.name,
    description: "knowledge collection",
    text: [k.name, k.id, ...useWhen].join("\n"),
    useWhen,
  };
}
