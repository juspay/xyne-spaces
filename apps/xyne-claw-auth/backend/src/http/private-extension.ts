import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Express, RequestHandler } from "express";
import { createLogger } from "../logger.js";
import { errMsg } from "../lib/errors.js";

const log = createLogger("private-extension");

export interface PrivateExtensionContext {
  base: string;
  requireAuth: RequestHandler;
  requireNoAccessToken: RequestHandler;
}

export interface PrivateExtension {
  mount(app: Express, context: PrivateExtensionContext): void;
  start?(): void;
  stop?(): Promise<void>;
}

async function loadPrivateExtension(): Promise<PrivateExtension | null> {
  const entry = fileURLToPath(new URL("../private/index.ts", import.meta.url));
  if (!existsSync(entry)) return null;
  try {
    const loaded = (await import(pathToFileURL(entry).href)) as { default?: PrivateExtension };
    if (!loaded.default || typeof loaded.default.mount !== "function") {
      log.error(`[private-extension] ${entry} has no default export with mount()`);
      return null;
    }
    log.info(`[private-extension] loaded ${entry}`);
    return loaded.default;
  } catch (err) {
    log.error(`[private-extension] failed to load ${entry}: ${errMsg(err)}`);
    return null;
  }
}

export const privateExtension: PrivateExtension | null = await loadPrivateExtension();
