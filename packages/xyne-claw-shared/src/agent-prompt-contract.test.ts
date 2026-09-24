import { describe, expect, it } from "vitest";
import {
  normalizePermissionMode,
  validateSystemPromptContract,
} from "./agent-prompt-contract.js";

const GOOD = `## Identity & tone
You are a triage agent. Be direct.

## Operational Workflow
1. Read the ticket.
2. Classify severity.
3. Route to the owner.

## When to use each tool
Use spaces to post. Use web-search only for public docs.

## Guardrails
Never delete tickets. Do not approve without evidence.

## Decision rules
IF severity is critical THEN page on-call.

## Error recovery
If search fails, report the error and continue with the ticket body.

## Contrastive examples
Anti-pattern: Hello! I'd be delighted to help triage…
Calibrated: Ticket #42 is P1 — routed to @oncall.
`;

describe("validateSystemPromptContract", () => {
  it("accepts a structured prompt", () => {
    expect(validateSystemPromptContract(GOOD).ok).toBe(true);
  });

  it("rejects a one-liner", () => {
    const res = validateSystemPromptContract("You are helpful.");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/short|Workflow|Guardrails/i);
  });

  it("rejects missing workflow", () => {
    const res = validateSystemPromptContract(
      "You are a triage agent. Never delete tickets. Do not invent severity.\n".repeat(3),
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Workflow/i);
  });

  it("rejects missing guardrails", () => {
    const res = validateSystemPromptContract(`You are a triage agent.

## Operational Workflow
1. Read the ticket.
2. Classify it.
3. Reply with the route.
`);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Guardrails/i);
  });
});

describe("normalizePermissionMode", () => {
  it("defaults unknown to ask-first", () => {
    expect(normalizePermissionMode(undefined)).toBe("ask-first");
    expect(normalizePermissionMode("nope")).toBe("ask-first");
    expect(normalizePermissionMode("read-only")).toBe("read-only");
  });
});
