import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural guards for chat-run links (XYNE-66880), same technique as
 * webhook.agent-progress.test.ts: the risk is wiring, not logic. Each chat
 * branch must be gated on the chat target and return before the Spaces post,
 * so a Spaces run — which never carries one — takes exactly the old path.
 */
const webhook = readFileSync(join(__dirname, "webhook.ts"), "utf8");

function between(startMarker: string, endMarker: string, from = 0): string {
  const start = webhook.indexOf(startMarker, from);
  expect(start).toBeGreaterThan(-1);
  const end = webhook.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return webhook.slice(start, end);
}

describe("PR card render", () => {
  const render = between("async function doRenderPrCard(", "function renderPrCard(");

  it("sends to the chat only for a chat run, then returns before the Spaces card", () => {
    expect(render).toMatch(
      /if \(ctx\?\.channelDelivery\) \{[\s\S]*?if \(!ctx\.agentOrgId\) \{[\s\S]*?return;\s*\}\s*await deliverChannelPrStatus\(/,
    );
    const branch = render.indexOf("deliverChannelPrStatus(");
    expect(render.indexOf("return;", branch)).toBeLessThan(render.indexOf('"/chat/postMessage"'));
    expect(branch).toBeLessThan(render.indexOf('"/chat/postMessage"'));
  });

  it("leaves the Spaces post, in-place update and durable binding in place", () => {
    expect(render).toContain('"/chat/postMessage"');
    expect(render).toContain('"/chat/updateMessage"');
    expect(render).toContain("upsertWidgetBinding(");
  });
});

describe("git-host PR webhook", () => {
  const sync = between("async function syncWebhookPrCard(", "const prEventQueue");

  it("hands chat bindings to the chat and returns before the Spaces agent lookup", () => {
    const branch = sync.indexOf("readChannelPrTarget(binding)");
    expect(branch).toBeGreaterThan(-1);
    expect(sync).toMatch(/if \(channelTarget\) \{\s*return deliverWebhookPrStatus\(/);
    expect(branch).toBeLessThan(sync.indexOf("agentRepository.findBySpacesAppId("));
  });
});

describe("sandbox preview announce", () => {
  const preview = between("if (sandboxPreviewUrl && sandboxId) {", "if (!toolLabel) return;");

  it("records ownership and honours the opt-out before the chat branch", () => {
    const chat = preview.indexOf("deliverChannelSandboxPreview(");
    expect(chat).toBeGreaterThan(preview.indexOf("ingestSandboxPreviewSignals("));
    expect(chat).toBeGreaterThan(preview.indexOf("isLivePreviewMessageHidden("));
  });

  it("returns from the chat branch before any Spaces post", () => {
    const chat = preview.indexOf("deliverChannelSandboxPreview(");
    expect(preview).toMatch(/if \(ctx\.channelDelivery\) \{/);
    expect(preview.indexOf("return;", chat)).toBeLessThan(preview.indexOf("postAgentMessage("));
    expect(chat).toBeLessThan(preview.indexOf("postAgentMessage("));
  });
});

describe("/design share", () => {
  it("is sent to the chat from the chat result branch, after the reply is queued", () => {
    const channel = between("if (ctx?.channelDelivery) {\n    const channelTarget", "// The run is over and will NOT continue");
    const reply = channel.indexOf("await deliverChannelResult(");
    const share = channel.indexOf("deliverChannelDesignShare(");
    expect(reply).toBeGreaterThan(-1);
    expect(share).toBeGreaterThan(reply);
  });

  it("the Spaces thread post is unchanged", () => {
    expect(webhook.match(/await publishThreadArtifactShare\(ctx, delivered\.designShareUrl\);/g)).toHaveLength(2);
  });
});
