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
// All five filesystem tools below (read/write/grep/find/ls) are path-gated
// to the session working directory. Pi v0.75+ factories now take a `cwd`
// argument and gate themselves at the tool layer; the gatePathParam wrapper
// here is defense-in-depth (catches absolute paths that bypass pi's relative
// resolution) plus a uniform error shape across both layers. Without ANY
// gating, `grep -r LITELLM_API_KEY /` would walk the whole claw container.

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
  workingDir: string,
  raw: unknown,
  opts: GateOptions,
): string | null {
  if (typeof raw !== "string" || !raw) {
    return opts.allowMissingPath ? null : `path is required`;
  }
  const absolute = isAbsolute(raw) ? resolvePath(raw) : resolvePath(workingDir, raw);
  if (!isWithin(absolute, workingDir)) {
    return `path ${raw} is outside the session working directory`;
  }
  return null;
}

function gatePathParam<T extends AgentTool<any, any>>(
  inner: T,
  workingDir: string,
  opts: GateOptions = {},
): T {
  const originalExecute = inner.execute.bind(inner);
  const wrapped: AgentTool<any, any> = {
    ...inner,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const err = denyOutside(workingDir, (params as Record<string, unknown>)?.["path"], opts);
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

export function createScopedTools(workingDir: string): CodingTool[] {
  const root = resolvePath(workingDir);
  return [
    gatePathParam(createReadTool(root), root),
    gatePathParam(createWriteTool(root), root),
    gatePathParam(createGrepTool(root), root, { allowMissingPath: true }),
    gatePathParam(createFindTool(root), root, { allowMissingPath: true }),
    gatePathParam(createLsTool(root), root, { allowMissingPath: true }),
  ] as CodingTool[];
}

/**
 * Same scoped tools as createScopedTools, keyed by their built-in name.
 * This shape is what AgentSession.baseToolsOverride expects when we want
 * pi's default registry to use OUR cwd-scoped versions in place of the
 * built-ins under the SAME names (read/write/grep/find/ls). The LLM still
 * sees the standard tool names.
 */
export function createScopedToolMap(workingDir: string): Record<string, CodingTool> {
  const root = resolvePath(workingDir);
  return {
    read: gatePathParam(createReadTool(root), root),
    write: gatePathParam(createWriteTool(root), root),
    grep: gatePathParam(createGrepTool(root), root, { allowMissingPath: true }),
    find: gatePathParam(createFindTool(root), root, { allowMissingPath: true }),
    ls: gatePathParam(createLsTool(root), root, { allowMissingPath: true }),
  };
}
