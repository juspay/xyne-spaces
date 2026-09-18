import { describe, expect, it } from "vitest";
import { toInbound, type SelfIdentity } from "./messages.js";

const self: SelfIdentity = { jid: "918667338331@s.whatsapp.net", lid: "233079436239007@lid" };
const GROUP = "120363409771359214@g.us";

function wa(key: Record<string, unknown> = {}, message: Record<string, unknown> = { conversation: "hello" }) {
  return {
    key: { remoteJid: "919028716240@s.whatsapp.net", id: "MSG1", fromMe: false, ...key },
    message,
  } as Parameters<typeof toInbound>[0];
}

describe("toInbound: who sent it", () => {
  it("marks a colleague's group message as neither ours nor the owner's", () => {
    const msg = toInbound(wa({ remoteJid: GROUP, participant: "919028716240@s.whatsapp.net" }), self);
    expect(msg).toMatchObject({ isGroup: true, fromSelf: false, chatId: GROUP });
    expect(msg?.fromOwner).toBeUndefined();
    expect(msg?.senderId).toBe("919028716240@s.whatsapp.net");
  });

  it("treats a message the owner typed on their own phone as input, not an echo", () => {
    const msg = toInbound(wa({ remoteJid: GROUP, id: "TYPED", fromMe: true, participant: self.jid }), self, {
      sentIds: new Set(["SENT-BY-US"]),
    });
    expect(msg).toMatchObject({ fromOwner: true, fromSelf: false });
  });

  it("treats our own reply, echoed back by the server, as an echo", () => {
    const msg = toInbound(wa({ remoteJid: GROUP, id: "SENT-BY-US", fromMe: true, participant: self.jid }), self, {
      sentIds: new Set(["SENT-BY-US"]),
    });
    expect(msg).toMatchObject({ fromSelf: true });
    expect(msg?.fromOwner).toBeUndefined();
  });

  it("flags the owner's own 'You' chat as self chat", () => {
    const msg = toInbound(wa({ remoteJid: self.jid, id: "NOTE", fromMe: true }), self);
    expect(msg).toMatchObject({ selfChat: true, fromOwner: true, isGroup: false });
  });

  it("does not flag self chat when the account has it switched off", () => {
    const msg = toInbound(wa({ remoteJid: self.jid, id: "NOTE", fromMe: true }), self, { selfChat: false });
    expect(msg?.selfChat).toBeUndefined();
  });

  it("prefers the phone-number twin of a LID sender, so phone allowlists still match", () => {
    const msg = toInbound(
      wa({ remoteJid: GROUP, participant: "233079436239007@lid", senderPn: "919028716240@s.whatsapp.net" }),
      self,
    );
    expect(msg?.senderId).toBe("919028716240@s.whatsapp.net");
  });
});

describe("toInbound: what it says", () => {
  it("strips our own @mention out of the text", () => {
    const msg = toInbound(
      wa({ remoteJid: GROUP, participant: "919028716240@s.whatsapp.net" }, {
        extendedTextMessage: { text: "@918667338331 what is the status", contextInfo: { mentionedJid: [self.jid] } },
      }),
      self,
    );
    expect(msg?.text).toBe("what is the status");
    expect(msg?.mentionedSelf).toBe(true);
  });

  it("keeps a captionless photo, which is a message even with no text", () => {
    const msg = toInbound(wa({}, { imageMessage: { mimetype: "image/jpeg", fileLength: 1024 } }), self);
    expect(msg?.text).toBe("");
    expect(msg?.media).toBeDefined();
  });

  it("drops the things that are not messages at all", () => {
    expect(toInbound(wa({ remoteJid: "status@broadcast" }), self)).toBeNull();
    expect(toInbound(wa({}, { reactionMessage: { text: "👍" } }), self)).toBeNull();
    expect(toInbound(wa({}, {}), self)).toBeNull();
  });
});
