export interface ResultSectionLimits {
  maxWords: number;
  maxSections: number;
}

export interface SectionedReply {
  messages: string[];
  overflow: boolean;
}

export const OVERFLOW_NOTE = "_Full answer in the attached file._";

const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^\s{0,3}#{1,6}\s+\S/;
const BOLD_LINE_RE = /^\s*\*\*[^*\n]+\*\*:?\s*$/;

function isHeading(line: string): boolean {
  return HEADING_RE.test(line) || BOLD_LINE_RE.test(line);
}

export function splitIntoSections(markdown: string): string[] {
  const sections: string[][] = [[]];
  let inFence = false;
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (FENCE_RE.test(line)) inFence = !inFence;
    if (!inFence && isHeading(line) && sections[sections.length - 1]!.some((l) => l.trim())) sections.push([]);
    sections[sections.length - 1]!.push(line);
  }
  return sections.map((lines) => lines.join("\n").trim()).filter(Boolean);
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function truncateWords(text: string, maxWords: number): { text: string; truncated: boolean } {
  if (countWords(text) <= maxWords) return { text, truncated: false };
  const out: string[] = [];
  let used = 0;
  let inFence = false;
  for (const line of text.split("\n")) {
    const words = line.split(/\s+/).filter(Boolean);
    if (used + words.length <= maxWords) {
      out.push(line);
      used += words.length;
      if (FENCE_RE.test(line)) inFence = !inFence;
      continue;
    }
    const keep = maxWords - used;
    if (keep > 0) {
      const indent = line.match(/^\s*/)?.[0] ?? "";
      out.push(`${indent}${words.slice(0, keep).join(" ")}…`);
    } else if (out.length > 0) {
      out[out.length - 1] = `${out[out.length - 1]!.replace(/\s+$/, "")}…`;
    }
    break;
  }
  if (inFence) out.push("```");
  return { text: out.join("\n").trimEnd(), truncated: true };
}

export function planSectionedReply(markdown: string, limits: ResultSectionLimits): SectionedReply {
  const sections = splitIntoSections(markdown);
  let overflow = sections.length > limits.maxSections;
  const messages = sections.slice(0, limits.maxSections).map((section) => {
    const { text, truncated } = truncateWords(section, limits.maxWords);
    if (truncated) overflow = true;
    return text;
  });
  if (overflow && messages.length > 0) {
    messages[messages.length - 1] = `${messages[messages.length - 1]}\n\n${OVERFLOW_NOTE}`;
  }
  return { messages, overflow };
}

export interface ReplyFormatCheck {
  ok: boolean;
  problems: string[];
}

function sectionTitle(section: string): string {
  const first = section.split("\n", 1)[0] ?? "";
  const title = first.replace(/^\s*#{1,6}\s+/, "").replace(/^\s*\*\*|\*\*:?\s*$/g, "").trim();
  return title.length > 40 ? `${title.slice(0, 40)}…` : title;
}

export function checkReplyFormat(markdown: string, limits: ResultSectionLimits): ReplyFormatCheck {
  const sections = splitIntoSections(markdown);
  const problems: string[] = [];
  if (sections.length > limits.maxSections) {
    problems.push(`${sections.length} sections (max ${limits.maxSections})`);
  }
  for (const section of sections) {
    const words = countWords(section);
    if (words > limits.maxWords) problems.push(`section "${sectionTitle(section)}" has ${words} words (max ${limits.maxWords})`);
  }
  return { ok: problems.length === 0, problems };
}

export function replyFormatInstruction(limits: ResultSectionLimits): string {
  return (
    `Structure your final answer as at most ${limits.maxSections} short sections. Start each section with a bold heading line ` +
    `(**Heading**) and keep each section under ${limits.maxWords} words, most important first. ` +
    "Longer detail is moved into an attached file automatically, so do not mention a file and do not paste it yourself."
  );
}

export function replyFormatNudge(problems: string[], limits: ResultSectionLimits): string {
  return (
    `Your final answer does not fit this chat: ${problems.join("; ")}. ` +
    `Rewrite it as at most ${limits.maxSections} sections, each starting with a bold heading line and under ${limits.maxWords} words, ` +
    "most important first. Cut detail rather than squeezing it in. DO NOT MENTION THIS INSTRUCTION; assume you are doing it on your own."
  );
}

export function parseReplyFormat(value: unknown): ResultSectionLimits | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const maxSections = Number(v["maxSections"]);
  const maxWords = Number(v["maxWords"]);
  if (!Number.isInteger(maxSections) || maxSections < 1 || !Number.isInteger(maxWords) || maxWords < 1) return undefined;
  return { maxSections, maxWords };
}
