import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPollMessageActive,
  assertPollPlacement,
  isPollMessageMetadata,
  normalizePollChoice,
} from "../dist/polls/index.js";

test("normalizes poll choices identically across locales and whitespace variants", () => {
  assert.equal(normalizePollChoice("  ＦＯＯ\t  BAR  "), "foo bar");
  assert.equal(normalizePollChoice("I"), "i");
});

test("rejects poll drafts in thread replies while allowing ordinary replies", () => {
  assert.doesNotThrow(() => assertPollPlacement(undefined, "thread"));
  assert.doesNotThrow(() =>
    assertPollPlacement({ pollId: "poll-1" }, "channel"),
  );
  assert.throws(
    () => assertPollPlacement({ pollId: "poll-1" }, "thread"),
    /top-level channel messages/,
  );
});

test("rejects interactions when the owning poll message is missing or deleted", () => {
  assert.doesNotThrow(() => assertPollMessageActive({ isDeleted: false }));
  assert.throws(() => assertPollMessageActive({ isDeleted: true }), /deleted/);
  assert.throws(() => assertPollMessageActive(undefined), /available/);
});

test("recognizes only poll message metadata", () => {
  assert.equal(isPollMessageMetadata({ messageSubtype: "poll" }), true);
  assert.equal(isPollMessageMetadata({ messageSubtype: "recording" }), false);
  assert.equal(isPollMessageMetadata(null), false);
});
