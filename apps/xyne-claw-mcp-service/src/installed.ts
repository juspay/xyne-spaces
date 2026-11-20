/**
 * Maps a stdio launch to the process to start, using only what is installed in
 * the image:
 *   npx -y <spec> <args>          → node <MCP_NPM_DIR>/node_modules/<pkg>/<bin> <args>
 *   uvx [--with d]* <spec> <args> → <MCP_PY_DIR>/<venv>/bin/<bin> <args>
 *   <binary> <args>               → <MCP_BIN_DIR>/<binary> <args> (INSTALLED_BINARIES)
 *   node <args>                   → this process's node binary
 * Throws NotInstalledError when the package is not installed.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { findInstalledUvx, INSTALLED_BINARIES, INSTALLED_NPX_SPECS, npxPackageName } from "xyne-claw-mcp-common/launch-policy";

export const NPM_DIR = process.env["MCP_NPM_DIR"] ?? "/opt/mcp/npm";
export const PY_DIR = process.env["MCP_PY_DIR"] ?? "/opt/mcp/py";
export const BIN_DIR = process.env["MCP_BIN_DIR"] ?? "/opt/mcp/bin";

export class NotInstalledError extends Error {
  constructor(what: string) {
    super(`MCP server ${what} is not installed in this image`);
    this.name = "NotInstalledError";
  }
}

/** The file `npx <pkg>` would run: its `bin` (the one named after the package, else the first), else `main`. */
export function npmEntrypoint(pkgDir: string, name: string): string {
  const pj = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
    bin?: string | Record<string, string>;
    main?: string;
  };
  const shortName = name.includes("/") ? name.slice(name.indexOf("/") + 1) : name;
  let rel: string | undefined;
  if (typeof pj.bin === "string") rel = pj.bin;
  else if (pj.bin && typeof pj.bin === "object") rel = pj.bin[shortName] ?? Object.values(pj.bin)[0];
  return path.join(pkgDir, rel ?? pj.main ?? "index.js");
}

function npxCommand(args: string[], npmDir: string): { command: string; args: string[] } {
  const spec = args[1] ?? "";
  if (args[0] !== "-y" || !INSTALLED_NPX_SPECS.includes(spec)) throw new NotInstalledError(`npx ${args.join(" ")}`);
  const name = npxPackageName(spec);
  const pkgDir = path.join(npmDir, "node_modules", name);
  if (!existsSync(path.join(pkgDir, "package.json"))) throw new NotInstalledError(spec);
  const version = spec.slice(name.length + 1);
  const installed = (JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")) as { version?: string }).version;
  if (version && installed !== version) throw new NotInstalledError(`${spec} (image has ${installed ?? "no version"})`);
  const entry = npmEntrypoint(pkgDir, name);
  if (!existsSync(entry)) throw new NotInstalledError(`${spec} (entry file missing)`);
  return { command: process.execPath, args: [entry, ...args.slice(2)] };
}

function uvxCommand(args: string[], pyDir: string): { command: string; args: string[] } {
  const found = findInstalledUvx(args);
  if (!found) throw new NotInstalledError(`uvx ${args.join(" ")}`);
  const bin = path.join(pyDir, found.installed.venv, "bin", found.installed.bin);
  if (!existsSync(bin)) throw new NotInstalledError(found.installed.spec);
  return { command: bin, args: found.rest };
}

/** The process to start for a (policy-checked) stdio launch. */
export function resolveStdioCommand(
  cmd: string,
  args: string[],
  dirs: { npmDir?: string; pyDir?: string; binDir?: string } = {},
): { command: string; args: string[] } {
  if (cmd === "npx") return npxCommand(args, dirs.npmDir ?? NPM_DIR);
  if (cmd === "uvx") return uvxCommand(args, dirs.pyDir ?? PY_DIR);
  if (cmd === "node") return { command: process.execPath, args };
  if (INSTALLED_BINARIES.some((b) => b.name === cmd)) {
    const bin = path.join(dirs.binDir ?? BIN_DIR, cmd);
    if (!existsSync(bin)) throw new NotInstalledError(cmd);
    return { command: bin, args };
  }
  return { command: cmd, args };
}
