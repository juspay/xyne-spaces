import { describe, expect, it } from "vitest";
import {
  automationRunAllowsSandboxWrite,
  automationRunIsHeadlessBulk,
  isWorkflowEngineSession,
} from "./automation-write-policy.js";

describe("automationRunAllowsSandboxWrite", () => {
  it("lets workflow-engine steps write", () => {
    expect(isWorkflowEngineSession("wf-cmexec0001-a1b2c3d4-t1-r0")).toBe(true);
    expect(automationRunAllowsSandboxWrite({ sessionId: "wf-cmexec0001-a1b2c3d4-t2-r1", requested: undefined, sdlcProfile: false })).toBe(true);
  });

  it("keeps automation steps and retries read-only", () => {
    for (const sessionId of ["cmrun0001:step_2", "cmrun0001:step_2:retry-1", "automation-wf-lookalike", "WF-upper", undefined, 42]) {
      expect(automationRunAllowsSandboxWrite({ sessionId, requested: undefined, sdlcProfile: false })).toBe(false);
    }
  });

  it("still honours an explicit request and the SDLC profile", () => {
    expect(automationRunAllowsSandboxWrite({ sessionId: "cmrun0001:step_0", requested: true, sdlcProfile: false })).toBe(true);
    expect(automationRunAllowsSandboxWrite({ sessionId: "cmrun0001:step_0", requested: false, sdlcProfile: true })).toBe(true);
  });
});

describe("automationRunIsHeadlessBulk", () => {
  it("gives workflow-engine steps the agent's main provider order", () => {
    expect(automationRunIsHeadlessBulk("wf-cmexec0001-a1b2c3d4-t0-r0")).toBe(false);
  });

  it("keeps automations, retries and unknown sessions on the automationProvider downgrade", () => {
    for (const sessionId of ["cmrun0001:step_2", "cmrun0001:step_2:retry-1", "automation-wf-lookalike", "WF-upper", undefined, 42]) {
      expect(automationRunIsHeadlessBulk(sessionId)).toBe(true);
    }
  });
});
