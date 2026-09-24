/**
 * Split compound shell for policy evaluation. Unsplittable syntax requires
 * human approval. Runs in the gateway / Kata parent — never as user hooks
 * inside xyne-claw.
 */

const CHAIN_SPLIT = /\s*(?:&&|\|\||;|\|)\s*/;

const UNSPLITTABLE =
  /(\$\(|\`|\$\{|[<>]{1,2}|\bfor\b|\bwhile\b|\buntil\b|\bif\b|\bcase\b)/i;

export type ShellSplitResult =
  | { ok: true; splittable: true; commands: string[] }
  | { ok: true; splittable: false; reason: string; raw: string };

export function splitShellCommand(raw: string): ShellSplitResult {
  const command = raw.trim();
  if (!command) {
    return { ok: true, splittable: true, commands: [] };
  }
  if (UNSPLITTABLE.test(command)) {
    return {
      ok: true,
      splittable: false,
      reason: "Command uses substitution, redirects, or control flow — require approval as a whole.",
      raw: command,
    };
  }
  const commands = command
    .split(CHAIN_SPLIT)
    .map((part) => part.trim())
    .filter(Boolean);
  return { ok: true, splittable: true, commands };
}

export type ShellPolicyDecision = "allow" | "prompt" | "forbidden";

/**
 * Evaluate each segment. forbidden ≻ prompt ≻ allow.
 */
export function decideShellPolicy(
  raw: string,
  decideSegment: (segment: string) => ShellPolicyDecision,
): { decision: ShellPolicyDecision; segments: string[]; reason?: string } {
  const split = splitShellCommand(raw);
  if (!split.ok) {
    return { decision: "prompt", segments: [raw] };
  }
  if (!split.splittable) {
    return { decision: "prompt", segments: [raw], reason: split.reason };
  }
  let worst: ShellPolicyDecision = "allow";
  for (const segment of split.commands) {
    const d = decideSegment(segment);
    if (d === "forbidden") return { decision: "forbidden", segments: split.commands };
    if (d === "prompt") worst = "prompt";
  }
  return { decision: worst, segments: split.commands };
}
