/**
 * Response contract for the app-side export API; this adapter is the client.
 *
 * The *request* side is per-install configuration, not a fixed shape — the
 * endpoint, method and body template live in `installed_apps.fetchConfig` and are
 * described by AppFetchConfigSchema (apps/core/appFetchConfig.ts). Only the
 * response shape below is fixed, so an app may expose its history wherever and
 * however it likes as long as it answers in this form.
 *
 * Ordering: oldest-first. `nextCursor` continues pagination; absence marks
 * the terminal page.
 *
 * See integrations/README.md, "History export API", for the full contract:
 * request rendering, the signature scheme and throttling.
 */

export interface AppDeskExportSender {
  email: string;
  name?: string;
}

export interface AppDeskExportMessage {
  externalId: string;
  externalThreadId?: string;
  subject?: string;
  body: string;
  sender: AppDeskExportSender;
  recipients?: string[];
  sentAt: string;
}

export interface AppDeskExportPage {
  messages: AppDeskExportMessage[];
  invalidRows: string[];
  nextCursor?: string;
}
