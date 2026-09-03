import { afterEach, expect, test, vi } from "vitest";
import { HindsightProvider } from "./hindsight.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("marks Hindsight's observation curation rejection with a stable error code", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false,
    status: 400,
    text: async () =>
      JSON.stringify({
        detail:
          "Memory 'obs-1' is a observation; only world/experience facts can be curated. Observations are derived and regenerate from their sources.",
      }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const provider = new HindsightProvider({ url: "http://hindsight.test" });

  await expect(provider.deleteMemory("digital-twin", "obs-1")).rejects.toThrow(
    "HINDSIGHT_DERIVED_OBSERVATION",
  );
});

test("delete-by-tag retires raw facts and skips direct observation invalidation", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          { id: "obs-1", fact_type: "observation", tags: ["user:u1"] },
          { id: "world-1", fact_type: "world", tags: ["user:u1"] },
          { id: "other-user", fact_type: "experience", tags: ["user:u2"] },
        ],
      }),
    })
    .mockResolvedValueOnce({ ok: true, status: 200 });
  vi.stubGlobal("fetch", fetchMock);
  const provider = new HindsightProvider({ url: "http://hindsight.test" });

  await expect(provider.deleteByTag("digital-twin", "user:u1")).resolves.toBe(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1]?.[0]).toContain("/memories/world-1");
  expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PATCH" });
});
