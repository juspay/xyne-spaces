/**
 * WhatsApp Business Cloud API: config residue and the secrets an admin
 * supplies at connect time. Unlike the Baileys channel there is nothing to
 * scan — the account is a phone number registered to a WhatsApp Business
 * Account, addressed by its Phone Number ID and a system-user token.
 */
import { z } from "zod";

/** Graph API version the plugin talks. Pinned, not floating: Meta ships
 *  breaking changes per version and deprecates old ones on a schedule. */
export const GRAPH_VERSION = "v23.0";
export const GRAPH_ORIGIN = "https://graph.facebook.com";

export const SECRET_PHONE_NUMBER_ID = "phone-number-id";
export const SECRET_ACCESS_TOKEN = "access-token";
export const SECRET_APP_SECRET = "app-secret";
export const SECRET_VERIFY_TOKEN = "verify-token";

export const whatsappCloudConfigSchema = z
  .object({
    /** Shown in the admin UI; the authoritative id lives in the secret store. */
    displayPhoneNumber: z.string().trim().optional(),
    /** Same agent-action gates as the Baileys channel. */
    agentActions: z
      .object({
        sendToOtherChats: z.boolean().default(false),
        reactions: z.boolean().default(true),
        listGroups: z.boolean().default(false),
      })
      .default({ sendToOtherChats: false, reactions: true, listGroups: false }),
  })
  .strict();
export type WhatsAppCloudConfig = z.infer<typeof whatsappCloudConfigSchema>;

/** Meta addresses users by bare digits ("919876543210"), no JID suffix. */
export function waIdFromTarget(target: string): string | null {
  const digits = target.trim().replace(/[\s()+-]/g, "");
  return /^\d{6,20}$/.test(digits) ? digits : null;
}
