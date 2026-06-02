import { createBashTool } from "@earendil-works/pi-coding-agent";
import type { AgentTool } from "@earendil-works/pi-agent-core";

const DEFAULT_ALLOWLIST = new Set([
  "ls", "cat", "head", "tail", "wc", "stat", "file",
  "find", "grep", "rg", "ag",
  "git",
  "echo", "printf", "pwd", "whoami", "date", "uname",
  "which", "type", "command",
  "awk", "sed", "sort", "uniq", "cut", "tr",
  "jq",
  "true", "false",
]);

const GIT_SUBCOMMAND_ALLOWLIST = new Set([
  "status", "log", "diff", "show", "blame", "branch",
  "remote", "rev-parse", "rev-list", "cat-file", "ls-files",
  "describe", "config", "tag", "stash",
]);

const COMPOUND_SPLIT_RE = /\|\||&&|;|\||\n/;
const SUBSHELL_RE = /\$\([^)]*\)|`[^`]*`/g;

function extractCommandsFromString(raw: string): string[] {
  const withoutSubshells = raw.replace(SUBSHELL_RE, " ");
  return withoutSubshells
    .split(COMPOUND_SPLIT_RE)
    .map((seg) => seg.trim())
    .filter(Boolean);
}

function extractSubshellCommands(raw: string): string[] {
  const out: string[] = [];
  let match: RegExpExecArray | null;
  const re = /\$\(([^)]*)\)|`([^`]*)`/g;
  while ((match = re.exec(raw)) !== null) {
    const inner = match[1] ?? match[2] ?? "";
    if (inner.trim()) out.push(...extractCommandsFromString(inner));
  }
  return out;
}

function firstWord(segment: string): string {
  const trimmed = segment.replace(/^[\s({]+/, "");
  const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_+./-]*)/);
  return m?.[1] ?? "";
}

function isAllowed(segment: string): boolean {
  const cmd = firstWord(segment);
  if (!cmd) return false;
  if (cmd === "git") {
    const sub = segment.replace(/^\s*git\s+/, "").trim().split(/\s+/)[0] ?? "";
    return GIT_SUBCOMMAND_ALLOWLIST.has(sub);
  }
  return DEFAULT_ALLOWLIST.has(cmd);
}

const DENY_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /(^|\s)-exec(\s|$)/, reason: "-exec flag is not allowed (find -exec can spawn arbitrary commands)" },
  { re: /(^|\s)-execdir(\s|$)/, reason: "-execdir flag is not allowed" },
  { re: /\bsystem\s*\(/, reason: "system() calls inside awk/perl/etc are not allowed" },
  { re: /(^|[^<])>>?(?!=)/, reason: "output redirection (> or >>) is not allowed" },
  { re: /(^|\s)sed\s+[^|;&]*-i\b/, reason: "sed -i (in-place edit) is not allowed" },
  { re: /(^|\s)git\s+config\s+(?!--get|--list|-l\b|--get-regexp|--get-all|--show-origin|--show-scope)/, reason: "only read-only git config (--get/--list/--get-regexp/--get-all) is allowed" },
];

function validateCommand(command: string): { allowed: true } | { allowed: false; reason: string } {
  for (const { re, reason } of DENY_PATTERNS) {
    if (re.test(command)) return { allowed: false, reason };
  }
  const segments = [
    ...extractCommandsFromString(command),
    ...extractSubshellCommands(command),
  ];
  for (const seg of segments) {
    if (!isAllowed(seg)) {
      const cmd = firstWord(seg);
      if (cmd === "git") {
        const sub = seg.replace(/^\s*git\s+/, "").trim().split(/\s+/)[0] ?? "(none)";
        return { allowed: false, reason: `git ${sub} is not on the allowlist (allowed git subcommands: ${[...GIT_SUBCOMMAND_ALLOWLIST].sort().join(", ")})` };
      }
      return { allowed: false, reason: `command "${cmd || seg.slice(0, 40)}" is not on the allowlist (allowed: ${[...DEFAULT_ALLOWLIST].sort().join(", ")})` };
    }
  }
  return { allowed: true };
}

export function createScopedBashTool(cwd: string): AgentTool<any, any> {
  const inner = createBashTool(cwd);
  const wrapped: AgentTool<any, any> = {
    ...inner,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const command = (params as { command?: string }).command ?? "";
      const verdict = validateCommand(command);
      if (!verdict.allowed) {
        console.warn(`[bash-allowlist] REJECT cmd=${JSON.stringify(command).slice(0, 300)} reason=${verdict.reason}`);
        return {
          content: [{ type: "text", text: `Error: ${verdict.reason}` }],
          details: undefined as never,
        };
      }
      // Pi v0.75 narrowed the inner bash tool's params type from `unknown` to
      // `{ command: string; timeout?: number }`. The wrapper still receives
      // params as `unknown` (its own execute signature), so we cast through.
      return inner.execute(toolCallId, params as { command: string; timeout?: number }, signal, onUpdate);
    },
  };
  return wrapped;
}
