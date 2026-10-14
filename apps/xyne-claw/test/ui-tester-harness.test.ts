import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { DOM_AUDIT_SOURCE, HARNESS_SOURCE } from "../src/ui-tester/harness.js";

const nodePath = process.env["UI_TESTER_PLAYWRIGHT_NODE_PATH"];
let hasPlaywright = false;
try {
  createRequire(nodePath ? join(nodePath, "x.js") : import.meta.url).resolve("playwright");
  hasPlaywright = true;
} catch {
  hasPlaywright = false;
}

const PAGE = `<!doctype html><html><head><link rel="stylesheet" href="http://10.255.255.1/never-answers.css"><link rel="preconnect" href="https://fonts.gstatic.com"></head><body><div id="app">loading</div><script>
fetch("/api/v1/items").then(async (r) => {
  const body = await r.json();
  const app = document.getElementById("app");
  if (!r.ok) { app.innerHTML = '<div role="alert">Server error</div><div role="alert">Server error</div>'; return; }
  app.innerHTML = '<p>Total: ' + body.total + '</p>' + body.items.map((i) => '<div style="width:' + (i.wide ? 900 : 200) + 'px">' + i.name + '</div>').join("");
});
</script></body></html>`;

describe.skipIf(!hasPlaywright)("ui-tester harness (real browser)", () => {
  it("renders variations with mocks and audits them", async () => {
    const server = createServer((_req, res) => { res.setHeader("content-type", "text/html"); res.end(PAGE); });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    const dir = mkdtempSync(join(tmpdir(), "ui-tester-"));
    writeFileSync(join(dir, "harness.cjs"), HARNESS_SOURCE);
    writeFileSync(join(dir, "audit.js"), DOM_AUDIT_SOURCE);
    writeFileSync(join(dir, "spec.json"), JSON.stringify({
      baseUrl: `http://127.0.0.1:${port}`, outDir: join(dir, "out"),
      variations: [
        { id: "ok", path: "/", video: true, mocks: [{ match: "/api/v1/items", json: { total: 2, items: [{ name: "alpha" }, { name: "beta" }] } }] },
        { id: "broken", path: "/", viewport: { width: 390, height: 700 }, mocks: [{ match: "/api/v1/items", json: { items: [{ name: "a very wide item", wide: true }] } }] },
        { id: "error", path: "/", mocks: [{ match: "/api/v1/items", status: 500, json: { error: "boom" } }] },
        { id: "unmocked", path: "/" },
        { id: "repeat", path: "/", mocks: [{ match: "/api/v1/items", json: { total: "{{i}}", items: [{ $repeat: 40, $item: { name: "item-{{i+1}}" } }] } }] },
      ],
    }));
    try {
      const { stdout: out } = await promisify(execFile)("node", [join(dir, "harness.cjs"), join(dir, "spec.json")], { encoding: "utf8", env: { ...process.env, ...(nodePath ? { NODE_PATH: nodePath } : {}) }, timeout: 120_000 });
      expect(JSON.parse(out.trim().split("\n").pop()!).ok).toBe(true);
      const summary = JSON.parse(readFileSync(join(dir, "out", "summary.json"), "utf8"));
      const byId = Object.fromEntries(summary.results.map((r: { id: string }) => [r.id, r]));
      for (const id of ["ok", "broken", "error", "unmocked"]) expect(existsSync(byId[id].screenshot)).toBe(true);
      expect(byId.ok.audit).toMatchObject({ offRight: [], garbage: [], duplicateToasts: [] });
      expect(byId.broken.audit.offRight).toContain("a very wide item");
      expect(byId.broken.audit.garbage).toContain("undefined");
      expect(byId.error.audit.duplicateToasts).toEqual(["Server error x2"]);
      expect(byId.error.failedRequests).toContain("500 /api/v1/items");
      expect(byId.unmocked.unmatchedRequests).toEqual(["GET /api/v1/items"]);
      expect(byId.repeat.audit.textLength).toBeGreaterThan(byId.ok.audit.textLength + 200);
      expect(byId.repeat.audit.garbage).toEqual([]);
      for (const id of ["ok", "broken", "error", "unmocked", "repeat"]) {
        expect(byId[id].externalStubbed).toBeGreaterThan(0);
        expect(byId[id].ms).toBeLessThan(15_000);
      }
      expect(byId.ok.externalHosts).toContain("10.255.255.1");
      expect(byId.ok.video).toMatch(/ok\.webm$/);
      expect(existsSync(byId.ok.video)).toBe(true);
      expect(byId.broken.video).toBeNull();
      expect(typeof summary.warmUpMs).toBe("number");
      for (const id of ["ok", "broken", "error", "unmocked", "repeat"]) {
        expect(byId[id].externalStubbed).toBeGreaterThan(0);
        expect(byId[id].ms).toBeLessThan(15_000);
      }
      expect(byId.ok.externalHosts).toContain("10.255.255.1");
      expect(typeof summary.warmUpMs).toBe("number");
    } finally {
      server.close();
    }
  }, 120_000);
});
