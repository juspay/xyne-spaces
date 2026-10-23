import { chromium, type BrowserContext } from "playwright";
import type { Config } from "./config.js";

/**
 * A fresh browser for one meeting. Headed on purpose: Meet refuses headless Chrome
 * (containers run it on Xvfb). Closing the context closes the browser.
 */
export async function openBrowser(config: Pick<Config, "chromePath" | "browserChannel" | "muteAudio">): Promise<BrowserContext> {
  const { chromePath, browserChannel, muteAudio } = config;
  const browser = await chromium.launch({
    headless: false,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--disable-blink-features=AutomationControlled",
      "--lang=en-US",
      ...(muteAudio ? ["--mute-audio"] : []),
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    ...(chromePath && { executablePath: chromePath }),
    ...(browserChannel && { channel: browserChannel }),
  });
  const context = await browser.newContext({ bypassCSP: true, locale: "en-US", viewport: { width: 1280, height: 720 } });
  context.on("close", () => void browser.close().catch(() => undefined));
  return context;
}
