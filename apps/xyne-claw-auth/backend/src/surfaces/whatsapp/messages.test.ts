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

  it("attributes a DM the owner typed to the owner, not to the contact", () => {
    // Otherwise the run executes with the contact's Xyne access, and a reply
    // meant for the owner is sent to them instead.
    const msg = toInbound(
      wa({ remoteJid: "919028716240@s.whatsapp.net", id: "TYPED", fromMe: true }),
      self,
      { sentIds: new Set(["SENT-BY-US"]) },
    );
    expect(msg).toMatchObject({ fromOwner: true, isGroup: false, senderId: self.jid });
  });

  it("keeps the contact as the sender when the contact wrote", () => {
    const msg = toInbound(wa({ remoteJid: "919028716240@s.whatsapp.net" }), self);
    expect(msg?.senderId).toBe("919028716240@s.whatsapp.net");
    expect(msg?.fromOwner).toBeUndefined();
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

  it("reports self chat as a fact — whether to answer there is the plugin's call", () => {
    const msg = toInbound(wa({ remoteJid: self.jid, id: "NOTE", fromMe: true }), self);
    expect(msg?.selfChat).toBe(true);
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

  it("recognises a group @mention that names us by LID only when our LID is known", () => {
    const mentionByLid = wa({ remoteJid: GROUP, participant: "919028716240@s.whatsapp.net" }, {
      extendedTextMessage: { text: "@233079436239007 what is the status", contextInfo: { mentionedJid: [self.lid] } },
    });
    expect(toInbound(mentionByLid, self)?.mentionedSelf).toBe(true);
    expect(toInbound(mentionByLid, self)?.text).toBe("what is the status");
    // Why the plugin learns the LID from the group before giving up on it.
    expect(toInbound(mentionByLid, { jid: self.jid })?.mentionedSelf).toBe(false);
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

describe("LID addressing", () => {
  // WhatsApp increasingly addresses chats by LID rather than phone JID. The
  // owner's own chat arriving as <ownLid>@lid must still read as self chat —
  // missing it makes their notes to self look like a stranger's DM.
  it("recognises the owner's own chat when it arrives as a LID", () => {
    const msg = toInbound(wa({ remoteJid: self.lid!, id: "NOTE", fromMe: true }), self);
    expect(msg).toMatchObject({ selfChat: true, fromOwner: true, isGroup: false });
  });

  it("does not mistake somebody else's LID chat for the owner's", () => {
    const msg = toInbound(wa({ remoteJid: "25606746030208@lid", id: "DM", fromMe: false }), self);
    expect(msg?.selfChat).toBeUndefined();
  });

  it("still recognises the own chat by phone JID, for sessions with no LID", () => {
    const noLid = { jid: self.jid };
    const msg = toInbound(wa({ remoteJid: self.jid, id: "NOTE", fromMe: true }), noLid);
    expect(msg?.selfChat).toBe(true);
  });
});
