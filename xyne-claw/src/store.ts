import { mkdirSync } from "node:fs";
import { PATHS } from "./config.js";

export function initStore(): void {
  mkdirSync(PATHS.dataDir, { recursive: true });
}
