/** Builtin MCP servers: `<name>.ts` in this directory, launched as `xyne-mcp-server <name>`. */
import { fileURLToPath } from "node:url";
import { BUILTIN_SERVERS } from "xyne-claw-mcp-common/launch-policy";

/** Absolute path of a builtin server's entry file. */
export function builtinServerPath(name: string): string {
  if (!BUILTIN_SERVERS.has(name)) throw new Error(`unknown builtin MCP server ${name}`);
  return fileURLToPath(new URL(`./${name}.ts`, import.meta.url));
}
