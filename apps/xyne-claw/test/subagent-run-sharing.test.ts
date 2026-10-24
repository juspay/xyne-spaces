import { describe, expect, it } from "vitest";
import { shareSubagentRun, subagentWorkingDir } from "../src/subagent-tools.js";
import { workspacePath } from "../src/workspace.js";
import { ALWAYS_LOADED_TOOL_NAMES, ACTIVE_TOOL_CAP_DEFAULT, planActiveToolCap } from "../src/active-tool-cap.js";

type Result = { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> };
const answer = (text: string, details: Record<string, unknown> = {}): Result => ({ content: [{ type: "text", text }], details });

describe("shareSubagentRun", () => {
  it("shares one run between identical calls and keeps a good answer", async () => {
    const map = new Map();
    let runs = 0;
    const run = async () => {
      runs += 1;
      return answer("found 3 tickets");
    };
    const [a, b] = await Promise.all([shareSubagentRun(map, "k", run), shareSubagentRun(map, "k", run)]);
    expect(a).toBe(b);
    await shareSubagentRun(map, "k", run);
    expect(runs).toBe(1);
  });

  it("shares a failed answer with callers already waiting, then runs again", async () => {
    const map = new Map();
    let runs = 0;
    const run = async () => {
      runs += 1;
      return runs === 1 ? answer("spaces subagent failed: timeout", { failed: true }) : answer("found 3 tickets");
    };
    const [a, b] = await Promise.all([shareSubagentRun(map, "k", run), shareSubagentRun(map, "k", run)]);
    expect(a.details["failed"]).toBe(true);
    expect(b).toBe(a);
    const again = await shareSubagentRun(map, "k", run);
    expect(again.content[0]?.text).toBe("found 3 tickets");
    expect(runs).toBe(2);
  });

  it("does not keep a run that threw", async () => {
    const map = new Map();
    let runs = 0;
    const run = async () => {
      runs += 1;
      if (runs === 1) throw new Error("boom");
      return answer("ok");
    };
    await expect(shareSubagentRun(map, "k", run)).rejects.toThrow("boom");
    await Promise.resolve();
    expect((await shareSubagentRun(map, "k", run)).content[0]?.text).toBe("ok");
  });
});

describe("subagentWorkingDir", () => {
  it("uses the parent's working dir — a conversation run's workspace is keyed by the conversation, not the run", () => {
    expect(subagentWorkingDir({ parentSessionId: "run-1", parentWorkingDir: "/data/workspaces/conv-9_agent" })).toBe(
      "/data/workspaces/conv-9_agent",
    );
  });

  it("falls back to the run's workspace, then the process dir", () => {
    expect(subagentWorkingDir({ parentSessionId: "run-1" })).toBe(workspacePath("run-1"));
    expect(subagentWorkingDir(undefined)).toBe(process.cwd());
  });
});

describe("always-loaded tools under the cap", () => {
  it("keeps todo-write and ask-user-question even with no usage, and fills the rest by usage", () => {
    const used = Array.from({ length: 30 }, (_, i) => `Server__tool_${i}`);
    const activeNames = [...used, "todo-write", "todo-read", "ask-user-question"];
    const plan = planActiveToolCap({
      activeNames,
      demotable: new Set(activeNames),
      pinned: new Set(ALWAYS_LOADED_TOOL_NAMES),
      usageRank: used,
      cap: ACTIVE_TOOL_CAP_DEFAULT,
      fixedExtra: 7,
    });
    const budget = ACTIVE_TOOL_CAP_DEFAULT - 7 - 3;
    expect(plan.keep).toEqual(expect.arrayContaining(["todo-write", "todo-read", "ask-user-question"]));
    expect(plan.keep.length + 7).toBe(ACTIVE_TOOL_CAP_DEFAULT);
    expect(plan.keep).toEqual(expect.arrayContaining(used.slice(0, budget)));
    expect(plan.demote).toContain(`Server__tool_${budget}`);
  });
});
