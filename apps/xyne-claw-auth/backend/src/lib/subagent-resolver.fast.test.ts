import { describe, expect, it } from "vitest";
import type { AppPrismaClient } from "../db.js";
import { SUBAGENT_TEMPLATES, loadTemplateSamples } from "xyne-claw-shared";
import { nextChecksVersion, toCustomSubagentSpec, validateSubagentInput, ValidationError } from "./subagent-resolver.js";

const prisma = {
  subagentDefinition: { findUnique: async () => null },
  skill: { findMany: async () => [] },
} as unknown as AppPrismaClient;

const base = {
  name: "log-triage",
  description: "Triage log lines",
  progressLabels: ["Triaging..."],
  systemPrompt: "You triage log lines.",
  paramDescription: "The log lines",
  tools: { custom: ["xor-decide"] },
};

const CHECKS = [
  { id: "failure", question: "Is this a real failure?", type: "yesno" },
  { id: "cause", question: "Cause?", type: "choice", options: { db: "database", auth: "auth" } },
];

const validate = (extra: Record<string, unknown>, isCreate = false) =>
  validateSubagentInput(prisma, { ...base, ...extra } as Parameters<typeof validateSubagentInput>[1], { isCreate, orgId: "org1" });

describe("fast subagent fields", () => {
  it("leaves every new field undefined when the body omits them, so older editors do not wipe them", async () => {
    const v = await validate({});
    expect(v).not.toHaveProperty("fast");
    expect(v).not.toHaveProperty("checks");
    expect(v).not.toHaveProperty("samples");
    expect(v).not.toHaveProperty("model");
    expect(v).not.toHaveProperty("budget");
  });

  it("accepts fast, checks, samples, model and budget", async () => {
    const v = await validate({
      fast: true,
      checks: CHECKS,
      samples: [{ input: "ERROR db refused", expected: { failure: true, cause: "db" }, label: "db outage" }],
      model: "open-fast",
      budget: { maxToolCalls: 20 },
    });
    expect(v.fast).toBe(true);
    expect(v.checks?.map((c) => c.id)).toEqual(["failure", "cause"]);
    expect(v.samples).toEqual([{ input: "ERROR db refused", expected: { failure: true, cause: "db" }, label: "db outage" }]);
    expect(v.model).toBe("open-fast");
    expect(v.budget).toEqual({ maxToolCalls: 20 });
  });

  it("treats null and empty values as a clear", async () => {
    const v = await validate({ checks: [], samples: null, model: "", budget: null });
    expect(v).toMatchObject({ checks: null, samples: null, model: null, budget: null });
  });

  it.each([
    [{ fast: "yes" }, "fast"],
    [{ checks: [{ id: "a", question: "x", type: "choice", options: { only: "one" } }] }, "checks"],
    [{ checks: CHECKS, samples: [{ input: "x", expected: { nope: true } }] }, "samples[0].expected"],
    [{ samples: [{ input: "", expected: {} }] }, "samples[0].input"],
    [{ samples: [{ input: "x", expected: { a: { nested: 1 } } }] }, "samples[0].expected.a"],
    [{ model: "open fast; drop" }, "model"],
    [{ budget: { maxToolCalls: 0 } }, "budget.maxToolCalls"],
    [{ budget: { maxToolCalls: 500 } }, "budget.maxToolCalls"],
  ])("rejects %j", async (extra, field) => {
    const err = await validate(extra).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).field).toBe(field);
  });
});

describe("nextChecksVersion", () => {
  const q = [{ id: "a", question: "x", type: "yesno" as const }];
  it("starts at 1 on create with checks and 0 without", () => {
    expect(nextChecksVersion(null, q)).toBe(1);
    expect(nextChecksVersion(null, null)).toBe(0);
  });
  it("bumps only when the checks change", () => {
    expect(nextChecksVersion({ checks: q, checksVersion: 3 }, q)).toBe(3);
    expect(nextChecksVersion({ checks: q, checksVersion: 3 }, [{ ...q[0]!, question: "y" }])).toBe(4);
    expect(nextChecksVersion({ checks: q, checksVersion: 3 }, undefined)).toBeUndefined();
  });
});

describe("toCustomSubagentSpec", () => {
  const row = {
    id: "sa1",
    name: "log-triage",
    description: "d",
    progressLabels: ["p"],
    systemPrompt: "s",
    paramName: "question",
    paramDescription: "pd",
    tools: { custom: ["xor-decide"] },
    mcpInstanceMap: null,
    fast: true,
    checks: CHECKS,
    checksVersion: 2,
    samples: [{ input: "x", expected: { failure: true } }],
    model: "open-fast",
    budget: { maxToolCalls: 15 },
    skills: [],
  } as unknown as Parameters<typeof toCustomSubagentSpec>[0];

  it("sends fast, model, budget and versioned checks to claw, never the samples", () => {
    const spec = toCustomSubagentSpec(row);
    expect(spec).toMatchObject({ fast: true, model: "open-fast", budget: { maxToolCalls: 15 }, checksVersion: 2 });
    expect(spec.checks?.map((c) => c.id)).toEqual(["failure", "cause"]);
    expect(spec).not.toHaveProperty("samples");
  });

  it("drops model and budget when the subagent is not fast", () => {
    const spec = toCustomSubagentSpec({ ...row, fast: false } as typeof row);
    expect(spec).not.toHaveProperty("fast");
    expect(spec).not.toHaveProperty("model");
    expect(spec).not.toHaveProperty("budget");
    expect(spec.checks).toHaveLength(2);
  });
});

describe("screenshot samples and templates", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgo=";

  it("accepts a screenshot sample without text and rejects bad images", async () => {
    const v = await validate({ checks: CHECKS, samples: [{ input: "", image: PNG, expected: { failure: true } }] });
    expect(v.samples).toEqual([{ input: "", image: PNG, expected: { failure: true } }]);
    const bad = await validate({ samples: [{ input: "", image: "https://x/y.png", expected: {} }] }).catch((e: unknown) => e);
    expect((bad as ValidationError).field).toBe("samples[0].image");
    const empty = await validate({ samples: [{ input: "", expected: {} }] }).catch((e: unknown) => e);
    expect((empty as ValidationError).field).toBe("samples[0].input");
  });

  it.each(SUBAGENT_TEMPLATES.map((t) => [t.id, t] as const))("the %s template with its samples passes create validation", async (_id, t) => {
    const samples = await loadTemplateSamples(t);
    const v = await validateSubagentInput(prisma, { ...t.defaults, samples } as Parameters<typeof validateSubagentInput>[1], { isCreate: true, orgId: "org1" });
    expect(v).toMatchObject({ name: t.defaults.name, fast: true, budget: t.defaults.budget });
    expect(v.samples).toHaveLength(samples.length);
    expect(v.checks?.length).toBe(t.defaults.checks.length);
  });
});
