/**
 * Boot wiring: register every channel plugin, then start the account manager
 * (boot/workers.ts calls these as one WorkerEntry). Shutdown runs BEFORE
 * redis.disconnect() so lease releases and socket closes reach Redis/the
 * messenger and another pod takes over within one sweep.
 */
import { accountManager } from "./account-manager.js";
import { closeOutboxWaiters } from "./delivery.js";
import { registerChannel } from "./plugin.js";
import { createLogger } from "../../logger.js";
import { teamsPlugin } from "../teams/plugin.js";
import { teamsChannelEnabled } from "../teams/schema.js";
import { whatsappCloudPlugin } from "../whatsapp-cloud/plugin.js";
import { whatsappPlugin } from "../whatsapp/plugin.js";

const log = createLogger("channels");
let registered = false;

function registerChannels(): void {
  if (registered) return;
  registered = true;
  registerChannel(whatsappPlugin);
  registerChannel(whatsappCloudPlugin);
  // Unregistered ⇒ its webhook 404s, its accounts never start and the admin
  // API answers "Unknown channel" — the flag off is as if it did not exist.
  if (teamsChannelEnabled()) {
    registerChannel(teamsPlugin);
    log.info("[channels] Microsoft Teams channel enabled (TEAMS_CHANNEL_ENABLED)");
  }
}

export function initMessagingAccountManager(): void {
  registerChannels();
  accountManager.start();
}

export async function closeMessagingAccountManager(): Promise<void> {
  await accountManager.stop();
  await closeOutboxWaiters();
}
