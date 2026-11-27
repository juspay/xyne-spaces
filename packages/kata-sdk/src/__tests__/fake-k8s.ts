import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { CustomObjectsApi, KubeConfig } from "@kubernetes/client-node";

export interface RecordedRequest {
  method: string;
  path: string;
  /** The request body exactly as it arrived. */
  raw: string;
}

/**
 * A local stand-in for the Kubernetes custom-objects API: records every
 * request, accepts SandboxClaim creates, binds each claim to a sandbox in its
 * status, and reports every sandbox Ready.
 */
export interface FakeK8s {
  url: string;
  requests: RecordedRequest[];
  /** Raw bodies of SandboxClaim creates, in order. */
  claimBodies(): string[];
  client(): CustomObjectsApi;
  close(): Promise<void>;
}

const CLAIMS_RE = /^\/apis\/extensions\.agents\.x-k8s\.io\/v1alpha1\/namespaces\/([^/]+)\/sandboxclaims(?:\/([^/?]+))?/;
const SANDBOX_RE = /^\/apis\/agents\.x-k8s\.io\/v1alpha1\/namespaces\/([^/]+)\/sandboxes\/([^/?]+)/;

export async function startFakeK8s(): Promise<FakeK8s> {
  const requests: RecordedRequest[] = [];
  const claims = new Map<string, unknown>();
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const path = req.url ?? "";
      requests.push({ method: req.method ?? "", path, raw });
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const claim = CLAIMS_RE.exec(path);
      if (claim && req.method === "POST" && !claim[2]) {
        const body = JSON.parse(raw) as { metadata: { name: string } };
        claims.set(body.metadata.name, body);
        return send(201, body);
      }
      if (claim && req.method === "GET" && claim[2]) {
        const stored = claims.get(claim[2]);
        if (!stored) return send(404, { kind: "Status", code: 404 });
        return send(200, { ...(stored as object), status: { sandbox: { name: `sbx-${claim[2]}` } } });
      }
      if (claim && req.method === "DELETE" && claim[2]) {
        claims.delete(claim[2]);
        return send(200, { kind: "Status", status: "Success" });
      }
      const sandbox = SANDBOX_RE.exec(path);
      if (sandbox && req.method === "GET") {
        return send(200, { metadata: { name: sandbox[2] }, status: { conditions: [{ type: "Ready", status: "True" }] } });
      }
      send(404, { kind: "Status", code: 404 });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    requests,
    claimBodies: () =>
      requests.filter((r) => r.method === "POST" && CLAIMS_RE.test(r.path)).map((r) => r.raw),
    client: () => {
      const kc = new KubeConfig();
      kc.loadFromOptions({
        clusters: [{ name: "fake", server: url, skipTLSVerify: true }],
        users: [{ name: "fake" }],
        contexts: [{ name: "fake", cluster: "fake", user: "fake" }],
        currentContext: "fake",
      });
      return kc.makeApiClient(CustomObjectsApi);
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
