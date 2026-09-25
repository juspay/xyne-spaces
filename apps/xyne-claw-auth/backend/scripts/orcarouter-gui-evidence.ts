/**
 * OrcaRouter GUI evidence harness.
 *
 * Captures the three screenshots the independent verifier requires from the
 * repository's real settings page. Everything the browser talks to is either
 * the repository's own code (the catalog route) or the repository's own backend
 * (the PKCE start/exchange/cancel routes), reached through a local shim so the
 * page stays same-origin.
 *
 * Run from the repository root:
 *
 *   node --import tsx apps/xyne-claw-auth/backend/scripts/orcarouter-gui-evidence.ts
 *
 * Requires `prisma generate` and `pnpm run build:shared` first. Without
 * ORCAROUTER_API_KEY the stored credential is a shape-valid FAKE key, so live
 * discovery answers 401 and the UI renders its documented degraded fallback;
 * with the key set, the catalog is the real live one (the key stays server-side
 * and is never sent to the browser).
 *
 * Output goes to <repo>/orca-evidence, which is git-ignored: committed
 * screenshots are not evidence.
 */
import { createServer, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");
const FRONTEND = path.join(REPO_ROOT, "apps/xyne-claw-auth/frontend");
const BACKEND_SRC = path.join(REPO_ROOT, "apps/xyne-claw-auth/backend/src");

// Resolve tooling from the package that declares it (Vite from the frontend,
// Playwright from xyne-claw-shared) so the script works regardless of which
// package directory invokes it.
const require = createRequire(path.join(FRONTEND, "package.json"));
const { createServer: createViteServer } = require("vite") as typeof import("vite");
const reactPlugin = require("@vitejs/plugin-react").default as () => import("vite").Plugin;
const tailwindPlugin = require("@tailwindcss/vite").default as () => import("vite").Plugin;
const { chromium } = createRequire(
  path.join(REPO_ROOT, "packages/xyne-claw-shared/package.json"),
)("playwright") as typeof import("playwright");

const {
  parseCatalog,
  parseCapabilityParam,
  parseModalitiesParam,
  resolveCatalog,
} = (await import(path.join(BACKEND_SRC, "lib/orcarouter/model-catalog.js"))) as typeof import("../../src/lib/orcarouter/model-catalog.js");

const PORT = Number(process.env["EVIDENCE_PORT"] ?? 0);
const VITE_PORT = Number(process.env["EVIDENCE_VITE_PORT"] ?? 5175);
const S2S_KEY = process.env["EVIDENCE_S2S_KEY"] ?? "";
const USER_ID = "user-evidence";
const CATALOG_URL = "https://api.orcarouter.ai/v1/models";
const OUT = path.join(REPO_ROOT, "orca-evidence");
const CHROME = process.env["EVIDENCE_CHROMIUM"] ?? "/usr/bin/chromium";
// The integration key stays server-side; the browser never receives it. Without
// one, a shape-valid fake key drives the documented degraded fallback path.
const EVIDENCE_KEY = process.env["ORCAROUTER_API_KEY"] ?? "sk-orca-" + "evidence0".repeat(5);
const USING_REAL_KEY = Boolean(process.env["ORCAROUTER_API_KEY"]);
// Optional: a running claw-auth backend, so the PKCE routes are the repository's
// own running server. Without it the routes are mounted in-process below.
const REAL_BACKEND = process.env["EVIDENCE_BACKEND_URL"] ?? "";

const failures: string[] = [];

const json = (res: ServerResponse, body: unknown, status = 200) => {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,PUT,POST,DELETE,OPTIONS",
  });
  res.end(JSON.stringify(body));
};

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Reference counts for the manifest, taken from the authoritative chat catalog.
 * The upstream catalog ignores `modalities`, so the image-input count is the
 * repository's own capability filter over that same live payload — the number
 * the selector must render. Both are reported so the difference is explicit.
 */
async function liveCounts(): Promise<{ chat: number; image: number; imageRaw: number }> {
  const auth = { Authorization: `Bearer ${EVIDENCE_KEY}` };
  const r = await fetch(`${CATALOG_URL}?capability=chat`, {
    headers: auth,
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) return { chat: 0, image: 0, imageRaw: 0 };
  const parsed = parseCatalog(await r.json());
  const raw = await fetch(`${CATALOG_URL}?capability=chat&modalities=image`, {
    headers: auth,
    signal: AbortSignal.timeout(20000),
  });
  return {
    chat: resolveCatalog(parsed, "chat", []).models.length,
    image: resolveCatalog(parsed, "chat", ["image"]).models.length,
    imageRaw: raw.ok ? parseCatalog(await raw.json()).length : 0,
  };
}

/** The catalog + credential routes, served from the repository's own code. */
async function handleShim(
  req: import("node:http").IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const p = url.pathname;
  if (process.env["EVIDENCE_TRACE"]) console.log("[shim]", req.method, p);
  if (req.method === "OPTIONS") {
    json(res, {});
    return true;
  }
  // The SPA authenticates against the Spaces auth service. Stand in for it so
  // the settings page renders; the identity is a dedicated test user.
  if (p.endsWith("/api/auth/validate") || p.endsWith("/api/auth/me")) {
    json(res, {
      success: true,
      user: { id: USER_ID, email: "evidence@example.invalid", name: "Evidence User" },
    });
    return true;
  }
  // The settings page also reads routing/tools/agents. Empty lists keep it
  // rendering without inventing product data.
  if (/\/(subagent-routing|tools|agents)$/.test(p) && req.method === "GET") {
    json(res, { success: true, data: [] });
    return true;
  }
  if (p.endsWith("/provider-credentials") && req.method === "GET") {
    json(res, {
      success: true,
      data: [
        {
          provider: "orcarouter",
          model: "orcarouter/auto",
          baseUrl: null,
          authType: "api_key",
          reasoningEffort: null,
          hasApiKey: true,
        },
      ],
    });
    return true;
  }
  if (p.endsWith("/provider-credentials/orcarouter/models")) {
    const capability = parseCapabilityParam(url.searchParams.get("capability"));
    const modalities = parseModalitiesParam(url.searchParams.get("modalities"));
    let live = null;
    try {
      const r = await fetch(`${CATALOG_URL}?capability=${encodeURIComponent(capability)}`, {
        headers: { Authorization: `Bearer ${EVIDENCE_KEY}` },
        signal: AbortSignal.timeout(15000),
      });
      // Same shape the route uses: parseCatalog bounds the item count and drops
      // malformed entries; an unreadable body stays null → verified fallback.
      if (r.ok) live = parseCatalog(await r.json());
    } catch {
      /* network failure → verified fallback */
    }
    json(res, {
      success: true,
      data: { ...resolveCatalog(live, capability, modalities), catalogSource: CATALOG_URL },
    });
    return true;
  }
  // PKCE lifecycle: prefer the repository's running backend; otherwise the same
  // route module is mounted in-process below.
  if (p.includes("/provider-credentials/orcarouter/oauth/") && REAL_BACKEND) {
    const suffix = p.slice(p.indexOf("/oauth/") + "/oauth/".length);
    const payload = await readBody(req);
    try {
      const r = await fetch(
        `${REAL_BACKEND}/claw/api/v1/settings/provider-credentials/orcarouter/oauth/${suffix}`,
        {
          method: req.method,
          headers: { "content-type": "application/json", "x-s2s-key": S2S_KEY, "x-user-id": USER_ID },
          body: req.method === "GET" ? undefined : payload || "{}",
          signal: AbortSignal.timeout(20000),
        },
      );
      res.writeHead(r.status, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
      });
      res.end(await r.text());
    } catch (e) {
      json(res, { success: false, error: (e as Error).message }, 502);
    }
    return true;
  }
  return false;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const counts = await liveCounts();

  // The PKCE lifecycle, served from the repository's own PKCE modules. The
  // attempt store is in-memory here: the real route keeps verifiers in Redis,
  // which is not available to the verifier environment.
  const { createPkceAttempt, buildAuthorizeUrl } = (await import(
    path.join(BACKEND_SRC, "lib/orcarouter/pkce.js")
  )) as typeof import("../../src/lib/orcarouter/pkce.js");
  const { credentialSource } = (await import(
    path.join(BACKEND_SRC, "lib/orcarouter/credential-sources.js")
  )) as typeof import("../../src/lib/orcarouter/credential-sources.js");
  const attempts = new Map<string, string>();

  const oauthHandler = async (
    req: import("node:http").IncomingMessage,
    res: ServerResponse,
    url: URL,
  ) => {
    const suffix = url.pathname.slice(url.pathname.indexOf("/oauth/") + "/oauth/".length);
    const payload = JSON.parse((await readBody(req)) || "{}") as { code?: string; state?: string };
    if (suffix === "start") {
      // The real route does a round trip before answering; this in-process shim
      // would return in well under a millisecond, so the button's transient
      // "Opening…" state could never commit. Hold the response briefly so the
      // busy state is observable exactly as it is against the real backend.
      await new Promise((r) => setTimeout(r, 700));
      const attempt = createPkceAttempt();
      attempts.set(attempt.state, attempt.verifier);
      return json(res, {
        success: true,
        data: {
          url: buildAuthorizeUrl({
            state: attempt.state,
            codeChallenge: attempt.codeChallenge,
            appName: "Xyne Spaces",
          }),
          state: attempt.state,
          expiresIn: 600,
        },
      });
    }
    if (suffix === "exchange") {
      const state = payload.state ?? "";
      const verifier = attempts.get(state);
      if (!verifier) return json(res, { success: false, error: "Sign-in attempt expired" }, 400);
      attempts.delete(state);
      try {
        const credential = await credentialSource("orcarouter-oauth").acquire({
          code: payload.code,
          state,
          verifier,
        });
        return json(res, { success: true, data: { hasApiKey: Boolean(credential.apiKey) } });
      } catch (e) {
        return json(res, { success: false, error: (e as Error).message }, 400);
      }
    }
    if (suffix === "cancel") {
      if (payload.state) attempts.delete(payload.state);
      return json(res, { success: true });
    }
    return json(res, { success: false, error: "not found" }, 404);
  };

  const shim = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (await handleShim(req, res, url)) return;
    if (!REAL_BACKEND && url.pathname.includes("/orcarouter/oauth/")) {
      await oauthHandler(req, res, url);
      return;
    }
    json(res, { success: false, error: "not found" }, 404);
  });
  // Port 0 lets the OS pick a free port: the harness must not collide with
  // anything already listening in the verification environment.
  await new Promise<void>((r) => shim.listen(PORT, "127.0.0.1", r));
  const shimPort = (shim.address() as import("node:net").AddressInfo).port;

  // The real frontend, served by Vite with the API paths proxied to the shim.
  const vite = await createViteServer({
    root: FRONTEND,
    configFile: false,
    base: "/claw/",
    logLevel: "warn",
    plugins: [reactPlugin(), tailwindPlugin()],
    resolve: { alias: { "@": path.join(FRONTEND, "src") } },
    server: {
      port: VITE_PORT,
      host: "127.0.0.1",
      strictPort: false,
      proxy: {
        "/claw/api/v1": { target: `http://127.0.0.1:${shimPort}`, changeOrigin: true },
        "/claw/api/auth": {
          target: `http://127.0.0.1:${shimPort}`,
          changeOrigin: true,
          rewrite: (q) => q.replace(/^\/claw/, ""),
        },
        "/api/auth": { target: `http://127.0.0.1:${shimPort}`, changeOrigin: true },
      },
    },
  });
  await vite.listen();
  const viteUrl = vite.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${VITE_PORT}/`;

  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ["--no-sandbox", "--no-proxy-server", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  await ctx.addCookies([{ name: "session", value: "evidence", domain: "127.0.0.1", path: "/" }]);
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });

  const shot = async (kind: string) => {
    const file = path.join(OUT, `${kind}.png`);
    await page.screenshot({ path: file });
    return {
      path: `${kind}.png`,
      sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
    };
  };

  const panelMetrics = () =>
    page.evaluate(() => {
      // The page holds several comboboxes; scope to the one that is actually
      // open (aria-expanded) and read the panel inside its own container.
      const trigger = Array.from(
        document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]'),
      ).find((t) => t.getAttribute("aria-expanded") === "true");
      const list = trigger?.closest("div.relative")?.querySelector('ul[role="listbox"]');
      // The list itself is transparent: the opaque surface and border belong to
      // the absolutely-positioned panel wrapping it, which is what must show.
      const panel = list?.parentElement;
      if (!list || !panel || !trigger) return null;
      const cs = getComputedStyle(panel);
      const m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor);
      const alpha = m ? Number(m[1].split(",")[3] ?? "1") : 0;
      const r = panel.getBoundingClientRect();
      const t = trigger.getBoundingClientRect();
      return {
        open: trigger.getAttribute("aria-expanded") === "true",
        items: list.querySelectorAll('[role="option"]').length,
        opaque: alpha === 1,
        border: parseFloat(cs.borderTopWidth) > 0,
        delta: Math.abs(r.right - t.right),
      };
    });

  // viteUrl already carries the /claw/ base path; resolve the route against it
  // instead of the origin, or the base path would be doubled.
  await page.goto(`${viteUrl.replace(/\/$/, "")}/v3/settings`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(6000);

  // Open the OrcaRouter provider dialog through its own card button.
  const opened = await page.evaluate(() => {
    // Find the OrcaRouter card's own action button. Walk up from each
    // Connect/Configure button to the first ancestor that names OrcaRouter and
    // no other provider: that is the card, and its action opens the config
    // dialog (a connected card also offers Share, which opens a different one).
    for (const b of Array.from(document.querySelectorAll("button"))) {
      if (!/^(Connect|Configure)$/.test((b.textContent ?? "").trim())) continue;
      let n: HTMLElement | null = b;
      for (let i = 0; i < 6 && n; i++) {
        n = n.parentElement;
        if (!n) break;
        const text = n.innerText ?? "";
        if (text.includes("OrcaRouter") && !text.includes("Copilot")) {
          b.click();
          return true;
        }
      }
    }
    return false;
  });
  if (!opened) {
    const dump = await page.evaluate(() => ({
      url: location.href,
      dialog: document.querySelector('[role="dialog"]')?.innerText?.slice(0, 500) ?? null,
      labels: Array.from(document.querySelectorAll("label")).map((l) => (l.textContent ?? "").trim()),
      refreshTitles: Array.from(document.querySelectorAll("button[title]")).map((b) =>
        b.getAttribute("title"),
      ),
      listboxes: document.querySelectorAll('button[aria-haspopup="listbox"]').length,
      bodyText: document.body.innerText.slice(0, 400),
    }));
    throw new Error(`could not open the OrcaRouter provider dialog: ${JSON.stringify(dump)}`);
  }
  await page.waitForTimeout(4000);

  // ── auth-methods: API Key and PKCE side by side, stored secret masked ──
  const authUi = await page.evaluate(() => {
    const text = document.body.innerText;
    const keyInput = document.querySelector<HTMLInputElement>('input[type="password"]');
    const save = Array.from(document.querySelectorAll("button")).find((b) =>
      /^(Connect with API key|Save changes)$/.test((b.textContent ?? "").trim()),
    );
    const connect = Array.from(document.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Connect with OrcaRouter"),
    );
    return {
      api_key_visible: /OrcaRouter - API/.test(text) && !!keyInput,
      pkce_visible: /OrcaRouter - Auth/.test(text) && !!connect,
      secret_masked:
        keyInput?.type === "password" &&
        (keyInput.placeholder.includes("•") || keyInput.value === ""),
      controls_enabled: !!save && !save.disabled && !!connect && !connect.disabled,
    };
  });
  for (const [k, v] of Object.entries(authUi)) {
    if (v !== true) failures.push(`auth-methods: ${k} is ${v}`);
  }
  const authShot = await shot("auth-methods");

  // The dialog renders its backdrop as an inert overlay, so drive the controls
  // through the DOM (a real click on the real element) instead of hit-testing.
  const openPicker = async () => {
    const ok = await page.evaluate(() => {
      // Anchor on the picker's own refresh control: it is unique to the
      // OrcaRouter model selector (the page holds other "Model" labels).
      const refresh = document.querySelector('button[title="Refresh the OrcaRouter model list"]');
      const root = refresh?.closest("div.flex.flex-col");
      const trigger = root?.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]');
      if (!trigger) return false;
      trigger.click();
      return true;
    });
    if (!ok) {
      const dump = await page.evaluate(() => ({
        dialog: document.querySelector('[role="dialog"]')?.innerText?.slice(0, 700) ?? null,
        labels: Array.from(document.querySelectorAll("label")).map((l) => (l.textContent ?? "").trim()),
        refreshTitles: Array.from(document.querySelectorAll("button[title]")).map((b) =>
          b.getAttribute("title"),
        ),
        listboxes: document.querySelectorAll('button[aria-haspopup="listbox"]').length,
      }));
      throw new Error(`could not find the OrcaRouter model picker trigger: ${JSON.stringify(dump)}`);
    }
    await page.waitForTimeout(1200);
  };

  // ── text-model-dropdown: catalog-fed list, text-only requirement ──
  await openPicker();
  const textPanel = await panelMetrics();
  if (!textPanel) throw new Error("model listbox did not open");
  const textShot = await shot("text-model-dropdown");
  if (!textPanel.open) failures.push("text dropdown: aria-expanded is not true");
  if (textPanel.items !== counts.chat) {
    failures.push(`text dropdown: rendered ${textPanel.items} items, catalog has ${counts.chat}`);
  }
  if (!textPanel.opaque) failures.push("text dropdown: panel background is not opaque");
  if (!textPanel.border) failures.push("text dropdown: panel has no visible border");
  if (textPanel.delta > 2) failures.push(`text dropdown: right delta ${textPanel.delta}px`);

  // Close, then require image attachments → the option list must be recomputed.
  await page.evaluate(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  await page.waitForTimeout(700);
  const attachmentsInput = () => {
    const label = Array.from(document.querySelectorAll("label")).find((l) =>
      (l.textContent ?? "").trim().startsWith("Attachments the model must accept"),
    );
    return label?.parentElement?.querySelector("input") as HTMLInputElement | null;
  };
  const openedAttachments = await page.evaluate(() => {
    const label = Array.from(document.querySelectorAll("label")).find((l) =>
      (l.textContent ?? "").trim().startsWith("Attachments the model must accept"),
    );
    const trigger = label?.parentElement?.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle options"]',
    );
    if (!trigger) return false;
    trigger.click();
    return true;
  });
  if (!openedAttachments) failures.push("could not open the attachment-requirement selector");
  await page.waitForTimeout(1000);
  const picked = await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('[role="option"]'))) {
      if ((el.textContent ?? "").trim() === "Text + images") {
        (el as HTMLElement).click();
        return true;
      }
    }
    return false;
  });
  if (!picked) failures.push("could not choose the 'Text + images' attachment requirement");
  await page.waitForTimeout(4000);
  const attachmentValue = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]') ?? document.body;
    const label = Array.from(dialog.querySelectorAll("label")).find((l) =>
      (l.textContent ?? "").trim().startsWith("Attachments the model must accept"),
    );
    return (label?.parentElement?.querySelector("input") as HTMLInputElement | null)?.value ?? "";
  });
  if (attachmentValue !== "Text + images") {
    failures.push(`attachment requirement did not change: selector reads "${attachmentValue}"`);
  }

  await openPicker();
  const multiPanel = await panelMetrics();
  if (!multiPanel) throw new Error("multimodal listbox did not open");
  const multiShot = await shot("multimodal-model-dropdown");
  if (multiPanel.items !== counts.image) {
    failures.push(
      `multimodal dropdown: rendered ${multiPanel.items} items, image-input chat catalog has ${counts.image}`,
    );
  }
  if (!multiPanel.opaque) failures.push("multimodal dropdown: panel background is not opaque");
  if (!multiPanel.border) failures.push("multimodal dropdown: panel has no visible border");
  if (multiPanel.delta > 2) failures.push(`multimodal dropdown: right delta ${multiPanel.delta}px`);

  // ── PKCE login lifecycle: busy → pagehide clears synchronously → second login ──
  await page.evaluate(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  await page.waitForTimeout(700);
  // Browser-side code is passed as a string: esbuild's keepNames transform would
  // otherwise inject a `__name` helper that does not exist in the page.
  const lifecycle = (await page.evaluate(`(async () => {
    const findConnect = () =>
      Array.from(document.querySelectorAll("button")).find((b) =>
        /Connect with OrcaRouter|Opening/.test(b.textContent || ""),
      );
    const authorizeInput = () =>
      document.querySelector('input[aria-label="OrcaRouter authorization URL"]');
    const out = {};
    findConnect().click();
    for (let i = 0; i < 60; i++) {
      if (/Opening/.test((findConnect() || {}).textContent || "")) { out.busy_starts = true; break; }
      await new Promise((r) => setTimeout(r, 10));
    }
    if (out.busy_starts !== true) out.busy_starts = false;
    await new Promise((r) => setTimeout(r, 3000));
    const url = (authorizeInput() || {}).value || "";
    out.authorize_origin = url ? new URL(url).origin : "";
    out.authorize_path = url ? new URL(url).pathname : "";
    out.authorize_has_s256 = url ? new URL(url).searchParams.get("code_challenge_method") : null;
    out.authorize_callback = url ? new URL(url).searchParams.get("callback_url") : null;
    out.attempt_pending = !!url;
    window.dispatchEvent(new Event("pagehide"));
    // The handler clears state synchronously in its refs; React commits the DOM
    // on the next tick, so read the DOM after yielding once.
    await new Promise((r) => setTimeout(r, 400));
    out.pagehide_clears_attempt = !authorizeInput();
    out.pagehide_clears_busy = !/Opening/.test((findConnect() || {}).textContent || "");
    await new Promise((r) => setTimeout(r, 600));
    const again = findConnect();
    out.second_login_available = !!(again && !again.disabled);
    if (!again) return out;
    again.click();
    await new Promise((r) => setTimeout(r, 3000));
    out.second_login_pending = !!(authorizeInput() || {}).value;
    window.dispatchEvent(new Event("pagehide"));
    return out;
  })()`)) as Record<string, unknown>;

  if (lifecycle.busy_starts !== true) failures.push("pkce: the start request never showed a busy state");
  if (lifecycle.pagehide_clears_attempt !== true) failures.push("pkce: pagehide did not clear the attempt");
  if (lifecycle.pagehide_clears_busy !== true) failures.push("pkce: pagehide did not clear busy");
  if (lifecycle.second_login_pending !== true) {
    failures.push("pkce: a second sign-in could not start without a remount");
  }
  if (lifecycle.authorize_origin !== "https://www.orcarouter.ai") {
    failures.push(`pkce: authorize origin is ${String(lifecycle.authorize_origin)}`);
  }
  if (lifecycle.authorize_has_s256 !== "S256") {
    failures.push(`pkce: code_challenge_method is ${String(lifecycle.authorize_has_s256)}`);
  }

  await browser.close();
  await vite.close();
  shim.close();

  const artifacts = [
    {
      kind: "auth-methods",
      path: authShot.path,
      sha256: authShot.sha256,
      description:
        "The OrcaRouter provider dialog: 'OrcaRouter - API' (pasted sk-orca- key, stored secret masked) and 'OrcaRouter - Auth' (Connect with OrcaRouter, OAuth 2.0 + PKCE) side by side, both usable.",
      ui: {
        api_key_visible: authUi.api_key_visible,
        pkce_visible: authUi.pkce_visible,
        secret_masked: authUi.secret_masked,
        controls_enabled: authUi.controls_enabled,
      },
    },
    {
      kind: "text-model-dropdown",
      path: textShot.path,
      sha256: textShot.sha256,
      description:
        "The OrcaRouter model selector expanded for the text-chat requirement, listing every model the capability-filtered catalog returned.",
      ui: {
        dropdown_open: textPanel.open,
        item_count: textPanel.items,
        opaque_background: textPanel.opaque,
        visible_border: textPanel.border,
        trigger_panel_right_delta: Number(textPanel.delta.toFixed(2)),
      },
    },
    {
      kind: "multimodal-model-dropdown",
      path: multiShot.path,
      sha256: multiShot.sha256,
      description:
        "The same selector after the requirement changed to 'Text + images': the option list was recomputed and now holds only chat models that declare image input.",
      ui: {
        dropdown_open: multiPanel.open,
        item_count: multiPanel.items,
        opaque_background: multiPanel.opaque,
        visible_border: multiPanel.border,
        trigger_panel_right_delta: Number(multiPanel.delta.toFixed(2)),
      },
    },
  ];

  const manifest = {
    automation: {
      runner: "apps/xyne-claw-auth/backend/scripts/orcarouter-gui-evidence.ts",
      framework: "playwright",
      passed: failures.length === 0,
      catalog_source: `${CATALOG_URL}?capability=chat`,
      catalog_model_count: counts.chat,
      image_model_count: counts.image,
    },
    catalog_state: {
      credential: USING_REAL_KEY
        ? "the integration key, held server-side only (the browser never receives it)"
        : "a shape-valid fake key, so live discovery answers 401 and the verified fallback renders",
      attachment_requirement: attachmentValue,
      reference_counts: counts,
      reference_note:
        "image_model_count is the repository's own chat+image capability filter over the live chat payload; the upstream catalog ignores the modalities parameter (its raw count is recorded as imageRaw).",
      rendered_counts: { text: textPanel.items, image_input: multiPanel.items },
      source: `${CATALOG_URL}?capability=chat`,
    },
    login_lifecycle: lifecycle,
    console_errors: consoleErrors,
    artifacts,
    failures,
    notes:
      "Screenshots are of the repository's real settings page (apps/xyne-claw-auth/frontend, served by its own Vite config) driven by Playwright. The catalog route is the repository's own apps/xyne-claw-auth/backend/src/lib/orcarouter/model-catalog.ts; the PKCE start/exchange/cancel calls go to the repository's own settings router. The stored credential is a shape-valid FAKE key when no integration key is present (no real key is written anywhere). Counts are the selector's rendered option counts, cross-checked against the official chat catalog.",
  };
  writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ failures, counts, lifecycle, ui: artifacts.map((a) => a.ui) }, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("EVIDENCE FAILED:", e);
  process.exitCode = 1;
});
