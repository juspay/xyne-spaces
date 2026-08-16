import test from "node:test";
import assert from "node:assert/strict";

// Imports the BUILT output on purpose: this is exactly the module consumers
// (dashboard worker today, native transport tomorrow) resolve via the
// `@xyne/shared/askAI` subpath. Run via `pnpm --filter @xyne/shared test`.
import { buildAskAIRequestBody } from "../dist/askAI/requestBody.js";
import { createAskAISSEParser } from "../dist/askAI/sse.js";

/**
 * Ask AI stream core — behaviour lock.
 *
 * `buildAskAIRequestBody` and `createAskAISSEParser` were extracted verbatim
 * from the dashboard Web Worker (apps/dashboard/src/services/XyneAI/
 * xyneAIStream.worker.ts). These tests pin the exact wire contract so the
 * extraction is provably zero-behaviour-change and so a future edit that alters
 * the serialization or SSE framing fails here instead of silently in prod.
 */

// ---------------------------------------------------------------------------
// buildAskAIRequestBody
// ---------------------------------------------------------------------------

test("buildAskAIRequestBody: minimal request emits required snake_case keys and defaults", () => {
  const body = buildAskAIRequestBody({
    query: "hello",
    channelIds: ["c1", "c2"],
    conversationId: "conv-1",
    sessionId: "sess-1",
    webSearchEnabled: true,
  });

  assert.deepEqual(body, {
    query: "hello",
    channel_ids: ["c1", "c2"],
    conversation_id: "conv-1",
    session_id: "sess-1",
    web_search_enabled: true,
    // always-present defaults (load-bearing — backend reads them unconditionally)
    deep_research_enabled: false,
    create_canvas_enabled: false,
    instant: false,
    research_context: null,
  });
});

test("buildAskAIRequestBody: empty arrays are omitted, not sent as []", () => {
  const body = buildAskAIRequestBody({
    query: "q",
    channelIds: [],
    collectionIds: [],
    fileIds: [],
    canvasIds: [],
    ticketIds: [],
    callIds: [],
    attachedContext: [],
    messageAttachmentIds: [],
    attachments: [],
    conversationId: "conv",
    sessionId: "sess",
    webSearchEnabled: false,
  });

  // channel_ids is always present (even empty); every other array key is omitted.
  assert.deepEqual(body.channel_ids, []);
  for (const k of [
    "collection_ids",
    "file_ids",
    "canvas_ids",
    "ticket_ids",
    "call_ids",
    "attached_context",
    "message_attachment_ids",
    "attachments",
  ]) {
    assert.ok(!(k in body), `${k} should be omitted for empty array`);
  }
});

test("buildAskAIRequestBody: full request maps every field to the correct wire key", () => {
  const body = buildAskAIRequestBody({
    query: "q",
    displayQuery: "shown",
    channelIds: ["c"],
    collectionIds: ["col"],
    fileIds: ["f"],
    canvasIds: ["cv"],
    ticketIds: ["t"],
    callIds: ["call"],
    attachedContext: [{ type: "ticket", id: "T-1", title: "Bug" }],
    conversationId: "conv",
    sessionId: "sess",
    webSearchEnabled: true,
    deepResearchEnabled: true,
    createCanvasEnabled: true,
    instant: true,
    researchContext: { type: "product", id: "p1", name: "Prod" },
    canvasId: "canvas-1",
    messageAttachmentIds: ["ma1"],
    attachments: [{ data: "BASE64", mimeType: "image/png", filename: "a.png" }],
    parentMessageId: "pm",
    isRegenerate: true,
    isEditUserMessage: true,
    editedUserMessageId: "eum",
    parentAssistantMessageId: "pam",
    draftMode: true,
    version: "v2",
    disableTools: true,
    agentSlug: "ticket-triage",
    model: "claude-sonnet-5",
  });

  assert.equal(body.display_query, "shown");
  assert.deepEqual(body.collection_ids, ["col"]);
  assert.deepEqual(body.file_ids, ["f"]);
  assert.deepEqual(body.canvas_ids, ["cv"]);
  assert.deepEqual(body.ticket_ids, ["t"]);
  assert.deepEqual(body.call_ids, ["call"]);
  assert.deepEqual(body.attached_context, [
    { type: "ticket", id: "T-1", title: "Bug" },
  ]);
  assert.equal(body.deep_research_enabled, true);
  assert.equal(body.create_canvas_enabled, true);
  assert.equal(body.instant, true);
  assert.deepEqual(body.research_context, {
    type: "product",
    id: "p1",
    name: "Prod",
  });
  assert.equal(body.canvas_id, "canvas-1");
  assert.deepEqual(body.message_attachment_ids, ["ma1"]);
  // attachments are re-keyed camel -> snake (mimeType -> mime_type)
  assert.deepEqual(body.attachments, [
    { data: "BASE64", mime_type: "image/png", filename: "a.png" },
  ]);
  assert.equal(body.parent_message_id, "pm");
  assert.equal(body.is_regenerate, true);
  assert.equal(body.is_edit_user_message, true);
  assert.equal(body.edited_user_message_id, "eum");
  assert.equal(body.parent_assistant_message_id, "pam");
  assert.equal(body.draft_mode, true);
  assert.equal(body.version, "v2");
  assert.equal(body.disable_tools, true);
  // agentSlug stays camelCase on the wire — deliberate, matches the original worker.
  assert.equal(body.agentSlug, "ticket-triage");
  assert.equal(body.model, "claude-sonnet-5");
});

test("buildAskAIRequestBody: falsy booleans omit their keys (draft_mode/disable_tools only sent when true)", () => {
  const body = buildAskAIRequestBody({
    query: "q",
    channelIds: ["c"],
    conversationId: "conv",
    sessionId: "sess",
    webSearchEnabled: false,
    draftMode: false,
    disableTools: false,
    isRegenerate: false,
  });
  assert.ok(!("draft_mode" in body));
  assert.ok(!("disable_tools" in body));
  assert.ok(!("is_regenerate" in body));
  // but the unconditional flags are still present
  assert.equal(body.web_search_enabled, false);
  assert.equal(body.instant, false);
});

// ---------------------------------------------------------------------------
// createAskAISSEParser
// ---------------------------------------------------------------------------

test("SSE parser: parses complete data lines and drops ping heartbeats", () => {
  const parser = createAskAISSEParser();
  const events = parser.push(
    'data: {"type":"start","sessionId":"s1"}\n' +
      'data: {"type":"ping"}\n' +
      'data: {"type":"delta","content":"Hel"}\n',
  );
  assert.deepEqual(events, [
    { type: "start", sessionId: "s1" },
    { type: "delta", content: "Hel" },
  ]);
});

test("SSE parser: buffers a frame split across two chunks", () => {
  const parser = createAskAISSEParser();
  const first = parser.push('data: {"type":"delta","con');
  assert.deepEqual(first, [], "incomplete line yields nothing yet");
  const second = parser.push('tent":"lo"}\n');
  assert.deepEqual(second, [{ type: "delta", content: "lo" }]);
});

test("SSE parser: ignores non-data lines and non-object JSON", () => {
  const parser = createAskAISSEParser();
  const events = parser.push(
    "event: message\n" + "data: 42\n" + "data: null\n" + ": comment\n",
  );
  assert.deepEqual(events, []);
});

test("SSE parser: malformed JSON is reported to onError and does not throw", () => {
  const parser = createAskAISSEParser();
  const seen = [];
  const events = parser.push(
    "data: {not json}\n" + 'data: {"type":"done"}\n',
    (err, line) => {
      seen.push(line);
    },
  );
  assert.deepEqual(events, [{ type: "done" }]);
  assert.equal(seen.length, 1);
  assert.equal(seen[0], "data: {not json}");
});
