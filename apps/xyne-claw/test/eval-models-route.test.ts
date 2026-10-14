import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evalJudgeRouter } from "../src/routes/eval-judge.js";

const ENV_KEYS = [
  "XOR_URL", "XOR_API_KEY", "XOR_MODEL", "XOR_BACKEND", "JUDGE_BACKEND", "OUR_JEV_URL", "OUR_JEV_API_KEY",
  "OUR_NORMAL_JEV_URL", "OUR_NORMAL_JEV_API_KEY", "OUR_NORMAL_JEV_MODEL", "LITELLM_URL", "LITELLM_API_KEY",
];

function modelsHandler(): (req: unknown, res: unknown) => Promise<void> {
  const layer = (evalJudgeRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: unknown }> } }> }).stack
    .find((l) => l.route?.path === "/eval-models");
  const handlers = layer!.route!.stack;
  return handlers[handlers.length - 1]!.handle as (req: unknown, res: unknown) => Promise<void>;
}

describe("GET /eval-models", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.unstubAllGlobals();
  });

  it("lists xor as the judge backend, with its label, separately from models", async () => {
    process.env["OUR_NORMAL_JEV_URL"] = "https://grid.example/v1/systemone";
    process.env["OUR_JEV_API_KEY"] = "k-ours";
    let body: { models?: string[]; judgeBackends?: string[]; judgeBackendLabels?: Record<string, string> } = {};
    await modelsHandler()({}, { json: (b: typeof body) => { body = b; } });
    expect(body.judgeBackends).toEqual(["xor"]);
    expect(body.judgeBackendLabels).toEqual({ xor: "Xor (our Jev)" });
    expect(body.models).not.toContain("jev");
    expect(body.models).not.toContain("xor");
  });

  it("reports no judge backends when none are configured", async () => {
    let body: { judgeBackends?: string[]; judgeBackendLabels?: Record<string, string> } = {};
    await modelsHandler()({}, { json: (b: typeof body) => { body = b; } });
    expect(body.judgeBackends).toEqual([]);
    expect(body.judgeBackendLabels).toEqual({});
  });
});
