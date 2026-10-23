import { describe, expect, it, vi } from "vitest";
import { installToolBudget } from "../src/tool-budget.js";

type Hook = NonNullable<Parameters<typeof installToolBudget>[0]["beforeToolCall"]>;

const call = (agent: { beforeToolCall?: Hook }) =>
  agent.beforeToolCall!({ toolCall: { name: "x" }, args: {} } as unknown as Parameters<Hook>[0]);

describe("tool budget cap", () => {
  it("warns on the last allowed call and blocks every call after it", async () => {
    const steer = vi.fn();
    const agent: { beforeToolCall?: Hook; steer: typeof steer } = { steer };
    installToolBudget(agent, { sessionId: "s", maxCalls: 2 });
    expect(await call(agent)).toBeUndefined();
    expect(steer).not.toHaveBeenCalled();
    expect(await call(agent)).toBeUndefined();
    expect(steer).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(steer.mock.calls[0]![0])).toContain("last tool call (budget 2)");
    expect(await call(agent)).toMatchObject({ block: true, reason: expect.stringContaining("Tool budget of 2 calls reached") });
  });

  it("never blocks without a cap", async () => {
    const agent: { beforeToolCall?: Hook; steer: () => void } = { steer: () => undefined };
    installToolBudget(agent, { sessionId: "s" });
    for (let i = 0; i < 5; i++) expect(await call(agent)).toBeUndefined();
  });
});
