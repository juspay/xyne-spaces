import { describe, it, expect } from "vitest";
import { buildSkillUpdateApprovalFlow } from "./builder.js";
import { computeSkillDiff, formatSkillDiffForCard } from "../skill-diff/index.js";

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
  const diff = formatSkillDiffForCard(computeSkillDiff("old body", "new body\nmore"));
  const flow = buildSkillUpdateApprovalFlow({
    requestId: "req-1",
    approverUserId: "owner-1",
    skillSlug: "jenkins-investigation",
    skillName: "Jenkins Investigation",
    proposerName: "Anurag",
    diffText: diff,
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

  it("renders the diff inside a fenced block in a text node", () => {
    const nodes = flatten(flow);
    const textWithDiff = nodes.find((n) => n.type === "text" && String(n.props?.content ?? "").includes("```diff"));
    expect(textWithDiff).toBeTruthy();
    expect(String(textWithDiff.props.content)).toContain("+new body");
  });

  it("has Approve and Decline submit buttons with the skill-update action ids", () => {
    const nodes = flatten(flow);
    const buttons = nodes.filter((n) => n.type === "button");
    const actionIds = buttons.map((b) => b.props?.action?.actionId);
    expect(actionIds).toContain("skill-update-approve");
    expect(actionIds).toContain("skill-update-decline");
    for (const b of buttons) expect(b.props.action.type).toBe("submit");
  });
});
