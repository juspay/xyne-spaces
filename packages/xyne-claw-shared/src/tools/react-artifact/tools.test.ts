import { describe, it, expect } from "vitest";
import {
  buildReactArtifact,
  formatReactArtifactResult,
  createReactArtifactTool,
  type ReactArtifactPayload,
  type ReactArtifactManifest,
} from "./tools.js";

const MANIFEST_RE = /REACT_ARTIFACT_START\s+([\s\S]+?)\s+REACT_ARTIFACT_END/;
const ATTACHMENT_RE = /^\[ATTACHMENT:([^:]+):([^\]]+)\]\n([A-Za-z0-9+/=]+)\n/;

function validParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Weekly ticket volume",
    summary: "A bar chart of tickets closed per week.",
    entry: "/App.tsx",
    files: [{ path: "/App.tsx", content: "export default () => <div>hi</div>;" }],
    dependencies: { recharts: "latest" },
    ...overrides,
  };
}

/** Run the tool the way the claw runtime does and return its result string. */
async function run(params: Record<string, unknown>): Promise<string> {
  return createReactArtifactTool.execute(params);
}

describe("buildReactArtifact", () => {
  it("builds payload and manifest from valid input", () => {
    const { payload, manifest, summary } = buildReactArtifact(validParams());

    expect(payload.version).toBe(1);
    expect(payload.template).toBe("react-ts");
    expect(payload.entry).toBe("/App.tsx");
    expect(payload.files).toHaveLength(1);
    expect(payload.dependencies).toEqual({ recharts: "latest" });
    expect(summary).toBe("A bar chart of tickets closed per week.");

    expect(manifest.fileCount).toBe(1);
    expect(manifest.files).toEqual(["/App.tsx"]);
    expect(manifest.dependencies).toEqual(["recharts"]);
    expect(manifest.dataRequirements).toEqual([]);
  });

  it("keeps the manifest free of file contents so it stays small in jsonb", () => {
    const { manifest } = buildReactArtifact(
      validParams({
        files: [{ path: "/App.tsx", content: "const SECRET_MARKER = 1;" }],
      }),
    );
    expect(JSON.stringify(manifest)).not.toContain("SECRET_MARKER");
  });

  it("carries dataRequirements through for the future host-data bridge", () => {
    const { payload, manifest } = buildReactArtifact(
      validParams({
        dataRequirements: [{ name: "listTickets", description: "Open tickets for the user" }],
      }),
    );
    expect(payload.dataRequirements).toEqual([
      { name: "listTickets", description: "Open tickets for the user" },
    ]);
    expect(manifest.dataRequirements).toHaveLength(1);
  });

  it("drops data requirements with no name", () => {
    const { manifest } = buildReactArtifact(
      validParams({ dataRequirements: [{ name: "  ", description: "nope" }] }),
    );
    expect(manifest.dataRequirements).toEqual([]);
  });

  it("falls back to a generated summary when none is given", () => {
    const { summary } = buildReactArtifact(validParams({ summary: undefined }));
    expect(summary).toContain("Weekly ticket volume");
  });

  it("strips control characters that Postgres jsonb would reject", () => {
    const { payload } = buildReactArtifact(
      validParams({
        files: [{ path: "/App.tsx", content: "const a = 1;\x00\x07\nconst b = 2;" }],
      }),
    );
    expect(payload.files[0]!.content).toBe("const a = 1;\nconst b = 2;");
  });

  it("preserves tabs and newlines while stripping control bytes", () => {
    const { payload } = buildReactArtifact(
      validParams({ files: [{ path: "/App.tsx", content: "a\n\tb\r\nc" }] }),
    );
    expect(payload.files[0]!.content).toBe("a\n\tb\r\nc");
  });

  describe("rejects invalid input", () => {
    it("malformed package name", () => {
      expect(() =>
        buildReactArtifact(validParams({ dependencies: { "Not A Package": "1.0.0" } })),
      ).toThrow(/not a valid npm package name/);
    });

    it("path traversal", () => {
      expect(() =>
        buildReactArtifact(
          validParams({
            entry: "/App.tsx",
            files: [
              { path: "/App.tsx", content: "x" },
              { path: "/../etc/passwd.ts", content: "x" },
            ],
          }),
        ),
      ).toThrow(/must not contain/);
    });

    it("relative path", () => {
      expect(() =>
        buildReactArtifact(
          validParams({ entry: "App.tsx", files: [{ path: "App.tsx", content: "x" }] }),
        ),
      ).toThrow(/must start with/);
    });

    it("disallowed file extension", () => {
      expect(() =>
        buildReactArtifact(
          validParams({ entry: "/run.sh", files: [{ path: "/run.sh", content: "x" }] }),
        ),
      ).toThrow(/must end with/);
    });

    it("entry missing from files", () => {
      expect(() => buildReactArtifact(validParams({ entry: "/Missing.tsx" }))).toThrow(
        /not among the provided files/,
      );
    });

    it("duplicate paths", () => {
      expect(() =>
        buildReactArtifact(
          validParams({
            files: [
              { path: "/App.tsx", content: "a" },
              { path: "/App.tsx", content: "b" },
            ],
          }),
        ),
      ).toThrow(/Duplicate file path/);
    });

    it("empty file list", () => {
      expect(() => buildReactArtifact(validParams({ files: [] }))).toThrow(/non-empty array/);
    });

    it("too many files", () => {
      const files = Array.from({ length: 21 }, (_, i) => ({
        path: `/F${i}.tsx`,
        content: "x",
      }));
      expect(() => buildReactArtifact(validParams({ entry: "/F0.tsx", files }))).toThrow(
        /Too many files/,
      );
    });

    it("oversized single file", () => {
      const files = [{ path: "/App.tsx", content: "x".repeat(64 * 1024 + 1) }];
      expect(() => buildReactArtifact(validParams({ files }))).toThrow(/per-file limit/);
    });

    it("oversized project total", () => {
      const files = Array.from({ length: 5 }, (_, i) => ({
        path: `/F${i}.tsx`,
        content: "x".repeat(60 * 1024),
      }));
      expect(() => buildReactArtifact(validParams({ entry: "/F0.tsx", files }))).toThrow(
        /total limit/,
      );
    });

    it("missing title", () => {
      expect(() => buildReactArtifact(validParams({ title: "   " }))).toThrow(/`title` is required/);
    });
  });
});

describe("formatReactArtifactResult", () => {
  it("emits an attachment block whose base64 decodes to the full payload", () => {
    const built = buildReactArtifact(validParams());
    const result = formatReactArtifactResult(built);

    const attachment = result.match(ATTACHMENT_RE);
    expect(attachment).not.toBeNull();
    expect(attachment![1]).toBe("artifact.json");
    expect(attachment![2]).toBe("application/json");

    const decoded = JSON.parse(
      Buffer.from(attachment![3]!, "base64").toString("utf8"),
    ) as ReactArtifactPayload;
    expect(decoded.files[0]!.content).toBe("export default () => <div>hi</div>;");
    expect(decoded.entry).toBe("/App.tsx");
  });

  it("emits a manifest block that parses as JSON", () => {
    const result = formatReactArtifactResult(buildReactArtifact(validParams()));
    const match = result.match(MANIFEST_RE);
    expect(match).not.toBeNull();

    const manifest = JSON.parse(match![1]!) as ReactArtifactManifest;
    expect(manifest.title).toBe("Weekly ticket volume");
    expect(manifest.fileCount).toBe(1);
  });
});

describe("createReactArtifactTool.execute", () => {
  it("returns a parseable result for valid input", async () => {
    const result = await run(validParams());
    expect(result).toMatch(ATTACHMENT_RE);
    expect(result).toMatch(MANIFEST_RE);
  });

  it("returns an actionable error instead of throwing on invalid input", async () => {
    const result = await run(validParams({ dependencies: { "Not A Package": "1.0.0" } }));
    expect(result).toContain("Error:");
    expect(result).toContain("not a valid npm package name");
    expect(result).toContain("call create-app again");
    expect(result).not.toMatch(ATTACHMENT_RE);
  });

  it("is registered as a non-write tool", () => {
    expect(createReactArtifactTool.slug).toBe("create-app");
    expect(createReactArtifactTool.isWriteTool).toBeFalsy();
  });
});

describe("reserved paths", () => {
  const base = {
    title: "T",
    entry: "/App.tsx",
    files: [{ path: "/App.tsx", content: "export default () => null;" }],
  };

  it("rejects a file that would shadow an injected shadcn primitive", () => {
    expect(() =>
      buildReactArtifact({
        ...base,
        files: [...base.files, { path: "/components/ui/button.tsx", content: "x" }],
      }),
    ).toThrow(/reserved/);
  });

  it("rejects a file that would shadow the cn() helper", () => {
    expect(() =>
      buildReactArtifact({
        ...base,
        files: [...base.files, { path: "/lib/utils.ts", content: "x" }],
      }),
    ).toThrow(/reserved/);
  });

  it("rejects overwriting the Tailwind HTML shell", () => {
    expect(() =>
      buildReactArtifact({
        ...base,
        files: [...base.files, { path: "/public/index.html", content: "x" }],
      }),
    ).toThrow(/reserved/);
  });

  it("still allows the agent's own components outside the reserved tree", () => {
    const built = buildReactArtifact({
      ...base,
      files: [...base.files, { path: "/components/Chart.tsx", content: "export default () => null;" }],
    });
    expect(built.manifest.files).toContain("/components/Chart.tsx");
  });

  it("accepts the shadcn npm packages in dependencies", () => {
    const built = buildReactArtifact({
      ...base,
      dependencies: { "@radix-ui/react-tabs": "latest", "tailwind-merge": "latest" },
    });
    expect(built.manifest.dependencies).toContain("@radix-ui/react-tabs");
  });
});

describe("dataRequirements — live data sources", () => {
  const base = {
    title: "T",
    entry: "/App.tsx",
    files: [{ path: "/App.tsx", content: "export default () => null;" }],
  };
  const build = (dataRequirements: unknown) =>
    buildReactArtifact({ ...base, dataRequirements });

  it("accepts a named query source and round-trips it to the manifest", () => {
    const built = build([
      { name: "boardTickets", source: { kind: "query", query: "ticketsQueryV2", args: { viewMode: "board", boardId: "b1" } } },
    ]);
    expect(built.payload.dataRequirements[0]).toEqual({
      name: "boardTickets",
      source: { kind: "query", query: "ticketsQueryV2", args: { viewMode: "board", boardId: "b1" } },
    });
    // The manifest is what the renderer reads back on a reloaded thread.
    expect(built.manifest.dataRequirements[0]?.source).toBeDefined();
  });

  it("names the allowlist when the query is unknown", () => {
    expect(() => build([{ name: "x", source: { kind: "query", query: "dropAllTickets" } }]))
      .toThrow(/not available.*ticketsQueryV2/s);
  });

  it("accepts an AST source and defaults the operation", () => {
    const built = build([
      { name: "recent", source: { kind: "ast", model: "ticket", take: 50 } },
    ]);
    expect(built.payload.dataRequirements[0]?.source).toMatchObject({
      kind: "ast",
      model: "ticket",
      operation: "findMany",
      take: 50,
    });
  });

  it("rejects a model outside the mirror", () => {
    expect(() => build([{ name: "x", source: { kind: "ast", model: "passwordHash" } }]))
      .toThrow(/not queryable/);
  });

  it("rejects take above the cap", () => {
    expect(() => build([{ name: "x", source: { kind: "ast", model: "ticket", take: 501 } }]))
      .toThrow(/between 1 and 500/);
  });

  it("rejects a where clause nested deeper than the server allows", () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    expect(() => build([{ name: "x", source: { kind: "ast", model: "ticket", where: deep } }]))
      .toThrow(/nests deeper/);
  });

  it("rejects an unknown source kind", () => {
    expect(() => build([{ name: "x", source: { kind: "graphql" } }])).toThrow(/must be "query"/);
  });

  it("rejects duplicate requirement names", () => {
    expect(() =>
      build([
        { name: "dup", source: { kind: "query", query: "allTickets" } },
        { name: "dup", source: { kind: "query", query: "getAllBoards" } },
      ]),
    ).toThrow(/Duplicate dataRequirement/);
  });

  it("rejects a name that is not a usable identifier", () => {
    expect(() => build([{ name: "open tickets", source: { kind: "query", query: "allTickets" } }]))
      .toThrow(/valid identifier/);
  });

  it("rejects more requirements than the cap", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      name: `r${i}`,
      source: { kind: "query", query: "allTickets" },
    }));
    expect(() => build(many)).toThrow(/Too many dataRequirements/);
  });

  it("still accepts legacy {name, description} entries with no source", () => {
    const built = build([{ name: "legacy", description: "old style" }]);
    expect(built.payload.dataRequirements[0]).toEqual({ name: "legacy", description: "old style" });
    expect(built.payload.dataRequirements[0]?.source).toBeUndefined();
  });

  it("reserves the injected data runtime path", () => {
    expect(() =>
      buildReactArtifact({
        ...base,
        files: [...base.files, { path: "/lib/xyne-data.ts", content: "export const x = 1;" }],
      }),
    ).toThrow(/reserved/);
  });
});

describe("writes marker", () => {
  const base = {
    title: "T",
    entry: "/App.tsx",
    files: [{ path: "/App.tsx", content: "export default () => null;" }],
  };

  it("carries writes:true into payload and manifest", () => {
    const built = buildReactArtifact({ ...base, writes: true });
    expect(built.payload.writes).toBe(true);
    expect(built.manifest.writes).toBe(true);
  });

  it("omits the marker entirely when not declared", () => {
    const built = buildReactArtifact(base);
    expect(built.payload.writes).toBeUndefined();
    expect(built.manifest.writes).toBeUndefined();
  });

  it("treats a non-boolean as not declaring writes", () => {
    const built = buildReactArtifact({ ...base, writes: "yes" });
    expect(built.payload.writes).toBeUndefined();
  });
});

describe("dependencies are open by default", () => {
  const base = {
    title: "T",
    entry: "/App.tsx",
    files: [{ path: "/App.tsx", content: "export default () => null;" }],
  };

  it("accepts an arbitrary npm package", () => {
    const built = buildReactArtifact({ ...base, dependencies: { lodash: "4.17.21" } });
    expect(built.payload.dependencies).toEqual({ lodash: "4.17.21" });
  });

  it("accepts a scoped package", () => {
    const built = buildReactArtifact({
      ...base,
      dependencies: { "@tanstack/react-table": "latest" },
    });
    expect(built.manifest.dependencies).toContain("@tanstack/react-table");
  });

  it("still requires a version", () => {
    expect(() => buildReactArtifact({ ...base, dependencies: { lodash: "" } })).toThrow(
      /needs a version/,
    );
  });
});

describe("agent invocation", () => {
  it("defaults to no agent use", () => {
    const built = buildReactArtifact(validParams());
    expect(built.payload.invokesAgents).toBeUndefined();
    expect(built.payload.agents).toBeUndefined();
    expect(built.manifest.invokesAgents).toBeUndefined();
  });

  it("carries invokesAgents through to payload and manifest", () => {
    const built = buildReactArtifact(validParams({ invokesAgents: true }));
    expect(built.payload.invokesAgents).toBe(true);
    expect(built.manifest.invokesAgents).toBe(true);
  });

  it("round-trips declared agents", () => {
    const built = buildReactArtifact(validParams({ agents: ["fractal-agent", "ask-ai"] }));
    expect(built.payload.agents).toEqual(["fractal-agent", "ask-ai"]);
    expect(built.manifest.agents).toEqual(["fractal-agent", "ask-ai"]);
  });

  // Declaring an agent is itself a statement that the app runs agents; making
  // the author set both flags consistently is a trap not worth leaving open.
  it("implies invokesAgents when agents are declared", () => {
    const built = buildReactArtifact(validParams({ agents: ["fractal-agent"] }));
    expect(built.payload.invokesAgents).toBe(true);
  });

  it("rejects a malformed slug", () => {
    expect(() => buildReactArtifact(validParams({ agents: ["Fractal Agent"] }))).toThrow(
      /not a valid agent slug/,
    );
  });

  it("rejects duplicates", () => {
    expect(() => buildReactArtifact(validParams({ agents: ["a", "a"] }))).toThrow(/Duplicate agent/);
  });

  it("rejects more than the limit", () => {
    expect(() =>
      buildReactArtifact(validParams({ agents: ["a", "b", "c", "d", "e"] })),
    ).toThrow(/Too many agents/);
  });

  it("rejects a non-array", () => {
    expect(() => buildReactArtifact(validParams({ agents: "fractal-agent" }))).toThrow(
      /must be an array/,
    );
  });

  it("survives the manifest wire format", async () => {
    const result = await run(validParams({ agents: ["fractal-agent"], invokesAgents: true }));
    const manifest = JSON.parse(MANIFEST_RE.exec(result)![1]!) as ReactArtifactManifest;
    expect(manifest.agents).toEqual(["fractal-agent"]);
    expect(manifest.invokesAgents).toBe(true);
  });

  it("describes useXyneAgent and the one-run-per-key rule to the model", () => {
    expect(createReactArtifactTool.description).toContain("useXyneAgent");
    expect(createReactArtifactTool.description).toContain("CONTINUES IF THE APP IS CLOSED");
    expect(createReactArtifactTool.description).toMatch(/ONLY ONE run per key/i);
  });
});

describe("ast source guidance", () => {
  // The gateway rejects a bare-object orderBy with a 400 before the query runs,
  // and the validator accepts either form — so the description is the only thing
  // stopping an agent writing the idiomatic Prisma shape and shipping a broken app.
  it("tells the model orderBy must be an array", () => {
    expect(createReactArtifactTool.description).toMatch(/orderBy` must be an ARRAY/);
    expect(createReactArtifactTool.description).toContain('[{"createdAt":"desc"}]');
  });

  it("tells the model where may traverse relations", () => {
    expect(createReactArtifactTool.description).toMatch(/`where` may traverse relations/);
  });
});
