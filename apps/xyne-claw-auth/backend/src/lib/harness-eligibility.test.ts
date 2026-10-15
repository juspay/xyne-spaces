import { describe, expect, it } from "vitest";
import { harnessEligibility, harnessIneligibleMessage, type HarnessEligibilityInput } from "./harness-eligibility.js";

const base: HarnessEligibilityInput = {
  isTaskCommandRun: false,
  localSandboxRequested: false,
  workspaceRun: false,
  unresolvedContext: false,
  hasContextFiles: false,
  attachmentsBlocked: false,
};

describe("harnessEligibility", () => {
  it("lets a plain chat turn run locally", () => {
    expect(harnessEligibility(base)).toEqual({ eligible: true });
  });

  it("keeps task commands on the server unless the device can run them", () => {
    expect(harnessEligibility({ ...base, isTaskCommandRun: true })).toEqual({ eligible: false, reason: "task_command" });
    expect(harnessEligibility({ ...base, isTaskCommandRun: true, localSandboxRequested: true })).toEqual({ eligible: true });
  });

  it.each([
    ["unresolved_context", { unresolvedContext: true }],
    ["context_files", { hasContextFiles: true }],
    ["attachments", { attachmentsBlocked: true }],
  ] as const)("reports %s", (reason, extra) => {
    expect(harnessEligibility({ ...base, ...extra })).toEqual({ eligible: false, reason });
  });

  it("checks reasons in a fixed order", () => {
    expect(
      harnessEligibility({ ...base, isTaskCommandRun: true, unresolvedContext: true, hasContextFiles: true }),
    ).toEqual({ eligible: false, reason: "task_command" });
    expect(harnessEligibility({ ...base, unresolvedContext: true, hasContextFiles: true })).toEqual({
      eligible: false,
      reason: "unresolved_context",
    });
  });

  it("always lets a local-folder workspace run go to the device", () => {
    expect(
      harnessEligibility({ ...base, workspaceRun: true, isTaskCommandRun: true, hasContextFiles: true, attachmentsBlocked: true }),
    ).toEqual({ eligible: true });
  });

  it("has a user-facing line for every reason", () => {
    for (const reason of ["task_command", "unresolved_context", "context_files", "attachments"] as const) {
      expect(harnessIneligibleMessage(reason)).toMatch(/server/i);
    }
  });
});
