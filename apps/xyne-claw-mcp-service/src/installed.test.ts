import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INSTALLED_BINARIES, INSTALLED_NPX_SPECS, INSTALLED_UVX, npxPackageName } from "xyne-claw-mcp-common/launch-policy";
import { NotInstalledError, resolveStdioCommand } from "./installed.js";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fakeImage(): { npmDir: string; pyDir: string; binDir: string } {
  const root = mkdtempSync(path.join(tmpdir(), "mcp-image-"));
  const npmDir = path.join(root, "npm");
  const pyDir = path.join(root, "py");
  const sentry = path.join(npmDir, "node_modules", "@sentry", "mcp-server");
  mkdirSync(path.join(sentry, "dist"), { recursive: true });
  writeFileSync(path.join(sentry, "package.json"), JSON.stringify({ name: "@sentry/mcp-server", version: "0.36.0", bin: { "mcp-server": "dist/index.js" } }));
  writeFileSync(path.join(sentry, "dist", "index.js"), "");
  const figma = path.join(npmDir, "node_modules", "figma-developer-mcp");
  mkdirSync(figma, { recursive: true });
  writeFileSync(path.join(figma, "package.json"), JSON.stringify({ name: "figma-developer-mcp", version: "0.0.1", bin: "cli.js" }));
  writeFileSync(path.join(figma, "cli.js"), "");
  mkdirSync(path.join(root, "bin"), { recursive: true });
  writeFileSync(path.join(root, "bin", "github-mcp-server"), "");
  mkdirSync(path.join(pyDir, "databricks-mcp-server", "bin"), { recursive: true });
  writeFileSync(path.join(pyDir, "databricks-mcp-server", "bin", "databricks-mcp-server"), "");
  return { npmDir, pyDir, binDir: path.join(root, "bin") };
}

describe("installed MCP servers", () => {
  it("runs an installed npm server with node, keeping its args", () => {
    const dirs = fakeImage();
    const r = resolveStdioCommand("npx", ["-y", "@sentry/mcp-server@0.36.0", "--access-token=x"], dirs);
    expect(r.command).toBe(process.execPath);
    expect(r.args).toEqual([path.join(dirs.npmDir, "node_modules", "@sentry", "mcp-server", "dist", "index.js"), "--access-token=x"]);
  });

  it("runs an installed Python server from its venv, keeping its args", () => {
    const dirs = fakeImage();
    const r = resolveStdioCommand("uvx", ["--with", "mcp<2", "databricks-mcp-server==0.4.4", "--x"], dirs);
    expect(r).toEqual({ command: path.join(dirs.pyDir, "databricks-mcp-server", "bin", "databricks-mcp-server"), args: ["--x"] });
  });

  it("runs an installed binary from the bin dir, keeping its args", () => {
    const dirs = fakeImage();
    expect(resolveStdioCommand("github-mcp-server", ["stdio"], dirs)).toEqual({ command: path.join(dirs.binDir, "github-mcp-server"), args: ["stdio"] });
    expect(() => resolveStdioCommand("github-mcp-server", ["stdio"], { ...dirs, binDir: path.join(dirs.binDir, "missing") })).toThrow(NotInstalledError);
  });

  it("refuses anything not installed instead of downloading it", () => {
    const dirs = fakeImage();
    const notInstalled = (cmd: string, args: string[]) => () => resolveStdioCommand(cmd, args, dirs);
    expect(notInstalled("npx", ["-y", "left-pad@1.3.0"])).toThrow(NotInstalledError);
    // In the list, but missing from this (fake) image.
    expect(notInstalled("npx", ["-y", "@hubspot/mcp-server@0.4.0"])).toThrow(NotInstalledError);
    // Image has a different version than the list.
    expect(notInstalled("npx", ["-y", "figma-developer-mcp@0.13.2"])).toThrow(/image has 0.0.1/);
    expect(notInstalled("uvx", ["mcp-grafana==1.6.3"])).toThrow(NotInstalledError);
    expect(notInstalled("uvx", ["databricks-mcp-server==0.4.4"])).toThrow(NotInstalledError);
  });

  it("runs plain node launches with this process's node binary", () => {
    expect(resolveStdioCommand("node", ["/srv/x.mjs"])).toEqual({ command: process.execPath, args: ["/srv/x.mjs"] });
  });
});

describe("mcp-packages (what the Dockerfile installs)", () => {
  it("installs exactly the npm specs the launch policy allows", () => {
    const pj = JSON.parse(readFileSync(path.join(APP_DIR, "mcp-packages/npm/package.json"), "utf8")) as { dependencies: Record<string, string> };
    const installed = Object.entries(pj.dependencies).map(([name, version]) => `${name}@${version}`).sort();
    expect(installed).toEqual([...INSTALLED_NPX_SPECS].sort());
    const lock = JSON.parse(readFileSync(path.join(APP_DIR, "mcp-packages/npm/package-lock.json"), "utf8")) as {
      packages: Record<string, { version?: string; integrity?: string }>;
    };
    for (const spec of INSTALLED_NPX_SPECS) {
      const name = npxPackageName(spec);
      const entry = lock.packages[`node_modules/${name}`];
      expect(entry?.version, spec).toBe(spec.slice(name.length + 1));
      expect(entry?.integrity, spec).toMatch(/^sha512-/);
    }
  });

  it("installs exactly the Python servers the launch policy allows, hash-pinned", () => {
    const dir = path.join(APP_DIR, "mcp-packages/python");
    const files = readdirSync(dir).filter((f) => f.endsWith(".txt")).map((f) => f.slice(0, -4)).sort();
    expect(files).toEqual(INSTALLED_UVX.map((u) => u.venv).sort());
    for (const u of INSTALLED_UVX) {
      const req = readFileSync(path.join(dir, `${u.venv}.txt`), "utf8");
      expect(req, u.spec).toContain(`${u.spec} \\`);
      expect(req, u.spec).toMatch(/--hash=sha256:/);
    }
  });

  it("has a linux amd64 and arm64 checksum for every installed binary", () => {
    for (const b of INSTALLED_BINARIES) {
      const sums = readFileSync(path.join(APP_DIR, `mcp-packages/bin/${b.name}_${b.version}_checksums.txt`), "utf8");
      expect(sums, b.name).toMatch(new RegExp(`^[0-9a-f]{64}  ${b.name}_Linux_x86_64\\.tar\\.gz$`, "m"));
      expect(sums, b.name).toMatch(new RegExp(`^[0-9a-f]{64}  ${b.name}_Linux_arm64\\.tar\\.gz$`, "m"));
    }
  });
});
