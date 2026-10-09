import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPollMessageActive,
  assertPollPlacement,
  canViewPollResults,
  canViewPollVoterIdentities,
  isPollMessageMetadata,
  normalizePollChoice,
} from "../dist/polls/index.js";

test("keeps result visibility stable across close and channel roles", () => {
  assert.equal(canViewPollResults({
    visibility: "CREATOR_ONLY",
    isPollCreator: false,
    isChannelCreator: true,
    isChannelAdmin: true,
    isClosed: true,
  }), false);
  assert.equal(canViewPollResults({
    visibility: "AFTER_CLOSE",
    isPollCreator: false,
    isChannelCreator: false,
    isChannelAdmin: false,
    isClosed: false,
  }), false);
  assert.equal(canViewPollResults({
    visibility: "AFTER_CLOSE",
    isPollCreator: false,
    isChannelCreator: false,
    isChannelAdmin: false,
    isClosed: true,
  }), true);
  assert.equal(canViewPollResults({
    visibility: "ADMIN_ONLY",
    isPollCreator: false,
    isChannelCreator: false,
    isChannelAdmin: true,
    isClosed: false,
  }), true);
  assert.equal(canViewPollResults({
    visibility: "ADMIN_ONLY",
    isPollCreator: false,
    isChannelCreator: false,
    isChannelAdmin: false,
    isClosed: true,
  }), false);
});

test("limits voter identities to a non-anonymous poll creator", () => {
  assert.equal(canViewPollVoterIdentities({ isAnonymous: true, isPollCreator: true }), false);
  assert.equal(canViewPollVoterIdentities({ isAnonymous: false, isPollCreator: true }), true);
  assert.equal(canViewPollVoterIdentities({ isAnonymous: false, isPollCreator: false }), false);
});

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
