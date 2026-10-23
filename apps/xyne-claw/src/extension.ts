/**
 * Loads the private extension at src/extensions/index.ts when the file exists (the path is gitignored;
 * the private deployment supplies it). It may mount routes, and start and stop with the server.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Express, RequestHandler } from "express";
import { createLogger } from "./logger.js";

const log = createLogger("extension");

export interface ExtensionContext {
  validateS2SKey: RequestHandler;
}

export interface Extension {
  mount?(app: Express, context: ExtensionContext): void;
  start?(): void;
  stop?(): Promise<void>;
}

async function loadExtension(): Promise<Extension | null> {
  const entry = fileURLToPath(new URL("./extensions/index.ts", import.meta.url));
  if (!existsSync(entry)) return null;
  try {
    const loaded = (await import(pathToFileURL(entry).href)) as { default?: Extension };
    if (!loaded.default || typeof loaded.default !== "object") {
      log.error(`[extension] ${entry} has no default export`);
      return null;
    }
    log.info(`[extension] loaded ${entry}`);
    return loaded.default;
  } catch (err) {
    log.error(`[extension] failed to load ${entry}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export const extension: Extension | null = await loadExtension();
