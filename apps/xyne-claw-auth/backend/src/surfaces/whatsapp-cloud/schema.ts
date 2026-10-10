/**
 * WhatsApp Business Cloud API: config residue and the secrets an admin
 * supplies at connect time. Unlike the Baileys channel there is nothing to
 * scan — the account is a phone number registered to a WhatsApp Business
 * Account, addressed by its Phone Number ID and a system-user token.
 */
import { z } from "zod";
import { normalizePhoneDigits } from "../messaging/phone.js";
import { agentActionsSchema } from "../messaging/schema.js";

/** Graph API version the plugin talks. Pinned, not floating: Meta ships
 *  breaking changes per version and deprecates old ones on a schedule. */
export const GRAPH_VERSION = "v23.0";
/** Overridable ONLY so a local harness can stand in for Meta (see
 *  scripts/mock-whatsapp-cloud.ts); production never sets it. */
export const GRAPH_ORIGIN = process.env["WHATSAPP_GRAPH_ORIGIN"]?.trim() || "https://graph.facebook.com";

export const SECRET_PHONE_NUMBER_ID = "phone-number-id";
export const SECRET_ACCESS_TOKEN = "access-token";
export const SECRET_APP_SECRET = "app-secret";
export const SECRET_VERIFY_TOKEN = "verify-token";

export const whatsappCloudConfigSchema = z
  .object({
    /** No group support on this transport, so nothing to list. */
    agentActions: agentActionsSchema({ listGroups: false }),
    /**
     * An approved template whose body is one `{{1}}` parameter. Meta refuses
     * free-form text 24 hours after the person last wrote, which is exactly
     * when a scheduled agent tends to report back; the notification then goes
     * out through this instead. Without it such a message fails, and says so.
     */
    notificationTemplate: z
      .object({
        name: z.string().trim().min(1).max(512),
        language: z.string().trim().min(2).max(15).default("en"),
      })
      .optional(),
    /**
     * Optional template for the scheduled Daily Brief, same one-`{{1}}` shape.
     * A brief is a different message from an agent update, so it may have its
     * own approved wording ("Your brief for today: {{1}}"). Falls back to
     * notificationTemplate when unset.
     */
    dailyBriefTemplate: z
      .object({
        name: z.string().trim().min(1).max(512),
        language: z.string().trim().min(2).max(15).default("en"),
      })
      .optional(),
    /**
     * A published WhatsApp Flow built from questionFormFlowJson(). With it, a
     * multi-part question arrives as one native form; without it, as a
     * sequence of buttons and lists.
     */
    questionFormId: z.string().trim().regex(/^\d+$/).optional(),
  })
  .strict();
export type WhatsAppCloudConfig = z.infer<typeof whatsappCloudConfigSchema>;

/** Meta addresses users by bare digits ("919876543210"), no JID suffix. */
export function waIdFromTarget(target: string): string | null {
  return normalizePhoneDigits(target);
}
