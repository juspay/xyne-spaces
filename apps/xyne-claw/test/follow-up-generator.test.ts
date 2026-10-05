import { describe, expect, it } from "vitest";
import {
  buildFollowUpUserMessage,
  clipFinalResponseForFollowUps,
  describeFollowUpGenerationInput,
  parseFollowUpPayload,
} from "../src/follow-up-generator.js";

describe("follow-up generation input", () => {
  it("labels inputs by whether history and a final response were provided", () => {
    expect(describeFollowUpGenerationInput(0, false)).toBe("prompt_only");
    expect(describeFollowUpGenerationInput(2, false)).toBe("conversation_history_and_prompt");
    expect(describeFollowUpGenerationInput(0, true)).toBe("prompt_and_response");
    expect(describeFollowUpGenerationInput(4, true)).toBe("conversation_history_prompt_and_response");
  });
});

describe("clipFinalResponseForFollowUps", () => {
  it("keeps short responses intact", () => {
    expect(clipFinalResponseForFollowUps("  Deploy is green.  ")).toBe("Deploy is green.");
    expect(clipFinalResponseForFollowUps(undefined)).toBe("");
  });

  it("keeps both the opening and the conclusion of long responses", () => {
    const long = `START${"a".repeat(20_000)}END-RECOMMENDATION`;
    const clipped = clipFinalResponseForFollowUps(long);
    expect(clipped.length).toBeLessThan(long.length);
    expect(clipped.startsWith("START")).toBe(true);
    expect(clipped.endsWith("END-RECOMMENDATION")).toBe(true);
    expect(clipped).toContain("omitted");
  });
});

describe("buildFollowUpUserMessage", () => {
  it("includes the user request and the agent's final response", () => {
    const message = buildFollowUpUserMessage({
      task: "Why did the payments deploy fail?",
      finalResponse: "The deploy failed because migration 0042 timed out. Re-run it with a higher lock timeout.",
      agentContext: { name: "Infra Doctor", description: "Diagnoses deploys" },
      conversationHistory: [{ role: "user", content: "hi" }],
    });
    expect(message).toContain("Previous conversation:\nUSER: hi");
    expect(message).toContain("Current user request:\nWhy did the payments deploy fail?");
    expect(message).toContain("Assistant's final response to the current request:\nThe deploy failed because migration 0042");
    expect(message).toContain("Selected agent: Infra Doctor");
    // Order matters: request, then the answer to it.
    expect(message.indexOf("Current user request")).toBeLessThan(
      message.indexOf("Assistant's final response"),
    );
  });

  it("omits the final-response section when there is no answer", () => {
    const message = buildFollowUpUserMessage({ task: "hello", finalResponse: "   " });
    expect(message).not.toContain("Assistant's final response");
    expect(message).toContain("No agent metadata was provided");
  });
});

describe("parseFollowUpPayload", () => {
  const options = [
    "Draft a reply to this ticket and send it as me",
    "Create a ticket for the follow-up work",
    "Summarize the open decisions in this thread",
  ];

  it("recovers GLM tool-call markup leaked into content (the real failing case)", () => {
    const content =
      "<tool_call><tool_call>record_follow_up_suggestions<arg_key>options</arg_key>" +
      `<arg_value>${JSON.stringify(options)}</arg_value></tool_call>`;
    expect(parseFollowUpPayload(content)).toEqual(options);
  });

  it("recovers a bare JSON array wrapped in prose", () => {
    expect(parseFollowUpPayload(`Here you go: ${JSON.stringify(options)}`)).toEqual(options);
  });

  it("still rejects markup that does not carry exactly three options", () => {
    const content =
      "<tool_call>record_follow_up_suggestions<arg_key>options</arg_key>" +
      `<arg_value>${JSON.stringify(options.slice(0, 2))}</arg_value></tool_call>`;
    expect(parseFollowUpPayload(content)).toBeUndefined();
  });
});
