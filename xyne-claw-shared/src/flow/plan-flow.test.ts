import { describe, it, expect } from "vitest";
import { buildPlanFlow, PLAN_COMPONENT_ID, type Todo } from "./plan-flow.js";

/** Pull the single `plan` component out of a built flow. */
function planComponent(flow: ReturnType<typeof buildPlanFlow>) {
  expect(flow.components).toHaveLength(1);
  const c = flow.components[0]!;
  expect(c.id).toBe(PLAN_COMPONENT_ID);
  expect(c.type).toBe("plan");
  return c.props as Record<string, unknown>;
}

describe("buildPlanFlow", () => {
  it("emits a proposed plan with {id,text,included} todos (all included)", () => {
    const flow = buildPlanFlow(
      [
        { id: "t1", title: "Search #general" },
        { id: "t2", title: "Summarize" },
      ],
      { phase: "proposed", title: "My Plan", desc: "why" },
    );
    const props = planComponent(flow);
    expect(props["phase"]).toBe("proposed");
    expect(props["title"]).toBe("My Plan");
    expect(props["desc"]).toBe("why");
    expect(props["todos"]).toEqual([
      { id: "t1", text: "Search #general", included: true },
      { id: "t2", text: "Summarize", included: true },
    ]);
    // Routing/data for flow-action lives on flow.data, not the component props.
    expect(flow.data).toMatchObject({ kind: "plan" });
    expect(flow.screenId).toBe("agent-plan");
  });

  it("maps internal Todo status → exec status for executing/done phases", () => {
    const todos: Todo[] = [
      { id: "a", title: "one", status: "pending" },
      { id: "b", title: "two", status: "in_progress" },
      { id: "c", title: "three", status: "completed" },
      { id: "d", title: "four", status: "failed" },
    ];
    const props = planComponent(buildPlanFlow(todos, { phase: "executing" }));
    expect(props["phase"]).toBe("executing");
    expect(props["todos"]).toEqual([
      { id: "a", text: "one", status: "queued" },
      { id: "b", text: "two", status: "running" },
      { id: "c", text: "three", status: "done" },
      { id: "d", text: "four", status: "failed" },
    ]);
  });

  it("defaults to executing phase (back-compat with the live todo card)", () => {
    const props = planComponent(buildPlanFlow([{ id: "a", title: "x", status: "pending" }]));
    expect(props["phase"]).toBe("executing");
  });

  it("carries opts.data into flow.data (merged with kind:'plan')", () => {
    const flow = buildPlanFlow([{ id: "t1", title: "x" }], {
      phase: "proposed",
      data: { actionType: "plan-approval", agentSlug: "a1", conversationId: "c1" },
    });
    expect(flow.data).toMatchObject({
      kind: "plan",
      actionType: "plan-approval",
      agentSlug: "a1",
      conversationId: "c1",
    });
  });

  it("emits superseded:true only on proposed cards when opts.superseded is set", () => {
    const sup = planComponent(
      buildPlanFlow([{ id: "t1", title: "x" }], { phase: "proposed", superseded: true }),
    );
    expect(sup["superseded"]).toBe(true);
    // Absent by default (not superseded).
    const live = planComponent(buildPlanFlow([{ id: "t1", title: "x" }], { phase: "proposed" }));
    expect(live).not.toHaveProperty("superseded");
    // superseded is a proposed-only flag — executing cards must not carry it.
    const exec = planComponent(
      buildPlanFlow([{ id: "t1", title: "x", status: "pending" }], {
        phase: "executing",
        superseded: true,
      }),
    );
    expect(exec).not.toHaveProperty("superseded");
  });

  it("emits autoApproved:true only on executing/done cards when opts.autoApproved is set", () => {
    const exec = planComponent(
      buildPlanFlow([{ id: "t1", title: "x", status: "pending" }], {
        phase: "executing",
        autoApproved: true,
      }),
    );
    expect(exec["autoApproved"]).toBe(true);
    const done = planComponent(
      buildPlanFlow([{ id: "t1", title: "x", status: "completed" }], {
        phase: "done",
        autoApproved: true,
      }),
    );
    expect(done["autoApproved"]).toBe(true);
    // Absent by default, and never on proposed (approval gate present).
    const execPlain = planComponent(
      buildPlanFlow([{ id: "t1", title: "x", status: "pending" }], { phase: "executing" }),
    );
    expect(execPlain).not.toHaveProperty("autoApproved");
    const proposed = planComponent(
      buildPlanFlow([{ id: "t1", title: "x" }], { phase: "proposed", autoApproved: true }),
    );
    expect(proposed).not.toHaveProperty("autoApproved");
  });

  it("emits approvedBy only on executing/done cards when opts.approvedBy is set", () => {
    const exec = planComponent(
      buildPlanFlow([{ id: "t1", title: "x", status: "pending" }], {
        phase: "executing",
        approvedBy: "Pradeesh S",
      }),
    );
    expect(exec["approvedBy"]).toBe("Pradeesh S");
    // Never on proposed (approval not granted yet), absent by default on exec.
    const proposed = planComponent(
      buildPlanFlow([{ id: "t1", title: "x" }], { phase: "proposed", approvedBy: "Pradeesh S" }),
    );
    expect(proposed).not.toHaveProperty("approvedBy");
    const execPlain = planComponent(
      buildPlanFlow([{ id: "t1", title: "x", status: "pending" }], { phase: "executing" }),
    );
    expect(execPlain).not.toHaveProperty("approvedBy");
  });

  it("emits approvedAt only on executing/done cards when opts.approvedAt is set", () => {
    const iso = "2026-07-26T09:34:00.000Z";
    const exec = planComponent(
      buildPlanFlow([{ id: "t1", title: "x", status: "pending" }], {
        phase: "executing",
        approvedAt: iso,
      }),
    );
    expect(exec["approvedAt"]).toBe(iso);
    const done = planComponent(
      buildPlanFlow([{ id: "t1", title: "x", status: "completed" }], {
        phase: "done",
        autoApproved: true,
        approvedAt: iso,
      }),
    );
    expect(done["approvedAt"]).toBe(iso);
    // Never on proposed, absent by default on exec.
    const proposed = planComponent(
      buildPlanFlow([{ id: "t1", title: "x" }], { phase: "proposed", approvedAt: iso }),
    );
    expect(proposed).not.toHaveProperty("approvedAt");
    const execPlain = planComponent(
      buildPlanFlow([{ id: "t1", title: "x", status: "pending" }], { phase: "executing" }),
    );
    expect(execPlain).not.toHaveProperty("approvedAt");
  });

  it("emits decidedAt only on proposed cards when opts.decidedAt is set", () => {
    const iso = "2026-07-26T09:34:00.000Z";
    const rej = planComponent(
      buildPlanFlow([{ id: "t1", title: "x" }], {
        phase: "proposed",
        rejected: true,
        decidedBy: "Pradeesh S",
        decidedAt: iso,
      }),
    );
    expect(rej["decidedAt"]).toBe(iso);
    // decidedAt is proposed-only — never on executing/done.
    const exec = planComponent(
      buildPlanFlow([{ id: "t1", title: "x", status: "pending" }], {
        phase: "executing",
        decidedAt: iso,
      }),
    );
    expect(exec).not.toHaveProperty("decidedAt");
  });

  it("emits rejected + decidedBy only on proposed cards (explicit user reject)", () => {
    const rej = planComponent(
      buildPlanFlow([{ id: "t1", title: "x" }], {
        phase: "proposed",
        rejected: true,
        decidedBy: "Pradeesh S",
      }),
    );
    expect(rej["rejected"]).toBe(true);
    expect(rej["decidedBy"]).toBe("Pradeesh S");
    // rejected/decidedBy are proposed-only — never on executing/done.
    const exec = planComponent(
      buildPlanFlow([{ id: "t1", title: "x", status: "pending" }], {
        phase: "executing",
        rejected: true,
        decidedBy: "Pradeesh S",
      }),
    );
    expect(exec).not.toHaveProperty("rejected");
    expect(exec).not.toHaveProperty("decidedBy");
  });

  it("emits the document (markdown) on every phase when provided", () => {
    const doc = "# Plan\n\nDetailed brief.\n\n## Steps\n\n1. one";
    const proposed = planComponent(
      buildPlanFlow([{ id: "t1", title: "x" }], { phase: "proposed", document: doc }),
    );
    expect(proposed["document"]).toBe(doc);
    const exec = planComponent(
      buildPlanFlow([{ id: "t1", title: "x", status: "pending" }], { phase: "executing", document: doc }),
    );
    expect(exec["document"]).toBe(doc);
    const done = planComponent(
      buildPlanFlow([{ id: "t1", title: "x", status: "completed" }], { phase: "done", document: doc }),
    );
    expect(done["document"]).toBe(doc);
    // Absent by default (no document passed).
    const plain = planComponent(buildPlanFlow([{ id: "t1", title: "x" }], { phase: "proposed" }));
    expect(plain).not.toHaveProperty("document");
  });

  it("preserves title/desc on executing cards (no more generic 'Plan' overwrite)", () => {
    const props = planComponent(
      buildPlanFlow([{ id: "t1", title: "x", status: "pending" }], {
        phase: "executing",
        title: "Organize a team coffee",
        desc: "A short 3-step plan",
      }),
    );
    expect(props["title"]).toBe("Organize a team coffee");
    expect(props["desc"]).toBe("A short 3-step plan");
  });

  it("proposed todos never carry a status; exec todos never carry included (strict-shape guard)", () => {
    const proposed = planComponent(buildPlanFlow([{ id: "t1", title: "x" }], { phase: "proposed" }));
    const pt = (proposed["todos"] as Record<string, unknown>[])[0]!;
    expect(pt).not.toHaveProperty("status");
    expect(Object.keys(pt).sort()).toEqual(["id", "included", "text"]);

    const exec = planComponent(buildPlanFlow([{ id: "t1", title: "x", status: "pending" }], { phase: "done" }));
    const et = (exec["todos"] as Record<string, unknown>[])[0]!;
    expect(et).not.toHaveProperty("included");
    expect(Object.keys(et).sort()).toEqual(["id", "status", "text"]);
  });
});
