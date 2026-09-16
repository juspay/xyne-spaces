/** WhatsApp-specific residue stored under `ConnectedSurface.config.channel`. */
import { z } from "zod";

export const whatsappChannelConfigSchema = z
  .object({
    /** Baileys "browser" label shown under Linked Devices on the phone. */
    deviceLabel: z.string().trim().min(1).max(40).default("Xyne Claw"),
    /** Mark the linked device online on connect (shows the number as active). */
    markOnline: z.boolean().default(false),
    /** Let the owner talk to the agent from the number's own "You" chat. */
    selfChat: z.boolean().default(true),
    /** What the AGENT may do on this number beyond replying in the current
     *  chat (OpenClaw's `actions` gates). */
    agentActions: z
      .object({
        /** Send to numbers/groups other than the chat that triggered the run. */
        sendToOtherChats: z.boolean().default(false),
        reactions: z.boolean().default(true),
        listGroups: z.boolean().default(true),
      })
      .default({ sendToOtherChats: false, reactions: true, listGroups: true }),
  })
  .strict();
export type WhatsAppChannelConfig = z.infer<typeof whatsappChannelConfigSchema>;

/** "+91 98765 43210" / "919876543210" → "919876543210@s.whatsapp.net"; JIDs pass through. */
export function jidFromTarget(target: string): string | null {
  const t = target.trim();
  if (!t) return null;
  if (/@(s\.whatsapp\.net|g\.us|lid|newsletter)$/.test(t)) return t;
  const digits = t.replace(/[\s()+-]/g, "");
  return /^\d{6,20}$/.test(digits) ? `${digits}@s.whatsapp.net` : null;
}

/** `9198765@s.whatsapp.net` → `9198765`; a LID or group id passes through. */
export function phoneFromJid(jid: string): string | null {
  const at = jid.indexOf("@");
  const local = at === -1 ? jid : jid.slice(0, at);
  const user = local.split(":")[0] ?? local;
  return jid.endsWith("@s.whatsapp.net") && /^\d+$/.test(user) ? user : null;
}
