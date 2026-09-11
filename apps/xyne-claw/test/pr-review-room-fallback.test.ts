import { describe, expect, it } from "vitest";

import { isProviderFallbackEligibleError } from "../src/agent.js";
import {
  buildReviewRoomNoticeBody,
  runFindingsWithFallback,
  type FindingsAttempt,
} from "../src/pr-review-room.js";

function collector(fail: (attempt: FindingsAttempt) => unknown) {
  const attempts: FindingsAttempt[] = [];
  const run = async (attempt: FindingsAttempt): Promise<void> => {
    attempts.push(attempt);
    const err = fail(attempt);
    if (err) throw err;
  };
  return { attempts, run };
}

const base = {
  roomConversationId: "review-room_abc",
  provider: "claude" as string | undefined,
  providerConfig: { model: "claude-sonnet", apiKey: "k" },
  sessionId: "review-room_abc_1234",
  isFallbackEligible: isProviderFallbackEligibleError,
};

describe("runFindingsWithFallback", () => {
  it("does not retry when the first attempt succeeds", async () => {
    const { attempts, run } = collector(() => undefined);
    const outcome = await runFindingsWithFallback({ ...base, run });
    expect(outcome.ok).toBe(true);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.provider).toBe("claude");
    expect(attempts[0]?.providerConfig).toBe(base.providerConfig);
  });

  it("retries once on the platform provider after a provider auth failure", async () => {
    const { attempts, run } = collector((a) =>
      a.provider ? new Error("401 OAuth access token has been revoked") : undefined,
    );
    const outcome = await runFindingsWithFallback({ ...base, run });
    expect(outcome.ok).toBe(true);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]?.provider).toBeUndefined();
    expect(attempts[1]?.providerConfig).toBeUndefined();
    expect(attempts[1]?.sessionId).not.toBe(attempts[0]?.sessionId);
    expect(attempts[1]?.sessionId.startsWith(`${base.sessionId}_fb`)).toBe(true);
  });

  it("retries once after a quota failure and reports the retry's own error", async () => {
    const { attempts, run } = collector((a) =>
      a.provider ? new Error("429 rate_limit_error") : new Error("litellm exploded"),
    );
    const outcome = await runFindingsWithFallback({ ...base, run });
    expect(outcome).toEqual({ ok: false, error: expect.any(Error) });
    expect(attempts).toHaveLength(2);
  });

  it("does not retry a non-provider failure", async () => {
    const err = new Error("submit-result schema rejected the payload");
    const { attempts, run } = collector(() => err);
    const outcome = await runFindingsWithFallback({ ...base, run });
    expect(outcome).toEqual({ ok: false, error: err });
    expect(attempts).toHaveLength(1);
  });

  it("does not retry when the run was already on the platform provider", async () => {
    const err = new Error("429 quota_exceeded");
    const { attempts, run } = collector(() => err);
    const outcome = await runFindingsWithFallback({ ...base, provider: undefined, run });
    expect(outcome).toEqual({ ok: false, error: err });
    expect(attempts).toHaveLength(1);
  });
});

describe("buildReviewRoomNoticeBody", () => {
  it("carries the failure marker, the reason and the PR identity", () => {
    const body = buildReviewRoomNoticeBody(
      "sess-1",
      "review-room_abc",
      {
        provider: "github",
        status: "created",
        title: "Add thing",
        url: "https://github.com/org/repo/pull/12",
        number: "12",
        repo: "org/repo",
      },
      "the findings model failed on every provider",
    );
    expect(body).toEqual({
      sessionId: "sess-1",
      roomConversationId: "review-room_abc",
      failed: true,
      reason: "the findings model failed on every provider",
      pr: { number: "12", url: "https://github.com/org/repo/pull/12" },
    });
    expect(body["html"]).toBeUndefined();
  });

  it("caps the reason at 200 characters", () => {
    const body = buildReviewRoomNoticeBody("s", "r", { provider: "github", status: "created", title: "t" }, "x".repeat(500));
    expect((body["reason"] as string).length).toBe(200);
  });
});
