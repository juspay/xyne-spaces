/**
 * How a model is presented to people: a short name ("Sonnet 4.5") and one
 * line on what it is good for. Every model list claw-auth serves
 * (`GET /agent-chat/:slug/litellm-models`) runs through here, so the AI
 * screen, the Ask AI sidebar and claw v3 all show the same words, and
 * changing them is a claw-auth change only.
 */

export interface ModelLabel {
  name: string;
  description?: string;
}

const titleWord = (word: string): string =>
  /[a-z]/i.test(word) ? word.charAt(0).toUpperCase() + word.slice(1) : word;

/**
 * "claude-sonnet-4-5-20250929" → "Sonnet 4.5", "hosted_vllm/gpt-4o-mini" →
 * "GPT-4o mini". Unknown ids keep their own words, title-cased, so a model is
 * never renamed into something it isn't.
 */
export function modelDisplayName(id: string): string {
  const base = (id.split("/").pop() ?? id)
    .replace(/[-@]\d{8}$/, "")
    .replace(/-latest$/, "")
    .toLowerCase();
  const claude = /claude-(opus|sonnet|haiku|fable)-(\d+)(?:[-.](\d{1,2}))?(?:-|$)/.exec(base);
  if (claude) return `${titleWord(claude[1]!)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}`;
  const legacyClaude = /claude-(\d+)(?:[-.](\d))?-(opus|sonnet|haiku)/.exec(base);
  if (legacyClaude) {
    return `${titleWord(legacyClaude[3]!)} ${legacyClaude[1]}${legacyClaude[2] ? `.${legacyClaude[2]}` : ""}`;
  }
  const gpt = /^gpt-([\d.]+o?)(?:-(.+))?$/.exec(base);
  if (gpt) return `GPT-${gpt[1]}${gpt[2] ? ` ${gpt[2].replace(/-/g, " ")}` : ""}`;
  return base.split(/[-_]/).filter(Boolean).map(titleWord).join(" ");
}

/** One line under a model's name — only when its family says something true. */
export function modelDescription(id: string): string | undefined {
  const lower = id.toLowerCase();
  if (lower.startsWith("local-harness:")) return "Runs on your computer";
  if (/fable/.test(lower)) return "For your toughest challenges";
  if (/opus/.test(lower)) return "For complex tasks";
  if (/sonnet/.test(lower)) return "Most efficient for everyday tasks";
  if (/haiku|mini|nano|flash|lite|fast/.test(lower)) return "Fastest for quick answers";
  if (/\bpro\b|-pro|large|reason/.test(lower)) return "For complex tasks";
  return undefined;
}

/**
 * A list entry with its people-facing name and description. An entry that
 * already carries its own label (a local harness: "Claude Code (MacBook)")
 * keeps it.
 */
export function labelModel<T extends { id: string; name?: string }>(entry: T): T & ModelLabel {
  const hasOwnName = Boolean(entry.name) && entry.name !== entry.id;
  const description = modelDescription(entry.id);
  return {
    ...entry,
    name: hasOwnName ? entry.name! : modelDisplayName(entry.id),
    ...(description ? { description } : {}),
  };
}
