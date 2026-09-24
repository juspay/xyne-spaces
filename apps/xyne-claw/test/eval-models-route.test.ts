import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evalJudgeRouter } from "../src/routes/eval-judge.js";

const ENV_KEYS = [
  "JEV_API_KEY", "JEV_URL", "OUR_JEV_URL", "OUR_JEV_API_KEY",
  "OUR_NORMAL_JEV_URL", "OUR_NORMAL_JEV_API_KEY", "OUR_NORMAL_JEV_MODEL", "OUR_TRAINED_JEV_URL", "OUR_TRAINED_JEV_API_KEY", "OUR_TRAINED_JEV_MODEL",
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

  it("lists configured judge backends separately from models", async () => {
    process.env["JEV_API_KEY"] = "k-jev";
    let body: { models?: string[]; judgeBackends?: string[] } = {};
    await modelsHandler()({}, { json: (b: typeof body) => { body = b; } });
    expect(body.judgeBackends).toEqual(["jev"]);
    expect(body.models).not.toContain("jev");
    expect(body.models).not.toContain("ournormaljev");
    expect(body.models).not.toContain("ourtrainedjev");
  });

  it("lists both of our Jev variants with labels once each is distinguishable", async () => {
    process.env["JEV_API_KEY"] = "k-jev";
    process.env["OUR_JEV_URL"] = "https://ourjev.internal/v1/systemone";
    process.env["OUR_JEV_API_KEY"] = "k-ours";
    process.env["OUR_NORMAL_JEV_MODEL"] = "our-jev-base";
    process.env["OUR_TRAINED_JEV_MODEL"] = "our-jev-ft-v3";
    let body: { models?: string[]; judgeBackends?: string[]; judgeBackendLabels?: Record<string, string> } = {};
    await modelsHandler()({}, { json: (b: typeof body) => { body = b; } });
    expect(body.judgeBackends).toEqual(["jev", "ournormaljev", "ourtrainedjev"]);
    expect(body.judgeBackendLabels).toEqual({
      jev: "Jev (typed evaluator)",
      ournormaljev: "Our Jev — normal",
      ourtrainedjev: "Our Jev — trained",
    });
  });

  it("reports no judge backends when none are configured", async () => {
    let body: { judgeBackends?: string[] } = {};
    await modelsHandler()({}, { json: (b: typeof body) => { body = b; } });
    expect(body.judgeBackends).toEqual([]);
  });
});
