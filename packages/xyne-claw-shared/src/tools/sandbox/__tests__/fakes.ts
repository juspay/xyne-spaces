/**
 * Local stand-ins for the services a sandbox creation talks to: the
 * Kubernetes custom-objects API (claims and sandboxes), the sandbox router
 * (commands and jobs), and the git-scope signer (signs real lists with a test
 * key using the library's signGitScope).
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signGitScope, type GitScopeRepo } from "../../../git-scope/token.js";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// ── Kubernetes ───────────────────────────────────────────────────────────────

const CLAIMS_RE = /^\/apis\/extensions\.agents\.x-k8s\.io\/v1alpha1\/namespaces\/([^/]+)\/sandboxclaims(?:\/([^/?]+))?/;
const SANDBOX_RE = /^\/apis\/agents\.x-k8s\.io\/v1alpha1\/namespaces\/([^/]+)\/sandboxes\/([^/?]+)/;

export interface ClaimBody {
  metadata: { name: string; namespace: string; annotations?: Record<string, string> };
  spec: { sandboxTemplateRef: { name: string }; lifecycle: { shutdownPolicy: string; shutdownTime: string } };
}

export interface FakeK8s {
  url: string;
  /** Raw bodies of SandboxClaim creates, in order. */
  claimBodies: string[];
  claims(): ClaimBody[];
  /** Writes a kubeconfig for this server and points KUBECONFIG at it. */
  useAsKubeconfig(): void;
  /** Keep serving but let the process exit. */
  unref(): void;
  close(): Promise<void>;
}

export async function startFakeK8s(): Promise<FakeK8s> {
  const claimBodies: string[] = [];
  const stored = new Map<string, unknown>();
  const server = createServer(async (req, res) => {
    const raw = await readBody(req);
    const path = req.url ?? "";
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const claim = CLAIMS_RE.exec(path);
    if (claim && req.method === "POST" && !claim[2]) {
      claimBodies.push(raw);
      const body = JSON.parse(raw) as ClaimBody;
      stored.set(body.metadata.name, body);
      return send(201, body);
    }
    if (claim && req.method === "GET" && claim[2]) {
      const body = stored.get(claim[2]);
      if (!body) return send(404, { kind: "Status", code: 404 });
      return send(200, { ...(body as object), status: { sandbox: { name: `sbx-${claim[2]}` } } });
    }
    if (claim && req.method === "DELETE" && claim[2]) {
      stored.delete(claim[2]);
      return send(200, { kind: "Status", status: "Success" });
    }
    const sandbox = SANDBOX_RE.exec(path);
    if (sandbox && req.method === "GET") {
      return send(200, { metadata: { name: sandbox[2] }, status: { conditions: [{ type: "Ready", status: "True" }] } });
    }
    send(404, { kind: "Status", code: 404 });
  });
  const url = await listen(server);
  return {
    url,
    claimBodies,
    claims: () => claimBodies.map((raw) => JSON.parse(raw) as ClaimBody),
    useAsKubeconfig() {
      const dir = mkdtempSync(join(tmpdir(), "fake-kube-"));
      const file = join(dir, "config");
      writeFileSync(
        file,
        [
          "apiVersion: v1",
          "kind: Config",
          "clusters:",
          "- name: fake",
          "  cluster:",
          `    server: ${url}`,
          "    insecure-skip-tls-verify: true",
          "users:",
          "- name: fake",
          "  user: {}",
          "contexts:",
          "- name: fake",
          "  context: {cluster: fake, user: fake}",
          "current-context: fake",
          "",
        ].join("\n"),
      );
      process.env["KUBECONFIG"] = file;
    },
    unref: () => {
      server.unref();
    },
    close: () => close(server),
  };
}

// ── Sandbox router ───────────────────────────────────────────────────────────

export interface RouterJob {
  sandbox: string;
  command: string;
  exitCode: number;
  stderr: string;
}

export interface FakeRouter {
  url: string;
  jobs: RouterJob[];
  /** When set, every detached job running `git fetch` (and containing `match`, if given) ends with this exit code and stderr. */
  refuseFetch: { exitCode: number; stderr: string; match?: string } | null;
  close(): Promise<void>;
}

export async function startFakeRouter(): Promise<FakeRouter> {
  const jobs: RouterJob[] = [];
  const router: FakeRouter = { url: "", jobs, refuseFetch: null, close: async () => undefined };
  const server = createServer(async (req, res) => {
    const raw = await readBody(req);
    const path = req.url ?? "";
    const sandbox = String(req.headers["x-sandbox-id"] ?? "");
    const send = (body: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && path === "/") return send({ ok: true });
    if (req.method === "POST" && path === "/execute") {
      const { command } = JSON.parse(raw) as { command: string };
      if (command.includes("test -d") && command.includes("echo present")) return send({ stdout: "present\n", stderr: "", exit_code: 0 });
      if (command.includes("echo current || echo stale")) return send({ stdout: "stale\n", stderr: "", exit_code: 0 });
      return send({ stdout: "", stderr: "", exit_code: 0 });
    }
    if (req.method === "POST" && path === "/execute/detached") {
      const { command } = JSON.parse(raw) as { command: string };
      const rule = router.refuseFetch;
      const refused = rule && command.includes("git fetch") && (!rule.match || command.includes(rule.match)) ? rule : null;
      jobs.push({ sandbox, command, exitCode: refused?.exitCode ?? 0, stderr: refused?.stderr ?? "" });
      return send({ jobId: `job-${jobs.length - 1}` });
    }
    const job = /^\/jobs\/job-(\d+)$/.exec(path);
    if (req.method === "GET" && job) {
      const j = jobs[Number(job[1])]!;
      return send({ done: true, stdout: "", stderr: j.stderr, exitCode: j.exitCode });
    }
    res.writeHead(404);
    res.end("not found");
  });
  router.url = await listen(server);
  router.close = () => close(server);
  return router;
}

// ── Signer ───────────────────────────────────────────────────────────────────

export interface SignRequestSeen {
  profile: string;
  claimName: string;
  namespace: string;
  template: string;
  endTime: number;
}

export interface FakeSigner {
  url: string;
  kid: string;
  publicKeyPem: string;
  requests: SignRequestSeen[];
  /** "sign" signs the request; "other-claim" signs a list for a different claim; a number answers with that HTTP status. */
  mode: "sign" | "other-claim" | number;
  reposFor: Record<string, GitScopeRepo[]>;
  close(): Promise<void>;
}

export async function startFakeSigner(): Promise<FakeSigner> {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const signer: FakeSigner = {
    url: "",
    kid: "test-signer-1",
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    requests: [],
    mode: "sign",
    reposFor: {},
    close: async () => undefined,
  };
  const server = createServer(async (req, res) => {
    const raw = await readBody(req);
    if (req.method !== "POST" || req.url !== "/v1/git-scope") {
      res.writeHead(404);
      return res.end();
    }
    const body = JSON.parse(raw) as SignRequestSeen;
    signer.requests.push(body);
    if (typeof signer.mode === "number") {
      res.writeHead(signer.mode, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "refused" }));
    }
    const token = signGitScope(
      {
        v: 1,
        claim: signer.mode === "other-claim" ? "kata-claim-00000000" : body.claimName,
        ns: body.namespace,
        tpl: body.template,
        profile: body.profile,
        iat: Math.floor(Date.now() / 1000),
        exp: body.endTime,
        repos: signer.reposFor[body.profile] ?? [],
      },
      privatePem,
      signer.kid,
    );
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ token }));
  });
  signer.url = await listen(server);
  signer.close = () => close(server);
  return signer;
}
