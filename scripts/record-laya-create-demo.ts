/**
 * Record a short WebM of the Hub create page using Playwright video.
 * Requires a logged-in storage state OR runs against a public splash.
 *
 * Usage:
 *   cd apps/dashboard
 *   pnpm exec tsx ../../scripts/record-laya-create-demo.ts
 *
 * Optional:
 *   STORAGE_STATE=~/.xyne-spaces-storage.json  (from playwright state-save)
 *   CREATE_URL=http://localhost:5173/<workspaceId>/ai/library/agent/create
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const outDir = join(process.cwd(), "files/media/laya-validate");
mkdirSync(outDir, { recursive: true });

const createUrl =
  process.env["CREATE_URL"] ??
  "http://localhost:5173/cmsq33ux4001hw04qwoo1sci9/ai/library/agent/create";
const storage = process.env["STORAGE_STATE"];

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...(storage ? { storageState: storage } : {}),
    recordVideo: { dir: outDir, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.goto(createUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(800);

  // Local launch interstitial — stay in browser for recording.
  const continueBrowser = page.getByRole("button", { name: /continue in browser/i });
  if (await continueBrowser.isVisible().catch(() => false)) {
    await continueBrowser.click({ force: true });
    await page.waitForTimeout(1000);
  }
  const continueLink = page.getByText(/continue in browser/i).first();
  if (await continueLink.isVisible().catch(() => false)) {
    await continueLink.click({ force: true });
    await page.waitForTimeout(1000);
  }
  await page.evaluate(() => {
    document.querySelectorAll('[data-testid="open-in-desktop-app"]').forEach((el) => el.remove());
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, "02-record-open.png"), fullPage: true });

  const input = page.getByPlaceholder(/ask anything/i).first();
  if (await input.isVisible().catch(() => false)) {
    await input.click({ force: true });
    await input.fill(
      "Watch the support queue and ping me on Spaces when something looks stuck — read only",
    );
    await page.screenshot({ path: join(outDir, "03-record-typed.png"), fullPage: true });
    const send = page.getByRole("button", { name: /^send$/i }).first();
    if (await send.isEnabled().catch(() => false)) {
      await send.click({ force: true });
      await page.waitForTimeout(16_000);
    }
  } else {
    // Not logged in — still capture splash for the recording artifact.
    await page.waitForTimeout(2000);
  }

  await page.screenshot({ path: join(outDir, "04-record-end.png"), fullPage: true });
  const video = page.video();
  await context.close();
  await browser.close();
  const path = video ? await video.path() : null;
  console.log(JSON.stringify({ outDir, video: path }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
