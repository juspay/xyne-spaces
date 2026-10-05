import { beforeEach, describe, expect, it } from "vitest";
import {
  normalizeToolGrantKey,
  parseToolGrantEntry,
  resetToolGrantShadowForTests,
  resolveToolGrant,
  shadowToolGrant,
  toolGrantSubjectFromRuntimeTool,
} from "./tool-grant.js";

const alertsTool = toolGrantSubjectFromRuntimeTool({
  name: "Juspay_Alerts_MCP_2_0__create_group_id_juspay",
  mcpToolName: "create_group_id_juspay",
  serverToolKey: "Juspay Internal Alerts MCP 2.0__create_group_id_juspay",
});

describe("toolGrantSubjectFromRuntimeTool", () => {
  it("recovers server type, server name and raw tool name", () => {
    expect(alertsTool).toEqual({
      toolName: "create_group_id_juspay",
      runtimeName: "Juspay_Alerts_MCP_2_0__create_group_id_juspay",
      serverType: "Juspay Internal Alerts MCP 2.0",
      serverName: "Juspay_Alerts_MCP_2_0",
    });
  });

  it("treats a tool without MCP metadata as its own name", () => {
    expect(toolGrantSubjectFromRuntimeTool({ name: "webfetch", selectionKey: "webfetch" })).toEqual({
      toolName: "webfetch",
      runtimeName: "webfetch",
      selectionKey: "webfetch",
    });
  });
});

describe("parseToolGrantEntry / normalizeToolGrantKey", () => {
  it("splits on the first double underscore", () => {
    expect(parseToolGrantEntry("Juspay Internal Alerts MCP 2.0__create_group_id_juspay")).toEqual({
      server: "Juspay Internal Alerts MCP 2.0",
      tool: "create_group_id_juspay",
    });
    expect(parseToolGrantEntry("alert_data_juspay")).toEqual({ tool: "alert_data_juspay" });
  });

  it("normalises case, separators and punctuation the same way for every spelling", () => {
    expect(normalizeToolGrantKey("Juspay Alerts MCP 2.0")).toBe(normalizeToolGrantKey("Juspay_Alerts_MCP_2_0"));
    expect(normalizeToolGrantKey("apps_send_message")).toBe(normalizeToolGrantKey("apps-send-message"));
  });
});

describe("resolveToolGrant", () => {
  it("grants a pick scoped by server type", () => {
    expect(resolveToolGrant(alertsTool, { direct: ["Juspay Internal Alerts MCP 2.0__create_group_id_juspay"] })).toMatchObject({
      allowed: true,
      reason: "direct-scoped",
    });
  });

  it("grants a pick scoped by the decorated server name", () => {
    expect(resolveToolGrant(alertsTool, { direct: ["Juspay_Alerts_MCP_2_0__create_group_id_juspay"] })).toMatchObject({
      allowed: true,
    });
  });

  it("grants a bare pick on any server", () => {
    expect(resolveToolGrant(alertsTool, { direct: ["create_group_id_juspay"] })).toMatchObject({
      allowed: true,
      reason: "direct-bare",
    });
  });

  it("does not grant a pick scoped to a different server", () => {
    expect(resolveToolGrant(alertsTool, { direct: ["Other MCP__create_group_id_juspay"] })).toMatchObject({ allowed: false });
  });

  it("does not grant on a mere suffix", () => {
    expect(resolveToolGrant(alertsTool, { direct: ["group_id_juspay"] })).toMatchObject({ allowed: false });
  });

  it("grants every tool of a server named in subagents, by name or resolved server type", () => {
    expect(resolveToolGrant(alertsTool, { subagents: ["Juspay Internal Alerts MCP 2.0"] })).toMatchObject({
      allowed: true,
      reason: "server",
    });
    expect(
      resolveToolGrant(alertsTool, { subagents: ["alerts"], subagentServerTypes: ["Juspay Internal Alerts MCP 2.0"] }),
    ).toMatchObject({ allowed: true, reason: "server" });
  });

  it("grants custom picks by selection key and gateway picks by service name", () => {
    expect(resolveToolGrant({ toolName: "webfetch", selectionKey: "webfetch" }, { custom: ["webfetch"] })).toMatchObject({
      allowed: true,
      reason: "custom",
    });
    expect(resolveToolGrant({ toolName: "query", serviceName: "mettle" }, { gateway: ["mettle"] })).toMatchObject({
      allowed: true,
      reason: "gateway",
    });
  });

  it("denies when nothing matches", () => {
    expect(resolveToolGrant(alertsTool, { direct: ["alert_data_juspay"] })).toEqual({ allowed: false, reason: "none" });
  });
});

describe("shadowToolGrant", () => {
  beforeEach(() => resetToolGrantShadowForTests());

  it("logs a disagreement once and stays quiet on agreement", () => {
    const lines: string[] = [];
    const config = { direct: ["Juspay Internal Alerts MCP 2.0__create_group_id_juspay"] };
    const run = (legacy: boolean) =>
      shadowToolGrant({ site: "test", legacy, subject: alertsTool, config, agent: "pi-alerts-bot", log: (m) => lines.push(m) });
    run(true);
    run(false);
    run(false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[tool-grant-shadow] site=test agent=pi-alerts-bot");
    expect(lines[0]).toContain("legacy=false canonical=true reason=direct-scoped");
  });
});
