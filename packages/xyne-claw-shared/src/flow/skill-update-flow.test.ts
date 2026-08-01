import { describe, it, expect } from "vitest";
import { buildSkillUpdateApprovalFlow } from "./builder.js";
import { computeSkillDiff } from "../skill-diff/index.js";

function flatten(flow: any): any[] {
  const out: any[] = [];
  const walk = (c: any) => {
    out.push(c);
    if (Array.isArray(c?.props?.children)) c.props.children.forEach(walk);
    if (Array.isArray(c?.children)) c.children.forEach(walk);
  };
  (flow.screen?.components ?? flow.components ?? []).forEach(walk);
  return out;
}

describe("buildSkillUpdateApprovalFlow", () => {
  const diff = computeSkillDiff("old body", "new body\nmore");
  const flow = buildSkillUpdateApprovalFlow({
    requestId: "req-1",
    approverUserId: "owner-1",
    skillSlug: "jenkins-investigation",
    skillName: "Jenkins Investigation",
    proposerName: "Anurag",
    diff,
    summary: "add step",
    agentSlug: "architect",
    spacesBaseUrl: "https://spaces.example.com",
  });

  it("carries only authoritative identifiers in data (no content/diff blob)", () => {
    const data = (flow as any).data ?? (flow as any).screen?.data;
    expect(data.actionType).toBe("skill-update");
    expect(data.requestId).toBe("req-1");
    expect(data.approverUserId).toBe("owner-1");
    expect(data.skillSlug).toBe("jenkins-investigation");
    expect(data.agentSlug).toBe("architect");
    // The proposed content / full diff must NOT be embedded in the signed card.
    expect(JSON.stringify(data)).not.toContain("new body");
    expect(JSON.stringify(data)).not.toContain("```diff");
  });

  it("renders a dedicated skillUpdate node with structured diff props", () => {
    const nodes = flatten(flow);
    const skillNode = nodes.find((n) => n.type === "skillUpdate");
    expect(skillNode).toBeTruthy();
    expect(skillNode.props.skillName).toBe("Jenkins Investigation");
    expect(skillNode.props.skillSlug).toBe("jenkins-investigation");
    expect(skillNode.props.summary).toBe("add step");
    expect(skillNode.props.diff.added).toBe(diff.added);
    expect(skillNode.props.diff.removed).toBe(diff.removed);
    expect(JSON.stringify(skillNode.props.diff)).toContain("new body");
  });

  it("uses node-owned Approve and Decline buttons via the skill-update action ids", () => {
    const nodes = flatten(flow);
    expect(nodes.some((n) => n.type === "button")).toBe(false);
    expect(nodes.some((n) => n.type === "skillUpdate")).toBe(true);
  });
});
