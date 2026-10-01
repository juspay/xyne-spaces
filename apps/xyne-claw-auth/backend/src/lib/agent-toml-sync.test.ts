import { describe, expect, it } from "vitest";
import { exportAgentToml, importAgentToml } from "./agent-toml-sync.js";

const PROMPT = `## Identity & tone
You are triage.

## Operational Workflow
1. Read the ticket.
2. Classify severity.

## When to use each tool
Use jira for tickets.

## Guardrails
Never delete tickets.

## Decision rules
IF critical THEN page on-call.

## Error recovery
If jira fails, report and stop.

## Contrastive examples
Anti-pattern: Hello!
Calibrated: Ticket #1 is P1.
`;

describe("agent-toml-sync", () => {
  it("exports a row then re-imports as a no-op when hash matches", async () => {
    const toml = await exportAgentToml({
      slug: "triage",
      name: "Triage",
      description: "Classifies tickets",
      systemPrompt: PROMPT,
      modelId: "gpt-test",
      config: {
        permissionMode: "ask-first",
        deniedTools: ["jira.delete_issue"],
        tools: { custom: ["jira"], direct: [], gateway: [], subagents: [] },
      },
      kbScope: "COLLECTIONS",
      skillSlugs: ["triage-procedure"],
      collectionIds: ["col-1"],
    });

    expect(toml).toContain("name = ");
    expect(toml).not.toMatch(/signing_secret|spaces_app_token|mcp_token/i);

    const first = await importAgentToml(toml, null);
    expect(first.ok).toBe(true);
    if (!first.ok || first.noop) throw new Error("expected apply");
    expect(first.permissionMode).toBe("ask-first");
    expect(first.deniedTools).toEqual(["jira.delete_issue"]);
    expect(first.skillSlugs).toEqual(["triage-procedure"]);

    const storedHash = first.projection.content_hash!;
    const second = await importAgentToml(toml, storedHash);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.noop).toBe(true);
  });

  it("rejects forbidden secret keys on import", async () => {
    const res = await importAgentToml(
      `name = "x"\nspaces_app_token = "secret"\nsystem_prompt = ${JSON.stringify(PROMPT)}`,
      null,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/Forbidden/);
  });

  it("rejects thin system prompts on import", async () => {
    const res = await importAgentToml(
      `name = "x"\ndescription = "y"\nsystem_prompt = "You are helpful."`,
      null,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/short|Workflow|Guardrails/i);
  });
});
