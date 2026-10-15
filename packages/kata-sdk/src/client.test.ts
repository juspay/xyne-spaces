import { describe, it, expect, vi } from "vitest";
import type { CustomObjectsApi } from "@kubernetes/client-node";
import { KataClient } from "./client.js";

type CreateArgs = [string, string, string, string, { metadata: { name: string } }];

function makeClient(overrides: Partial<Record<keyof CustomObjectsApi, unknown>> = {}) {
  const createNamespacedCustomObject = vi.fn().mockResolvedValue({ body: {} });
  const getNamespacedCustomObject = vi.fn().mockResolvedValue({ body: {} });
  const deleteNamespacedCustomObject = vi.fn().mockResolvedValue({ body: {} });
  const k8sClient = {
    createNamespacedCustomObject,
    getNamespacedCustomObject,
    deleteNamespacedCustomObject,
    ...overrides,
  } as unknown as CustomObjectsApi;
  const client = new KataClient({
    routerUrl: "http://router.test",
    minCreateSpacingMs: 0,
    k8sClient,
  });
  return { client, createNamespacedCustomObject, deleteNamespacedCustomObject };
}

function createdClaimName(createFn: ReturnType<typeof vi.fn>): string {
  const args = createFn.mock.calls[0] as CreateArgs;
  return args[4].metadata.name;
}

describe("KataClient.createSession claim cleanup", () => {
  it("deletes the claim it created when the ready-wait times out, and propagates the original error", async () => {
    const { client, createNamespacedCustomObject, deleteNamespacedCustomObject } = makeClient();

    await expect(client.createSession({ readyTimeoutMs: 0 })).rejects.toThrow(
      /Timed out waiting for SandboxClaim .* to bind to a sandbox\./,
    );

    const claimName = createdClaimName(createNamespacedCustomObject);
    expect(deleteNamespacedCustomObject).toHaveBeenCalledTimes(1);
    const deleteArgs = deleteNamespacedCustomObject.mock.calls[0]!;
    expect(deleteArgs[4]).toBe(claimName);
  });

  it("does not mask the original error when the cleanup delete itself fails", async () => {
    const deleteNamespacedCustomObject = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 500 }));
    const { client } = makeClient({ deleteNamespacedCustomObject });

    await expect(client.createSession({ readyTimeoutMs: 0 })).rejects.toThrow(
      /Timed out waiting for SandboxClaim .* to bind to a sandbox\./,
    );
    expect(deleteNamespacedCustomObject).toHaveBeenCalledTimes(1);
  });

  it("treats a 404 on cleanup delete as success and still propagates the original error", async () => {
    const deleteNamespacedCustomObject = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404 }));
    const { client } = makeClient({ deleteNamespacedCustomObject });

    await expect(client.createSession({ readyTimeoutMs: 0 })).rejects.toThrow(
      /Timed out waiting for SandboxClaim/,
    );
    expect(deleteNamespacedCustomObject).toHaveBeenCalledTimes(1);
  });
});
