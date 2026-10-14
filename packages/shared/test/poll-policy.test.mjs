import assert from "node:assert/strict";
import test from "node:test";

import {
  appendPollOption,
  assertCompleteRanking,
  assertPollMessageActive,
  assertPollOpen,
  assertPollScheduleAfter,
  isPollClosed,
  isPollMessageMetadata,
  normalizePollChoice,
} from "../dist/polls/index.js";

test("normalizes poll choices identically across locales and whitespace variants", () => {
  assert.equal(normalizePollChoice("  ＦＯＯ\t  BAR  "), "foo bar");
  assert.equal(normalizePollChoice("I"), "i");
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

test("treats only an explicit closure as closed", () => {
  assert.equal(isPollClosed({ closedAt: null }), false);
  assert.equal(isPollClosed({ closedAt: 1 }), true);
  assert.doesNotThrow(() => assertPollOpen({ closedAt: null }));
  assert.throws(() => assertPollOpen({ closedAt: 1 }), /closed/);
});

const options = [
  { id: "a", text: "Tea", createdBy: "u1" },
  { id: "b", text: "Coffee", createdBy: "u1" },
];

test("requires a ranking to order every option exactly once", () => {
  assert.doesNotThrow(() => assertCompleteRanking(options, ["b", "a"]));
  assert.throws(() => assertCompleteRanking(options, ["a"]), /Rank every option once/);
  assert.throws(() => assertCompleteRanking(options, ["a", "a"]), /Rank every option once/);
  assert.throws(() => assertCompleteRanking(options, ["a", "z"]), /Rank every option once/);
});

test("appends audience options only to choice questions without duplicates", () => {
  const added = { id: "c", text: "Juice", createdBy: "u2" };
  assert.deepEqual(
    appendPollOption({ responseType: "MULTIPLE_CHOICE", options }, added),
    [...options, added],
  );
  for (const responseType of ["RANKING", "RATING_1_TO_5", "SHORT_TEXT", "Q_AND_A"]) {
    assert.throws(
      () => appendPollOption({ responseType, options }, added),
      /choice questions/,
    );
  }
  assert.throws(
    () => appendPollOption(
      { responseType: "SINGLE_CHOICE", options },
      { id: "c", text: "  tea ", createdBy: "u2" },
    ),
    /already exists/,
  );
  const full = Array.from({ length: 10 }, (_, index) => ({
    id: `o${index}`,
    text: `Option ${index}`,
    createdBy: "u1",
  }));
  assert.throws(
    () => appendPollOption({ responseType: "SINGLE_CHOICE", options: full }, added),
    /maximum/,
  );
});

test("rejects a publish time at or after a scheduled poll's close or reminder", () => {
  const pollDraft = {
    poll: { pollId: "p" },
    schedule: { closeAt: "2026-10-08T11:00:00.000Z", remindAt: "2026-10-08T10:30:00.000Z" },
  };
  assert.doesNotThrow(() =>
    assertPollScheduleAfter(pollDraft, Date.parse("2026-10-08T10:00:00.000Z")),
  );
  assert.throws(
    () => assertPollScheduleAfter(pollDraft, Date.parse("2026-10-08T10:30:00.000Z")),
    /before the poll's close and reminder times/,
  );
  assert.doesNotThrow(() => assertPollScheduleAfter({ poll: {}, schedule: {} }, Date.now()));
});
