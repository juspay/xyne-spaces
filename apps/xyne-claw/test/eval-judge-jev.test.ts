import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jevScoreFromProbabilities, judgeSemanticMatch } from "../src/eval-judge.js";

const ENV_KEYS = [
  "JEV_API_KEY", "JEV_URL", "JEV_MODEL", "OUR_JEV_URL", "OUR_JEV_API_KEY",
  "OUR_NORMAL_JEV_URL", "OUR_NORMAL_JEV_API_KEY", "OUR_NORMAL_JEV_MODEL", "OUR_TRAINED_JEV_URL", "OUR_TRAINED_JEV_API_KEY", "OUR_TRAINED_JEV_MODEL",
  "JUDGE_BACKEND", "JUDGE_SHADOW",
];

function systemOneReply(values: Record<string, number>): Response {
  const answers = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { type: "noul", noul: v }]));
  return new Response(JSON.stringify({ answers }), { status: 200 });
}

describe("jevScoreFromProbabilities", () => {
  const LIVE = {
    paraphrase: { same: 0.98, minor: 0.49, misses: 0.06, contradicts: 0.02, empty: 0.01 },
    minorGap: { same: 0.27, minor: 0.92, misses: 0.85, contradicts: 0.06, empty: 0.01 },
    partial: { same: 0.09, minor: 0.19, misses: 0.96, contradicts: 0.5, empty: 0.03 },
    wrong: { same: 0.01, minor: 0.01, misses: 0.97, contradicts: 0.98, empty: 0.09 },
    refusal: { same: 0.01, minor: 0.01, misses: 0.93, contradicts: 0.88, empty: 0.99 },
    unrelated: { same: 0, minor: 0.01, misses: 0.94, contradicts: 0.99, empty: 0.99 },
  };
  const score = (p: Parameters<typeof jevScoreFromProbabilities>[0]): number => jevScoreFromProbabilities(p) ?? -1;

  it("places probabilities recorded from live Jev in the rubric band each answer belongs to", () => {
    expect(score(LIVE.paraphrase)).toBeGreaterThanOrEqual(90);
    expect(score(LIVE.minorGap)).toBeGreaterThanOrEqual(70);
    expect(score(LIVE.minorGap)).toBeLessThanOrEqual(89);
    expect(score(LIVE.partial)).toBeGreaterThanOrEqual(40);
    expect(score(LIVE.partial)).toBeLessThanOrEqual(69);
    expect(score(LIVE.wrong)).toBeLessThan(40);
    expect(score(LIVE.refusal)).toBe(0);
    expect(score(LIVE.unrelated)).toBe(0);
  });

  it("is not dragged out of band by the baseline `empty` noise our self-hosted models report", () => {
    const GRID = {
      normalParaphrase: { same: 0.94, minor: 0.72, misses: 0.22, contradicts: 0.1, empty: 0.11 },
      trainedParaphrase: { same: 0.94, minor: 0.79, misses: 0.19, contradicts: 0.05, empty: 0.08 },
      normalWrong: { same: 0.08, minor: 0.14, misses: 0.63, contradicts: 0.88, empty: 0.16 },
      trainedRefusal: { same: 0.04, minor: 0.06, misses: 0.45, contradicts: 0.88, empty: 0.23 },
    };
    expect(score(GRID.normalParaphrase)).toBeGreaterThanOrEqual(90);
    expect(score(GRID.trainedParaphrase)).toBeGreaterThanOrEqual(90);
    expect(score(GRID.normalWrong)).toBeLessThan(15);
    expect(score(GRID.trainedRefusal)).toBeLessThan(15);
  });

  it("still penalises a genuinely elevated `empty` that stops short of the hard cutoff", () => {
    expect(score({ same: 0.9, empty: 0.4 })).toBeLessThan(score({ same: 0.9, empty: 0.1 }));
  });

  it("keeps the live cases in the right order", () => {
    const ordered = [LIVE.paraphrase, LIVE.minorGap, LIVE.partial, LIVE.wrong, LIVE.refusal].map(score);
    expect([...ordered].sort((a, b) => b - a)).toEqual(ordered);
  });

  it("does not let an overlapping weaker signal drag a confident answer out of its band", () => {
    expect(score({ same: 0.98, minor: 0.49 })).toBeGreaterThanOrEqual(90);
    expect(score({ same: 1, minor: 1, misses: 1 })).toBeGreaterThanOrEqual(90);
    expect(score({ minor: 0.92, misses: 0.85 })).toBeGreaterThanOrEqual(70);
  });

  it("stays inside each band at the extremes", () => {
    expect(score({ same: 1 })).toBe(100);
    expect(score({ same: 0.5, minor: 1 })).toBeGreaterThanOrEqual(90);
    expect(score({ minor: 1 })).toBe(89);
    expect(score({ minor: 0.5, misses: 1 })).toBe(70);
    expect(score({ misses: 1 })).toBeGreaterThanOrEqual(40);
    expect(score({ misses: 1 })).toBeLessThanOrEqual(69);
    expect(score({ contradicts: 1 })).toBe(1);
  });

  it("gives an empty/refusal answer 0 even when other signals are high", () => {
    expect(score({ empty: 1, same: 1 })).toBe(0);
    expect(score({ empty: 0.8, same: 1 })).toBe(0);
  });

  it("sends a confident contradiction to the bottom band even when same-meaning is also high", () => {
    expect(score({ misses: 0.9, contradicts: 0.9 })).toBeLessThan(40);
    expect(score({ same: 0.9, contradicts: 0.6 })).toBeLessThan(40);
    expect(score({ same: 0.9, contradicts: 0.55 })).toBeGreaterThanOrEqual(90);
  });

  it("clamps out-of-range input and refuses to invent a score from no signal", () => {
    expect(score({ same: 5 })).toBe(100);
    expect(jevScoreFromProbabilities({ same: -3, minor: Number.NaN })).toBeNull();
    expect(jevScoreFromProbabilities({})).toBeNull();
  });
});

describe("judgeSemanticMatch via a jev backend", () => {
  const saved: Record<string, string | undefined> = {};
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.unstubAllGlobals();
  });

  it("grades with the hosted jev backend", async () => {
    process.env["JEV_API_KEY"] = "k-jev";
    fetchMock.mockResolvedValue(systemOneReply({ same: 0.95, minor: 0.1, misses: 0, contradicts: 0, empty: 0 }));
    const result = await judgeSemanticMatch({ expected: "a", generated: "a", model: "JEV " });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://api.typesafe.ai/v1/systemone");
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer k-jev" });
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.reasoning).toContain("jev:");
    expect(result.reasoning.length).toBeLessThanOrEqual(200);
  });

  it("grades with our self-hosted backend at its own url and key", async () => {
    process.env["OUR_JEV_URL"] = "https://ourjev.internal/v1/systemone";
    process.env["OUR_JEV_API_KEY"] = "k-ours";
    process.env["OUR_TRAINED_JEV_MODEL"] = "our-jev-ft-v3";
    fetchMock.mockResolvedValue(systemOneReply({ same: 0, minor: 0, misses: 0, contradicts: 0, empty: 1 }));
    const result = await judgeSemanticMatch({ expected: "a", generated: "", model: "ourtrainedjev" });
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://ourjev.internal/v1/systemone");
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer k-ours" });
    expect(result.score).toBe(0);
  });

  it("fails open when the backend is not configured", async () => {
    const result = await judgeSemanticMatch({ expected: "a", generated: "b", model: "ournormaljev" });
    expect(result).toEqual({ score: null, reasoning: "judge_unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails open when jev returns an error", async () => {
    process.env["JEV_API_KEY"] = "k-jev";
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    const result = await judgeSemanticMatch({ expected: "a", generated: "b", model: "jev" });
    expect(result).toEqual({ score: null, reasoning: "judge_unavailable" });
  });
});
