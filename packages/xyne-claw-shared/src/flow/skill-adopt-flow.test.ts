import { describe, it, expect } from "vitest";
import { buildSkillAdoptApprovalFlow } from "./builder.js";
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

describe("buildSkillAdoptApprovalFlow", () => {
  const diff = formatSkillDiffForCard(computeSkillDiff("old body", "new body\nmore"));
  const flow = buildSkillAdoptApprovalFlow({
    requestId: "req-adopt-1",
    approverUserId: "agent-owner-1",
    skillSlug: "jenkins-investigation",
    skillName: "Jenkins Investigation",
    targetAgentName: "Release Bot",
    editorName: "Anurag",
    fromVersion: 3,
    toVersion: 4,
    diffText: diff,
    summary: "add step",
    agentSlug: "release-bot",
    spacesBaseUrl: "https://spaces.example.com",
  });

  it("carries only authoritative identifiers in data (no content/diff blob)", () => {
    const data = (flow as any).data ?? (flow as any).screen?.data;
    expect(data.actionType).toBe("skill-adopt");
    expect(data.requestId).toBe("req-adopt-1");
    // The APPROVER is the agent owner, not the skill owner.
    expect(data.approverUserId).toBe("agent-owner-1");
    expect(data.skillSlug).toBe("jenkins-investigation");
    expect(data.agentSlug).toBe("release-bot");
    // The proposed content / full diff must NOT be embedded in the signed card.
    expect(JSON.stringify(data)).not.toContain("new body");
    expect(JSON.stringify(data)).not.toContain("```diff");
  });

  it("names the target agent and both versions in the card body", () => {
    const nodes = flatten(flow);
    const text = nodes.map((n) => String(n.props?.content ?? "")).join("\n");
    expect(text).toContain("Release Bot");
    expect(text).toContain("v3");
    expect(text).toContain("v4");
  });

  it("renders the diff inside a fenced block in a text node", () => {
    const nodes = flatten(flow);
    const textWithDiff = nodes.find((n) => n.type === "text" && String(n.props?.content ?? "").includes("```diff"));
    expect(textWithDiff).toBeTruthy();
    expect(String(textWithDiff.props.content)).toContain("+new body");
  });

  it("has Adopt and Keep-current submit buttons with the skill-adopt action ids", () => {
    const nodes = flatten(flow);
    const buttons = nodes.filter((n) => n.type === "button");
    const actionIds = buttons.map((b) => b.props?.action?.actionId);
    expect(actionIds).toContain("skill-adopt-approve");
    expect(actionIds).toContain("skill-adopt-decline");
    for (const b of buttons) expect(b.props.action.type).toBe("submit");
  });
});
