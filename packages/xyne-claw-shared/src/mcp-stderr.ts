import type { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Logger } from "./logger.js";

/**
 * Forward a stdio MCP child's stderr through the structured logger, one log
 * record per line, so secrets in it are shredded like any other log field.
 * The listener also keeps the pipe drained, so a chatty child never blocks.
 * The transport must be created with `stderr: "pipe"`.
 */
export function forwardChildStderr(transport: StdioClientTransport, log: Logger, serverType: string): void {
  const stream = transport.stderr;
  if (!stream) return;
  let pending = "";
  stream.on("data", (chunk: string | Buffer) => {
    pending += chunk.toString();
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) log.info("mcp child stderr", { serverType, line });
    }
    // A child that never prints a newline must not grow this buffer unbounded.
    if (pending.length > 65536) {
      log.info("mcp child stderr", { serverType, line: pending });
      pending = "";
    }
  });
  stream.on("end", () => {
    if (pending.trim()) log.info("mcp child stderr", { serverType, line: pending });
    pending = "";
  });
}
