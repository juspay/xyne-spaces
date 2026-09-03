import { describe, expect, it } from "vitest";
import { filterScheduledRunTools } from "../src/scheduled-run-tool-policy.js";

describe("scheduled run tool policy", () => {
  it("removes tools that require an interactive thread", () => {
    const tools = [
      { name: "schedule-task" },
      { name: "propose-agent-call" },
      { name: "spaces-search" },
    ];

    expect(filterScheduledRunTools(tools).map((tool) => tool.name)).toEqual(["spaces-search"]);
  });

  it("keeps direct A2A delegation tools for unattended workflows", () => {
    const tools = [
      { name: "call-agent" },
      { name: "ask_infra_doctor" },
      { name: "ask_release_notes" },
    ];

    expect(filterScheduledRunTools(tools).map((tool) => tool.name)).toEqual([
      "call-agent",
      "ask_infra_doctor",
      "ask_release_notes",
    ]);
  });

  it("does not mutate the caller's tool array", () => {
    const tools = [{ name: "propose-agent-call" }, { name: "call-agent" }];

    filterScheduledRunTools(tools);

    expect(tools.map((tool) => tool.name)).toEqual(["propose-agent-call", "call-agent"]);
  });
});
