import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../config.js", () => ({
  CONFIG: { xyneClawUrl: "http://claw.test", xyneClawS2sKey: "s2s-test-key" },
}));

import { listEvalModels } from "./evalJudgeClient.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function modelsReply(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("listEvalModels judgeBackends", () => {
  it("passes judgeBackends through without mixing them into models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        modelsReply({ success: true, models: ["open-fast"], defaultModel: "open-fast", judgeBackends: ["jev", "ournormaljev", "ourtrainedjev"], judgeBackendLabels: { jev: "Jev (typed evaluator)", ournormaljev: "Our Jev — normal", ourtrainedjev: "Our Jev — trained", bogus: 7 } }),
      ),
    );
    const out = await listEvalModels();
    expect(out.models).toEqual(["open-fast"]);
    expect(out.judgeBackends).toEqual(["jev", "ournormaljev", "ourtrainedjev"]);
    expect(out.judgeBackendLabels).toEqual({
      jev: "Jev (typed evaluator)",
      ournormaljev: "Our Jev — normal",
      ourtrainedjev: "Our Jev — trained",
    });
  });

  it("defaults judgeBackends to [] when claw omits it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => modelsReply({ success: true, models: ["open-fast"], defaultModel: "" })));
    expect((await listEvalModels()).judgeBackends).toEqual([]);
  });

  it("returns empty lists when claw is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect(await listEvalModels()).toEqual({ models: [], defaultModel: "", judgeBackends: [], judgeBackendLabels: {}, optimizations: [] });
  });

  it("appends judge backends for the judge picker but not for gen-models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        modelsReply({ success: true, models: ["open-fast"], defaultModel: "open-fast", judgeBackends: ["jev"] }),
      ),
    );
    const { models, judgeBackends } = await listEvalModels();
    const judgePicker = [...models, ...judgeBackends.filter((b) => !models.includes(b))];
    expect(judgePicker).toEqual(["open-fast", "jev"]);
    expect(models).toEqual(["open-fast"]);
  });
});
