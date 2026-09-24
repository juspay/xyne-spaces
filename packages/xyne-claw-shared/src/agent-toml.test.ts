import { describe, expect, it } from "vitest";
import {
  AGENT_TOML_FORBIDDEN_KEYS,
  hashAgentProjection,
  parseAgentToml,
  renderAgentToml,
} from "./agent-toml.js";

const SAMPLE = `
name = "triage-specialist"
description = "Classifies tickets"
slug = "triage-specialist"
model = "gpt-test"
system_prompt = "You are a triage agent.\\n\\n## Operational Workflow\\n1. Read.\\n2. Classify.\\n\\n## Guardrails\\nNever delete."
permission_mode = "ask-first"
skill_slugs = ["triage-procedure"]
kb_scope = "COLLECTIONS"
collection_ids = ["col-1"]

[tools]
allow = ["spaces", "jira"]
deny = ["jira.delete_issue"]

[approval]
mode = "ask-first"
`;

describe("agent-toml", () => {
  it("parses a projection", () => {
    const res = parseAgentToml(SAMPLE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.projection.name).toBe("triage-specialist");
    expect(res.projection.tools_deny).toEqual(["jira.delete_issue"]);
    expect(res.projection.permission_mode).toBe("ask-first");
    expect(res.projection.skill_slugs).toEqual(["triage-procedure"]);
    expect(res.projection.collection_ids).toEqual(["col-1"]);
  });

  it.each([
    "signing_secret",
    "spaces_app_token",
    "service_account_token",
    "mcp_token",
    "api_key",
    "password",
  ] as const)("rejects forbidden key %s", (key) => {
    const res = parseAgentToml(
      `name = "x"\n${key} = "nope"\nsystem_prompt = "You are x.\\n\\n## Operational Workflow\\n1. A.\\n2. B.\\n\\n## Guardrails\\nNever."`,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/Forbidden/);
  });

  it("lists the canonical forbidden keys", () => {
    expect(AGENT_TOML_FORBIDDEN_KEYS).toContain("signing_secret");
    expect(AGENT_TOML_FORBIDDEN_KEYS).toContain("spaces_app_token");
    expect(AGENT_TOML_FORBIDDEN_KEYS).toContain("mcp_token");
  });

  it("round-trips render → parse with stable content hash", async () => {
    const parsed = parseAgentToml(SAMPLE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const hash = await hashAgentProjection(parsed.projection);
    const rendered = renderAgentToml({ ...parsed.projection, content_hash: hash });
    const again = parseAgentToml(rendered);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.projection.name).toBe(parsed.projection.name);
    expect(again.projection.content_hash).toBe(hash);
    expect(await hashAgentProjection(again.projection)).toBe(hash);
  });

  it("requires name and a system prompt source", () => {
    expect(parseAgentToml(`description = "x"`).ok).toBe(false);
    expect(parseAgentToml(`name = "x"`).ok).toBe(false);
  });
});
