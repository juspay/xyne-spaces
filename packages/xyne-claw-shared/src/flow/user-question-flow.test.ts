import { describe, expect, it } from "vitest";
import { buildUserQuestionFlow } from "./builder.js";

describe("buildUserQuestionFlow", () => {
  it("emits one typed question-set card with all response modes", () => {
    const flow = buildUserQuestionFlow(
      [
        {
          id: "scope",
          label: "Version scope",
          question: "Which versions?",
          type: "single_choice",
          options: ["4.2.1", "All"],
        },
        {
          id: "targets",
          question: "Which targets?",
          type: "multiple_choice",
          options: ["Android", "iOS"],
        },
        {
          id: "detail",
          question: "Anything else?",
          type: "open_ended",
          placeholder: "Optional context",
        },
      ],
      {
        questionId: "set-1",
        agentSlug: "agent",
        channelId: "channel",
        conversationId: "conversation",
        userId: "user",
      },
    );

    expect(flow.components).toHaveLength(1);
    expect(flow.components[0]).toMatchObject({
      id: "questions",
      type: "user_question",
      props: {
        title: "Questions",
        submitAction: { type: "submit", actionId: "user-answer" },
        dismissAction: { type: "submit", actionId: "dismiss-user-question" },
      },
    });
    expect(flow.data).toMatchObject({
      actionType: "user-answer",
      questionId: "set-1",
    });
  });

  it("keeps a stable card id and emits a read-only answered phase", () => {
    const flow = buildUserQuestionFlow(
      [
        {
          id: "scope",
          question: "Which versions?",
          type: "single_choice",
          options: ["One", "All"],
        },
      ],
      {
        questionId: "set-2",
        agentSlug: "agent",
        channelId: "channel",
        conversationId: "conversation",
        userId: "user",
      },
      { phase: "answered", answers: { scope: "All" }, notes: { scope: "Please include patch notes" } },
    );
    expect(flow.screenId).toBe("user-question-set-2");
    expect(flow.components[0]?.props).toMatchObject({ phase: "answered", answers: { scope: "All" } });
    expect(flow.components[0]?.props).not.toHaveProperty("submitAction");
  });
});
