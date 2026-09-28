/**
 * Boot wiring: register every channel plugin, then start the account manager
 * (boot/workers.ts calls these as one WorkerEntry). Shutdown runs BEFORE
 * redis.disconnect() so lease releases and socket closes reach Redis/the
 * messenger and another pod takes over within one sweep.
 */
import { accountManager } from "./account-manager.js";
import { closeOutboxWaiters } from "./delivery.js";
import { registerChannel } from "./plugin.js";
import { whatsappCloudPlugin } from "../whatsapp-cloud/plugin.js";
import { whatsappPlugin } from "../whatsapp/plugin.js";

let registered = false;

function registerChannels(): void {
  if (registered) return;
  registered = true;
  registerChannel(whatsappPlugin);
  registerChannel(whatsappCloudPlugin);
}

export function initMessagingAccountManager(): void {
  registerChannels();
  accountManager.start();
}

export async function closeMessagingAccountManager(): Promise<void> {
  await accountManager.stop();
  await closeOutboxWaiters();
}
