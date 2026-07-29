import { isAbsolute, resolve as resolvePath, relative as relativePath } from "node:path";
import {
  createReadTool,
  createWriteTool,
  createGrepTool,
  createFindTool,
  createLsTool,
} from "@earendil-works/pi-coding-agent";
import type { AgentTool } from "@earendil-works/pi-agent-core";

// NOTE: scoped-bash-tool intentionally NOT imported. Even with the allowlist
// (ls/cat/head/grep/find/awk/sed/git/echo/...), bash leaks credentials —
// `cat /proc/self/environ`, `cat ~/.aws/credentials`, `echo $LITELLM_API_KEY`,
// `find / -name .env\*`, etc. are all reachable because path arguments to
// these commands are NOT gated to the session working directory.
//
// All five filesystem tools below (read/write/grep/find/ls) are path-gated.
// pi's own factories do NOT contain absolute paths (createReadTool's `cwd` is
// only the base for RELATIVE paths — verified in pi path-utils.resolveToCwd),
// so the gatePathParam wrapper here is the SOLE enforcement. Without it,
// `grep -r LITELLM_API_KEY /` would walk the whole claw container.
//
// Each tool gates against one or more allowed roots:
//   - WRITE is confined to the session working directory ONLY.
//   - READ/GREP/FIND/LS are confined to the working directory PLUS any
//     `readonlyRoots` (skill directories). Skills live OUTSIDE the working dir
//     — bundled skills under the repo `skills/` dir and session skills under
//     <dataDir>/session-skills/<id> — and pi advertises them to the model with
//     absolute paths, so the model must be able to READ (but not write) them.
//     readonlyRoots default to [] so a confined-only caller is unchanged.

type CodingTool = AgentTool<any>;

function isWithin(absPath: string, root: string): boolean {
  const rel = relativePath(root, absPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

interface GateOptions {
  /** Tool name for error messages — defaults to "tool". */
  toolName?: string;
  /** When true, missing path is OK — defaults to false (required). For
   * ls/find/grep we want to allow undefined path (tool defaults to CWD which
   * IS the gated workingDir). For read/write the inner tool requires it. */
  allowMissingPath?: boolean;
}

function denyOutside(
  roots: string[],
  raw: unknown,
  opts: GateOptions,
): string | null {
  if (typeof raw !== "string" || !raw) {
    return opts.allowMissingPath ? null : `path is required`;
  }
  // Relative paths resolve against the primary root (the session working dir,
  // always roots[0]); absolute paths are checked as-is against every allowed root.
  const absolute = isAbsolute(raw) ? resolvePath(raw) : resolvePath(roots[0]!, raw);
  if (!roots.some((root) => isWithin(absolute, root))) {
    return `path ${raw} is outside the session working directory`;
  }
  return null;
}

function gatePathParam<T extends AgentTool<any, any>>(
  inner: T,
  roots: string[],
  opts: GateOptions = {},
): T {
  const originalExecute = inner.execute.bind(inner);
  const wrapped: AgentTool<any, any> = {
    ...inner,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const err = denyOutside(roots, (params as Record<string, unknown>)?.["path"], opts);
      if (err) {
        return {
          content: [{ type: "text", text: `Error: ${err}` }],
          details: undefined as never,
        };
      }
      return originalExecute(toolCallId, params, signal, onUpdate);
    },
  };
  return wrapped as T;
}

export function createScopedTools(workingDir: string, readonlyRoots: string[] = []): CodingTool[] {
  const root = resolvePath(workingDir);
  // Read-only ops may also reach the skill dirs; write stays confined to root.
  const readRoots = [root, ...readonlyRoots.map((r) => resolvePath(r))];
  return [
    gatePathParam(createReadTool(root), readRoots),
    gatePathParam(createWriteTool(root), [root]),
    gatePathParam(createGrepTool(root), readRoots, { allowMissingPath: true }),
    gatePathParam(createFindTool(root), readRoots, { allowMissingPath: true }),
    gatePathParam(createLsTool(root), readRoots, { allowMissingPath: true }),
  ] as CodingTool[];
}

/**
 * Same scoped tools as createScopedTools, keyed by their built-in name.
 * This shape is what AgentSession.baseToolsOverride expects when we want
 * pi's default registry to use OUR cwd-scoped versions in place of the
 * built-ins under the SAME names (read/write/grep/find/ls). The LLM still
 * sees the standard tool names.
 */
export function createScopedToolMap(
  workingDir: string,
  readonlyRoots: string[] = [],
): Record<string, CodingTool> {
  const root = resolvePath(workingDir);
  // Read-only ops may also reach the skill dirs; write stays confined to root.
  const readRoots = [root, ...readonlyRoots.map((r) => resolvePath(r))];
  return {
    read: gatePathParam(createReadTool(root), readRoots),
    write: gatePathParam(createWriteTool(root), [root]),
    grep: gatePathParam(createGrepTool(root), readRoots, { allowMissingPath: true }),
    find: gatePathParam(createFindTool(root), readRoots, { allowMissingPath: true }),
    ls: gatePathParam(createLsTool(root), readRoots, { allowMissingPath: true }),
  };
}
