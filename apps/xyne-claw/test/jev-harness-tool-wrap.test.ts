import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { capCustomToolOutput } from "../src/agent.js";
import { pinRunOptimizations } from "../src/optimizations.js";
import { currentToolCall } from "../src/tool-call-context.js";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jev-wrap-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakeTool(seen: unknown[]) {
  return {
    name: "spaces-search",
    label: "s",
    description: "d",
    parameters: { type: "object", properties: { q: { type: "string" } } },
    async execute(_id: string, params: unknown) {
      seen.push({ params, call: currentToolCall() });
      return { content: [{ type: "text", text: "ok" }], details: {} };
    },
  } as never;
}

describe("capCustomToolOutput + per-call sift switch", () => {
  it("with jev_result_sift on: schema gets `sift`, and it is stripped before the tool runs", async () => {
    await new Promise<void>((resolve, reject) => {
      setImmediate(async () => {
        try {
          pinRunOptimizations("+jev_result_sift");
          const seen: Array<{ params: unknown; call: unknown }> = [];
          const [tool] = capCustomToolOutput([fakeTool(seen)], dir) as unknown as Array<{
            parameters: { properties: Record<string, unknown> };
            execute: (...a: unknown[]) => Promise<unknown>;
          }>;
          expect(tool!.parameters.properties["sift"]).toBeDefined();
          await tool!.execute("c1", { q: "x", sift: false });
          expect(seen[0]!.params).toEqual({ q: "x" });
          expect(seen[0]!.call).toMatchObject({ tool: "spaces-search", args: { q: "x" }, sift: false });
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it("with it off: schema unchanged", async () => {
    await new Promise<void>((resolve, reject) => {
      setImmediate(() => {
        try {
          pinRunOptimizations("-jev_result_sift");
          const [tool] = capCustomToolOutput([fakeTool([])], dir) as unknown as Array<{ parameters: { properties: Record<string, unknown> } }>;
          expect(tool!.parameters.properties["sift"]).toBeUndefined();
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it("a tool's own `sift` parameter is never stripped", async () => {
    await new Promise<void>((resolve, reject) => {
      setImmediate(async () => {
        try {
          pinRunOptimizations("+jev_result_sift");
          const seen: Array<{ params: unknown }> = [];
          const own = {
            name: "own-sift",
            label: "s",
            description: "d",
            parameters: { type: "object", properties: { sift: { type: "string" } } },
            async execute(_id: string, params: unknown) {
              seen.push({ params });
              return { content: [{ type: "text", text: "ok" }], details: {} };
            },
          } as never;
          const [tool] = capCustomToolOutput([own], dir) as unknown as Array<{ execute: (...a: unknown[]) => Promise<unknown> }>;
          await tool!.execute("c1", { sift: "coarse" });
          expect(seen[0]!.params).toEqual({ sift: "coarse" });
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });
});
