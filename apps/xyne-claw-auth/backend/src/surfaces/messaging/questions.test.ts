import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserQuestion } from "xyne-claw-shared";

const store = new Map<string, string>();
const redis = {
  get: async (k: string) => store.get(k) ?? null,
  set: async (k: string, v: string) => {
    store.set(k, v);
    return "OK";
  },
  del: (...keys: string[]) => {
    keys.forEach((k) => store.delete(k));
    return Promise.resolve(keys.length);
  },
};
vi.mock("../../redis.js", () => ({ redisService: { getConnection: () => redis } }));

const enqueueOutbound = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("./delivery.js", () => ({ enqueueOutbound }));

let tokenSeq = 0;
const parkOptions = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("./cards.js", () => ({ newCardToken: () => `tok${++tokenSeq}`, parkOptions }));

const interactive = {
  buttons: 3,
  buttonTitleChars: 20,
  listRows: 10,
  rowTitleChars: 24,
  rowDescriptionChars: 72,
  bodyChars: 1024,
  headerChars: 60,
  footerChars: 60,
  cta: true,
};
const sendForm = vi.fn();
let channelConfig: Record<string, unknown> | null = null;
vi.mock("./plugin.js", () => ({
  getChannel: () => ({ capabilities: { interactive }, sendForm }),
}));
vi.mock("./store.js", () => ({
  getAccount: async () => ({ surface: { key: "whatsapp-cloud" } }),
  toChannelAccount: () => ({ channelConfig }),
}));

const {
  renderQuestion,
  interpretTypedAnswer,
  askChannelQuestions,
  pendingQuestion,
  answerPendingQuestion,
  answerFromFormReply,
  formDataFor,
  answersFromForm,
  clearPendingQuestion,
  SKIP_ANSWER,
} = await import("./questions.js");

const target = {
  channel: "whatsapp-cloud",
  connectedSurfaceId: "acc",
  accountKey: "acct_1",
  chatId: "919",
  senderId: "919",
  isGroup: false,
} as const;

const single: UserQuestion = { id: "q1", question: "Which env?", type: "single_choice", options: ["Staging", "Prod", SKIP_ANSWER] };
const many: UserQuestion = {
  id: "q2",
  question: "Which checks?",
  type: "multiple_choice",
  options: [{ label: "Lint", description: "eslint" }, "Tests", "Build", SKIP_ANSWER],
};
const open: UserQuestion = { id: "q3", question: "Anything else?", type: "open_ended", placeholder: "e.g. a deadline" };

const session = (questions: UserQuestion[]) => ({
  questionId: "qs",
  accountId: "acc",
  chatId: "919",
  senderId: "919",
  userId: "u1",
  agentSlug: "assistant",
  questions,
  index: 0,
  answers: [],
});

beforeEach(() => {
  store.clear();
  tokenSeq = 0;
  channelConfig = null;
  enqueueOutbound.mockClear();
  parkOptions.mockClear();
});

describe("renderQuestion", () => {
  it("uses reply buttons when every option fits one", () => {
    const out = renderQuestion(session([single]), 0, interactive);
    expect(out.card).toMatchObject({ kind: "buttons", body: "Which env?" });
    expect(out.card?.kind === "buttons" && out.card.buttons.map((b) => b.title)).toEqual(["Staging", "Prod", SKIP_ANSWER]);
    expect(out.parked.map((p) => p.option.action)).toEqual([
      { kind: "answer", questionId: "qs", index: 0, value: "Staging" },
      { kind: "answer", questionId: "qs", index: 0, value: "Prod" },
      { kind: "answer", questionId: "qs", index: 0, value: SKIP_ANSWER },
    ]);
  });

  it("falls back to a list when a label would be clipped on a button, keeping the full label visible", () => {
    const long: UserQuestion = { id: "q", question: "Branch?", type: "single_choice", options: ["main", "release/2026-10-hotfix", "dev"] };
    const out = renderQuestion(session([long]), 0, interactive);
    expect(out.card?.kind).toBe("list");
    const rows = out.card?.kind === "list" ? out.card.sections[0]!.rows : [];
    expect(rows[1]).toMatchObject({ title: "release/2026-10-hotfix" });
  });

  it("asks a pick-any question as numbered text with no parked options", () => {
    const out = renderQuestion(session([many]), 0, interactive);
    expect(out.parked).toEqual([]);
    expect(out.text).toContain("1. Lint — eslint");
    expect(out.text).toContain("Reply with the numbers, like 1, 3.");
  });

  it("asks an open question as plain text with its hint, and shows progress on a multi-part set", () => {
    const out = renderQuestion(session([single, open]), 1, interactive);
    expect(out.text).toContain("Anything else?");
    expect(out.text).toContain("_e.g. a deadline_");
    expect(out.text).toContain("_2 of 2_");
  });

  it("still parks a single choice on a channel without native cards, for the numbered-menu fallback", () => {
    const out = renderQuestion(session([single]), 0, undefined);
    expect(out.card?.kind).toBe("list");
    expect(out.parked).toHaveLength(3);
  });
});

describe("interpretTypedAnswer", () => {
  it("maps numbers, labels and 'skip'", () => {
    expect(interpretTypedAnswer(single, "2")).toBe("Prod");
    expect(interpretTypedAnswer(single, "staging")).toBe("Staging");
    expect(interpretTypedAnswer(single, "skip")).toBe(SKIP_ANSWER);
    expect(interpretTypedAnswer(many, "1, 3")).toBe("Lint, Build");
    expect(interpretTypedAnswer(many, "1 and 2")).toBe("Lint, Tests");
  });

  it("keeps anything else as the person's own words", () => {
    expect(interpretTypedAnswer(single, "prod but only after 6pm")).toBe("prod but only after 6pm");
    expect(interpretTypedAnswer(open, "3")).toBe("3");
    expect(interpretTypedAnswer(single, "9")).toBe("9");
  });
});

describe("a question set, one question at a time", () => {
  it("walks the set and hands back the Spaces answer summary routed to the asking agent", async () => {
    await askChannelQuestions({ target, userId: "u1", questionId: "qs", questions: [single, many], agentSlug: "assistant" });
    expect(enqueueOutbound).toHaveBeenCalledTimes(1);
    expect(enqueueOutbound.mock.calls[0]?.[1]).toMatchObject({ kind: "card", chatId: "919" });

    let asked = await pendingQuestion("acc", "919", "919");
    expect(asked?.index).toBe(0);
    // A tap on the first card.
    expect(await answerPendingQuestion(asked!, "Prod", { questionId: "qs", index: 0 })).toEqual({ kind: "next" });
    expect(enqueueOutbound.mock.calls[1]?.[1]).toMatchObject({ kind: "text" });

    asked = await pendingQuestion("acc", "919", "919");
    // A tap on the OLD card after it moved on is stale.
    expect(await answerPendingQuestion(asked!, "Staging", { questionId: "qs", index: 0 })).toEqual({ kind: "stale" });
    const done = await answerPendingQuestion(asked!, "Lint, Build");
    expect(done).toEqual({
      kind: "done",
      agentSlug: "assistant",
      task: "The user answered your questions. Continue the task based on these answers:\nWhich env?: Prod\nWhich checks?: Lint, Build",
    });
    expect(await pendingQuestion("acc", "919", "919")).toBeNull();
  });

  it("is cleared by /new and /stop", async () => {
    await askChannelQuestions({ target, userId: "u1", questionId: "qs", questions: [open] });
    await clearPendingQuestion("acc", "919", "919");
    expect(await pendingQuestion("acc", "919", "919")).toBeNull();
  });
});

describe("as a native form", () => {
  it("sends one form when the account has a published one, and the submission answers everything", async () => {
    channelConfig = { questionFormId: "55501" };
    await askChannelQuestions({ target, userId: "u1", questionId: "qs", questions: [single, many, open] });
    expect(enqueueOutbound).toHaveBeenCalledTimes(1);
    const item = enqueueOutbound.mock.calls[0]?.[1] as { kind: string; form: { formId: string; token: string; data: Record<string, unknown> } };
    expect(item.kind).toBe("form");
    expect(item.form.formId).toBe("55501");
    expect(item.form.data["q0_single"]).toBe(true);
    expect(item.form.data["q1_multi"]).toBe(true);
    expect(item.form.data["q2_open"]).toBe(true);
    expect(item.form.data["q3_show"]).toBe(false);

    const asked = await pendingQuestion("acc", "919", "919");
    expect(await answerFromFormReply(asked!, { token: "forged", fields: {} })).toEqual({ kind: "stale" });
    const done = await answerFromFormReply(asked!, {
      token: item.form.token,
      fields: { q0_one: "1", q1_many: ["0", "2"], q2_open_ans: "ship by friday" },
    });
    expect(done.kind === "done" && done.task).toContain("Which env?: Prod\nWhich checks?: Lint, Build\nAnything else?: ship by friday");
  });

  it("keeps a single short choice as buttons even with a form available", async () => {
    channelConfig = { questionFormId: "55501" };
    await askChannelQuestions({ target, userId: "u1", questionId: "qs", questions: [single] });
    expect(enqueueOutbound.mock.calls[0]?.[1]).toMatchObject({ kind: "card" });
  });
});

describe("form data", () => {
  it("hides unused slots with a non-empty placeholder source and marks required fields per type", () => {
    const data = formDataFor([single], "One quick question");
    expect(data["q0_single_req"]).toBe(true);
    expect(data["q0_options"]).toEqual([
      { id: "0", title: "Staging" },
      { id: "1", title: "Prod" },
      { id: "2", title: SKIP_ANSWER },
    ]);
    expect(data["q4_show"]).toBe(false);
    expect(data["q4_options"]).toEqual([{ id: "_", title: "-" }]);
  });

  it("reads an empty or unknown submission as skipped, never as a wrong option", () => {
    expect(answersFromForm([single, many], { q0_one: "7", q1_many: [] })).toEqual([
      `Which env?: ${SKIP_ANSWER}`,
      `Which checks?: ${SKIP_ANSWER}`,
    ]);
  });
});
