import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_JUDGE_BACKEND,
  SYSTEM_ONE_BACKEND_NAMES,
  activeJudgeBackend,
  resolveJudgeBackend,
  shadowJudgeBackends,
} from "../src/judge-backend.js";

const saved = { backend: process.env["JUDGE_BACKEND"], shadow: process.env["JUDGE_SHADOW"] };

afterEach(() => {
  if (saved.backend === undefined) delete process.env["JUDGE_BACKEND"];
  else process.env["JUDGE_BACKEND"] = saved.backend;
  if (saved.shadow === undefined) delete process.env["JUDGE_SHADOW"];
  else process.env["JUDGE_SHADOW"] = saved.shadow;
});

describe("judge backends", () => {
  it("no longer registers the hosted Jev service", () => {
    expect(SYSTEM_ONE_BACKEND_NAMES).toEqual(["ournormaljev", "ourtrainedjev"]);
    expect(DEFAULT_JUDGE_BACKEND).toBe("ournormaljev");
  });

  it("maps the legacy jev name to our normal Jev and rejects unknown names", () => {
    expect(resolveJudgeBackend("jev")).toBe("ournormaljev");
    expect(resolveJudgeBackend(" JEV ")).toBe("ournormaljev");
    expect(resolveJudgeBackend("ourtrainedjev")).toBe("ourtrainedjev");
    expect(resolveJudgeBackend("llm")).toBe("llm");
    expect(resolveJudgeBackend("typesafe")).toBeNull();
    expect(resolveJudgeBackend(undefined)).toBeNull();
  });

  it("defaults to our normal Jev, and treats JUDGE_BACKEND=jev the same", () => {
    delete process.env["JUDGE_BACKEND"];
    expect(activeJudgeBackend()).toBe("ournormaljev");
    process.env["JUDGE_BACKEND"] = "jev";
    expect(activeJudgeBackend()).toBe("ournormaljev");
    process.env["JUDGE_BACKEND"] = "ourtrainedjev";
    expect(activeJudgeBackend()).toBe("ourtrainedjev");
  });

  it("drops a shadow that resolves to the primary and de-duplicates the rest", () => {
    process.env["JUDGE_SHADOW"] = "jev, llm, ournormaljev, llm, bogus";
    expect(shadowJudgeBackends("ournormaljev")).toEqual(["llm"]);
  });
});
