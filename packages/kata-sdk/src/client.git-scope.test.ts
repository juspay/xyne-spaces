import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GIT_SCOPE_ANNOTATION, KataClient } from "./client.js";
import type { GitScopeClaim } from "./types.js";
import { startFakeK8s, type FakeK8s } from "./__tests__/fake-k8s.js";

let k8s: FakeK8s;

beforeAll(async () => {
  k8s = await startFakeK8s();
});
afterAll(async () => {
  await k8s.close();
});

function client(): KataClient {
  return new KataClient({ routerUrl: "http://router.invalid", minCreateSpacingMs: 0, k8sClient: k8s.client() });
}

function lastClaim(): {
  metadata: { name: string; namespace: string; annotations?: Record<string, string> };
  spec: { sandboxTemplateRef: { name: string }; lifecycle: { shutdownPolicy: string; shutdownTime: string } };
} {
  const bodies = k8s.claimBodies();
  return JSON.parse(bodies[bodies.length - 1]!);
}

describe("createSession with a git scope (fake Kubernetes API)", () => {
  it("without gitScope sends a claim with no annotations", async () => {
    const before = k8s.claimBodies().length;
    const session = await client().createSession({ template: "tpl-a", namespace: "ns-a", timeoutMs: 120_000 });
    await session.destroy();
    expect(k8s.claimBodies().length).toBe(before + 1);
    const claim = lastClaim();
    expect(Object.keys(claim.metadata)).toEqual(["name", "namespace"]);
    expect(claim.metadata.name).toBe(session.claimName);
  });

  it("asks for the list with the claim's name, namespace, template and end time, then annotates the claim", async () => {
    const seen: GitScopeClaim[] = [];
    const createsAtCall: number[] = [];
    const t0 = Date.now();
    const session = await client().createSession({
      template: "tpl-b",
      namespace: "ns-b",
      timeoutMs: 90_500,
      gitScope: async (claim) => {
        seen.push(claim);
        createsAtCall.push(k8s.claimBodies().length);
        return "header.payload.signature";
      },
    });
    await session.destroy();

    expect(seen).toHaveLength(1);
    const asked = seen[0]!;
    // Decided before the create: no claim had been sent when the hook ran.
    expect(k8s.claimBodies().length).toBe(createsAtCall[0]! + 1);
    expect(asked.claimName).toBe(session.claimName);
    expect(asked.namespace).toBe("ns-b");
    expect(asked.template).toBe("tpl-b");
    expect(asked.endTime.getTime() % 1000).toBe(0);
    expect(asked.endTime.getTime()).toBeGreaterThanOrEqual(Math.floor((t0 + 90_500) / 1000) * 1000);

    const claim = lastClaim();
    expect(claim.metadata.name).toBe(asked.claimName);
    expect(claim.metadata.annotations).toEqual({ [GIT_SCOPE_ANNOTATION]: "header.payload.signature" });
    expect(claim.spec.lifecycle.shutdownTime).toBe(asked.endTime.toISOString());
    expect(claim.spec.sandboxTemplateRef.name).toBe("tpl-b");
  });

  it("creates no claim when the hook throws, and propagates its error", async () => {
    const before = k8s.claimBodies().length;
    await expect(
      client().createSession({
        template: "tpl-c",
        gitScope: async () => {
          throw new Error("signer is down");
        },
      }),
    ).rejects.toThrow("signer is down");
    expect(k8s.claimBodies().length).toBe(before);
  });

  it("creates no claim when the hook returns an empty list token", async () => {
    const before = k8s.claimBodies().length;
    await expect(client().createSession({ gitScope: async () => "" })).rejects.toThrow(/No git scope was returned/);
    expect(k8s.claimBodies().length).toBe(before);
  });

  it("exec() passes the hook through to its one-shot claim", async () => {
    const gitScope = vi.fn(async () => "h.p.s");
    // The router is unreachable, so the command fails after the claim exists.
    await expect(client().exec("true", { gitScope, readyTimeoutMs: 1 })).rejects.toThrow();
    expect(gitScope).toHaveBeenCalledTimes(1);
    expect(lastClaim().metadata.annotations?.[GIT_SCOPE_ANNOTATION]).toBe("h.p.s");
  });
});
