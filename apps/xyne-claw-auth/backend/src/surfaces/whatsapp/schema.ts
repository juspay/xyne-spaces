/** WhatsApp-specific residue stored under `ConnectedSurface.config.channel`. */
import { z } from "zod";
import { normalizePhoneDigits } from "../messaging/phone.js";
import { agentActionsSchema } from "../messaging/schema.js";

export const whatsappChannelConfigSchema = z
  .object({
    /** Baileys "browser" label shown under Linked Devices on the phone. */
    deviceLabel: z.string().trim().min(1).max(40).default("Xyne Claw"),
    /** Mark the linked device online on connect (shows the number as active). */
    markOnline: z.boolean().default(false),
    /** Let the owner talk to the agent from the number's own "You" chat. */
    selfChat: z.boolean().default(true),
    agentActions: agentActionsSchema(),
  })
  .strict();
export type WhatsAppChannelConfig = z.infer<typeof whatsappChannelConfigSchema>;

/** "+91 98765 43210" / "919876543210" → "919876543210@s.whatsapp.net"; JIDs pass through. */
export function jidFromTarget(target: string): string | null {
  const t = target.trim();
  if (!t) return null;
  if (/@(s\.whatsapp\.net|g\.us|lid|newsletter)$/.test(t)) return t;
  const digits = normalizePhoneDigits(t);
  return digits ? `${digits}@s.whatsapp.net` : null;
}

/** `9198765@s.whatsapp.net` → `9198765`; a LID or group id passes through. */
export function phoneFromJid(jid: string): string | null {
  const at = jid.indexOf("@");
  const local = at === -1 ? jid : jid.slice(0, at);
  const user = local.split(":")[0] ?? local;
  return jid.endsWith("@s.whatsapp.net") && /^\d+$/.test(user) ? user : null;
}
