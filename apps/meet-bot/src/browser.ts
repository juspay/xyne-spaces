import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright";
import type { Config } from "./config.js";

/** One second of 48 kHz mono silence: what the fake microphone "hears". */
function silentWav(): string {
  const file = path.join(tmpdir(), "meet-bot-silence.wav");
  if (existsSync(file)) return file;
  const samples = 48_000;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples * 2, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(48_000, 24);
  header.writeUInt32LE(48_000 * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(samples * 2, 40);
  writeFileSync(file, Buffer.concat([header, Buffer.alloc(samples * 2)]));
  return file;
}

/**
 * A fresh browser for one meeting. Headed on purpose: Meet refuses headless Chrome
 * (containers run it on Xvfb). Closing the context closes the browser.
 *
 * `fakeMediaDevices`: some pages (Teams) wait for a camera and mic before showing
 * their join screen. These are Chrome's fake devices — a test-pattern camera and a
 * mic playing silence — granted without a prompt, so the bot can never send real
 * audio or video even if a toggle is left on (it turns both off anyway).
 */
export async function openBrowser(
  config: Pick<Config, "chromePath" | "browserChannel" | "muteAudio">,
  options: { fakeMediaDevices?: boolean } = {},
): Promise<BrowserContext> {
  const { chromePath, browserChannel, muteAudio } = config;
  const browser = await chromium.launch({
    headless: false,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--disable-blink-features=AutomationControlled",
      "--lang=en-US",
      ...(muteAudio ? ["--mute-audio"] : []),
      ...(options.fakeMediaDevices
        ? [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            `--use-file-for-fake-audio-capture=${silentWav()}`,
          ]
        : []),
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    ...(chromePath && { executablePath: chromePath }),
    ...(browserChannel && { channel: browserChannel }),
  });
  const context = await browser.newContext({
    bypassCSP: true,
    locale: "en-US",
    viewport: { width: 1280, height: 720 },
    ...(options.fakeMediaDevices && { permissions: ["camera", "microphone"] }),
  });
  context.on("close", () => void browser.close().catch(() => undefined));
  return context;
}
