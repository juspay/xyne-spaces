import { describe, expect, it, vi } from "vitest";
import type { CustomObjectsApi } from "@kubernetes/client-node";
import { getSandboxLiveness } from "./liveness.js";

function client(impl: () => Promise<unknown>): { client: CustomObjectsApi; get: ReturnType<typeof vi.fn> } {
  const get = vi.fn(impl);
  return { client: { getNamespacedCustomObject: get } as unknown as CustomObjectsApi, get };
}

describe("getSandboxLiveness", () => {
  it("reports alive when the Sandbox object exists, looking it up by name in the namespace", async () => {
    const { client: k8s, get } = client(async () => ({ body: { metadata: { name: "sbx-1" } } }));
    expect(await getSandboxLiveness("sbx-1", { k8sClient: k8s, namespace: "ns-a" })).toBe("alive");
    expect(get).toHaveBeenCalledWith("agents.x-k8s.io", "v1alpha1", "ns-a", "sandboxes", "sbx-1");
  });

  it("reports ended when the Sandbox object is being deleted", async () => {
    const { client: k8s } = client(async () => ({ body: { metadata: { deletionTimestamp: "2026-10-14T00:00:00Z" } } }));
    expect(await getSandboxLiveness("sbx-1", { k8sClient: k8s })).toBe("ended");
  });

  it("reports ended on a 404, in either error shape", async () => {
    const a = client(async () => Promise.reject(Object.assign(new Error("nf"), { statusCode: 404 })));
    const b = client(async () => Promise.reject(Object.assign(new Error("nf"), { response: { statusCode: 404 } })));
    expect(await getSandboxLiveness("sbx-1", { k8sClient: a.client })).toBe("ended");
    expect(await getSandboxLiveness("sbx-1", { k8sClient: b.client })).toBe("ended");
  });

  it("reports unknown on any other failure", async () => {
    const forbidden = client(async () => Promise.reject(Object.assign(new Error("no"), { statusCode: 403 })));
    const network = client(async () => Promise.reject(new Error("ECONNREFUSED")));
    expect(await getSandboxLiveness("sbx-1", { k8sClient: forbidden.client })).toBe("unknown");
    expect(await getSandboxLiveness("sbx-1", { k8sClient: network.client })).toBe("unknown");
  });
});
