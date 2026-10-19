import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Express, RequestHandler } from "express";
import { createLogger } from "../logger.js";
import { errMsg } from "../lib/errors.js";

const log = createLogger("extension");

export interface ExtensionContext {
  base: string;
  requireAuth: RequestHandler;
  requireNoAccessToken: RequestHandler;
}

export interface Extension {
  mount(app: Express, context: ExtensionContext): void;
  start?(): void;
  stop?(): Promise<void>;
}

async function loadExtension(): Promise<Extension | null> {
  const entry = fileURLToPath(new URL("../extensions/index.ts", import.meta.url));
  if (!existsSync(entry)) return null;
  try {
    const loaded = (await import(pathToFileURL(entry).href)) as { default?: Extension };
    if (!loaded.default || typeof loaded.default.mount !== "function") {
      log.error(`[extension] ${entry} has no default export with mount()`);
      return null;
    }
    log.info(`[extension] loaded ${entry}`);
    return loaded.default;
  } catch (err) {
    log.error(`[extension] failed to load ${entry}: ${errMsg(err)}`);
    return null;
  }
}

export const extension: Extension | null = await loadExtension();
