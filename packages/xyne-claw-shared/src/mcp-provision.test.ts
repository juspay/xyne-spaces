import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

type ExecCb = (err: Error | null, stdout?: string, stderr?: string) => void;

/** Simulate a successful `npm install <spec> --prefix <dir>` for a package with a bin. */
function fakeNpmInstall(args: string[], _opts: unknown, cb: ExecCb): void {
  const prefix = args[args.indexOf("--prefix") + 1]!;
  const spec = args[1]!;
  const at = spec.lastIndexOf("@");
  const name = at > 0 ? spec.slice(0, at) : spec;
  const pkgDir = path.join(prefix, "node_modules", name);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name, bin: "cli.js" }));
  writeFileSync(path.join(pkgDir, "cli.js"), "");
  cb(null, "", "");
}

let storeRoot: string;

async function loadModule() {
  vi.resetModules();
  return import("./mcp-provision.js");
}

beforeEach(() => {
  storeRoot = mkdtempSync(path.join(os.tmpdir(), "mcp-store-test-"));
  vi.stubEnv("MCP_STORE_ROOT", storeRoot);
  execFileMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("provisionStdioCommand", () => {
  it("installs with a 16 MB maxBuffer and launches via node <entrypoint>", async () => {
    execFileMock.mockImplementation((_cmd: string, args: string[], opts: unknown, cb: ExecCb) =>
      fakeNpmInstall(args, opts, cb),
    );
    const { provisionStdioCommand } = await loadModule();

    const out = await provisionStdioCommand("npx", ["-y", "@scope/srv@1.2.3", "--flag", "x"]);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [bin, args, opts] = execFileMock.mock.calls[0]!;
    expect(bin).toBe("npm");
    expect(args).toContain("@scope/srv@1.2.3");
    expect(opts).toMatchObject({ maxBuffer: 16 * 1024 * 1024 });
    expect(out.command).toBe("node");
    expect(out.args[0]).toMatch(/node_modules[\\/]@scope[\\/]srv[\\/]cli\.js$/);
    expect(out.args.slice(1)).toEqual(["--flag", "x"]);
  });

  it("reuses a healthy store dir without reinstalling", async () => {
    execFileMock.mockImplementation((_cmd: string, args: string[], opts: unknown, cb: ExecCb) =>
      fakeNpmInstall(args, opts, cb),
    );
    const { provisionStdioCommand } = await loadModule();
    await provisionStdioCommand("npx", ["-y", "srv@1.0.0"]);
    await provisionStdioCommand("npx", ["-y", "srv@1.0.0"]);
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the original npx command when install fails", async () => {
    execFileMock.mockImplementation((_c: string, _a: string[], _o: unknown, cb: ExecCb) =>
      cb(new Error("spawnSync npm ENOBUFS")),
    );
    const { provisionStdioCommand } = await loadModule();
    const args = ["-y", "broken-srv@2.0.0"];
    await expect(provisionStdioCommand("npx", args)).resolves.toEqual({ command: "npx", args });
  });

  it("passes non-npx commands through untouched", async () => {
    const { provisionStdioCommand } = await loadModule();
    await expect(provisionStdioCommand("node", ["server.js"])).resolves.toEqual({
      command: "node",
      args: ["server.js"],
    });
    expect(execFileMock).not.toHaveBeenCalled();
  });
});

describe("npxPackageSpec", () => {
  it("extracts the package spec after npx flags", async () => {
    const { npxPackageSpec } = await loadModule();
    expect(npxPackageSpec("npx", ["-y", "@scope/pkg@1.2.3", "--x"])).toBe("@scope/pkg@1.2.3");
  });
});
