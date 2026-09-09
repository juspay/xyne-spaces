/**
 * Contract for the app-side export API. The app implements
 * `GET {installedApp.webhookUrl}/export/messages` and this adapter is the client.
 *
 * Ordering: oldest-first. `nextCursor` continues pagination; absence marks
 * the terminal page.
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
  nextCursor?: string;
}
