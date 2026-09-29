import { describe, expect, it } from "vitest";

import {
  fallbackCatalog,
  filterByCapability,
  parseCatalog,
  parseCapabilitiesAndModalities,
  parseModalitiesParam,
  parseCapabilityParam,
  resolveCatalog,
  toPublicModels,
} from "./model-catalog.js";
import { MAX_CATALOG_ITEMS, ORCAROUTER_FALLBACK_CATALOG } from "./constants.js";

describe("parseCatalog", () => {
  it("reads the OpenAI { data: [...] } envelope", () => {
    const models = parseCatalog({
      data: [
        {
          id: "openai/gpt-5.5",
          name: "GPT-5.5",
          supported_endpoint_types: ["openai"],
          architecture: { input_modalities: ["text", "image"] },
          context_length: 400000,
          reasoning_efforts: ["low", "medium", "high", "xhigh"],
        },
      ],
    });
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: "openai/gpt-5.5",
      name: "GPT-5.5",
      contextLength: 400000,
      inputModalities: ["text", "image"],
      reasoning: ["low", "medium", "high", "xhigh"],
    });
  });

  it("preserves the model id verbatim (vendor/model)", () => {
    const models = parseCatalog({ data: [{ id: "deepseek/deepseek-v4-pro", endpoints: ["openai"] }] });
    expect(models[0]?.id).toBe("deepseek/deepseek-v4-pro");
  });

  it("accepts a bare array and a { models: [...] } envelope", () => {
    expect(parseCatalog([{ id: "a/b", endpoints: ["openai"] }])).toHaveLength(1);
    expect(parseCatalog({ models: [{ id: "a/b", endpoints: ["openai"] }] })).toHaveLength(1);
  });

  it("never throws on junk", () => {
    for (const junk of [null, undefined, 42, "nope", {}, { data: "no" }, { data: [null, 1, "x"] }, [[]]]) {
      expect(() => parseCatalog(junk)).not.toThrow();
      expect(parseCatalog(junk)).toEqual([]);
    }
  });

  it("drops records with no usable id, no known route, or an absurd id", () => {
    const models = parseCatalog({
      data: [
        { id: "" },
        { id: "   " },
        { name: "" },
        { id: "x".repeat(400), endpoints: ["openai"] },
        { id: "no-routes/here" },
        { id: "unknown-route/x", endpoints: ["carrier-pigeon"] },
        { id: "good/one", endpoints: ["openai"] },
      ],
    });
    expect(models.map((m) => m.id)).toEqual(["good/one"]);
  });

  it("de-duplicates repeated ids", () => {
    const models = parseCatalog({
      data: [
        { id: "dup/x", endpoints: ["openai"] },
        { id: "dup/x", endpoints: ["openai"] },
      ],
    });
    expect(models).toHaveLength(1);
  });

  it("caps the item count", () => {
    const rows = Array.from({ length: MAX_CATALOG_ITEMS + 50 }, (_, i) => ({
      id: `vendor/model-${i}`,
      endpoints: ["openai"],
    }));
    expect(parseCatalog({ data: rows })).toHaveLength(MAX_CATALOG_ITEMS);
  });

  it("ignores a non-numeric or non-positive context length", () => {
    expect(parseCatalog({ data: [{ id: "a/b", endpoints: ["openai"], context_length: "nope" }] })[0]).not.toHaveProperty(
      "contextLength",
    );
    expect(parseCatalog({ data: [{ id: "a/b", endpoints: ["openai"], context_length: -5 }] })[0]).not.toHaveProperty(
      "contextLength",
    );
  });

  it("records undeclared modalities as undeclared, not as text-only", () => {
    const [model] = parseCatalog({ data: [{ id: "a/b", endpoints: ["openai"] }] });
    expect(model?.declaresModalities).toBe(false);
    expect(model?.inputModalities).toBeUndefined();
  });

  it("keeps both endpoint spellings and drops unknown ones", () => {
    const [model] = parseCatalog({
      data: [{ id: "a/b", supported_endpoint_types: ["openai", "made-up"], endpoints: ["gemini"] }],
    });
    expect(model?.endpoints).toEqual(["openai", "gemini"]);
  });
});

describe("filterByCapability — chat", () => {
  const live = parseCatalog({
    data: [
      { id: "chat/openai", supported_endpoint_types: ["openai"] },
      { id: "chat/anthropic", supported_endpoint_types: ["anthropic"] },
      { id: "chat/gemini", supported_endpoint_types: ["gemini"] },
      { id: "chat/responses", supported_endpoint_types: ["openai-response"] },
      { id: "image/only", supported_endpoint_types: ["image-generation"] },
      { id: "video/only", supported_endpoint_types: ["openai-video"] },
      { id: "rerank/only", supported_endpoint_types: ["jina-rerank"] },
      { id: "embed/only", supported_endpoint_types: ["embeddings"] },
    ],
  });

  it("allows the four chat endpoint types", () => {
    expect(filterByCapability(live, "chat").map((m) => m.id)).toEqual([
      "chat/openai",
      "chat/anthropic",
      "chat/gemini",
      "chat/responses",
    ]);
  });

  it("excludes image-generation / openai-video / jina-rerank-only models", () => {
    const ids = filterByCapability(live, "chat").map((m) => m.id);
    expect(ids).not.toContain("image/only");
    expect(ids).not.toContain("video/only");
    expect(ids).not.toContain("rerank/only");
  });

  it("returns nothing for an unknown capability", () => {
    expect(filterByCapability(live, "telepathy")).toEqual([]);
  });
});

describe("filterByCapability — other capabilities", () => {
  const live = parseCatalog({
    data: [
      { id: "chat/openai", supported_endpoint_types: ["openai"] },
      { id: "embed/only", supported_endpoint_types: ["embeddings"] },
      { id: "image/only", supported_endpoint_types: ["image-generation"] },
      { id: "video/only", supported_endpoint_types: ["openai-video"] },
      { id: "rerank/only", supported_endpoint_types: ["jina-rerank"] },
    ],
  });

  it("embedding matches the embeddings endpoint", () => {
    expect(filterByCapability(live, "embedding").map((m) => m.id)).toEqual(["embed/only"]);
  });

  it("image matches image-generation", () => {
    expect(filterByCapability(live, "image").map((m) => m.id)).toEqual(["image/only"]);
  });

  it("video matches openai-video", () => {
    expect(filterByCapability(live, "video").map((m) => m.id)).toEqual(["video/only"]);
  });

  it("rerank matches jina-rerank", () => {
    expect(filterByCapability(live, "rerank").map((m) => m.id)).toEqual(["rerank/only"]);
  });
});

describe("filterByCapability — multimodal fail-closed", () => {
  const live = parseCatalog({
    data: [
      {
        id: "declares/image",
        supported_endpoint_types: ["openai"],
        architecture: { input_modalities: ["text", "image"] },
      },
      {
        id: "declares/audio",
        supported_endpoint_types: ["openai"],
        architecture: { input_modalities: ["text", "audio"] },
      },
      {
        id: "declares/video",
        supported_endpoint_types: ["openai"],
        architecture: { input_modalities: ["text", "video"] },
      },
      { id: "undeclared", supported_endpoint_types: ["openai"] },
      {
        id: "declares/empty",
        supported_endpoint_types: ["openai"],
        architecture: { input_modalities: [] },
      },
      {
        id: "declares/text-only",
        supported_endpoint_types: ["openai"],
        architecture: { input_modalities: ["text"] },
      },
      { id: "nonchat/image", supported_endpoint_types: ["image-generation"] },
    ],
  });

  it("requires an EXPLICIT modality declaration", () => {
    expect(filterByCapability(live, "chat", ["image"]).map((m) => m.id)).toEqual(["declares/image"]);
    expect(filterByCapability(live, "chat", ["audio"]).map((m) => m.id)).toEqual(["declares/audio"]);
    expect(filterByCapability(live, "chat", ["video"]).map((m) => m.id)).toEqual(["declares/video"]);
  });

  it("FAILS CLOSED — an undeclared model is excluded", () => {
    const ids = filterByCapability(live, "chat", ["image"]).map((m) => m.id);
    expect(ids).not.toContain("undeclared");
    expect(ids).not.toContain("declares/empty");
    expect(ids).not.toContain("declares/text-only");
    expect(ids).not.toContain("declares/audio");
  });

  it("still satisfies chat first (a non-chat model never qualifies)", () => {
    expect(filterByCapability(live, "chat", ["image"]).map((m) => m.id)).not.toContain("nonchat/image");
  });

  it("requires every requested modality at once", () => {
    expect(filterByCapability(live, "chat", ["image", "audio"])).toEqual([]);
  });

  it("ignores an unknown modality name rather than matching nothing", () => {
    expect(filterByCapability(live, "chat", ["telepathy"]).map((m) => m.id)).toHaveLength(6);
  });

  it("does not apply modality filtering to non-chat capabilities", () => {
    expect(filterByCapability(live, "image", ["image"]).map((m) => m.id)).toEqual(["nonchat/image"]);
  });
});

describe("verified fallback seed", () => {
  it("carries the five verified ids", () => {
    expect(ORCAROUTER_FALLBACK_CATALOG.map((m) => m.id)).toEqual([
      "openai/gpt-5.5",
      "anthropic/claude-opus-4.8",
      "google/gemini-3.5-flash",
      "deepseek/deepseek-v4-pro",
      "orcarouter/auto",
    ]);
  });

  it("preserves context, modalities and the reasoning ladder", () => {
    const seed = fallbackCatalog();
    const byId = new Map(seed.map((m) => [m.id, m]));
    expect(byId.get("openai/gpt-5.5")).toMatchObject({
      contextLength: 400000,
      inputModalities: ["text", "image"],
      reasoning: ["low", "medium", "high", "xhigh"],
    });
    expect(byId.get("anthropic/claude-opus-4.8")).toMatchObject({
      contextLength: 200000,
      inputModalities: ["text", "image"],
      reasoning: ["low", "medium", "high"],
    });
    expect(byId.get("google/gemini-3.5-flash")).toMatchObject({
      contextLength: 1000000,
      inputModalities: ["text", "image", "audio", "video"],
      reasoning: ["low", "medium", "high"],
    });
    expect(byId.get("deepseek/deepseek-v4-pro")).toMatchObject({
      contextLength: 164000,
      inputModalities: ["text"],
      reasoning: ["low", "medium", "high"],
    });
    expect(byId.get("orcarouter/auto")).toMatchObject({
      contextLength: 200000,
      inputModalities: ["text"],
    });
    expect(byId.get("orcarouter/auto")?.reasoning).toBeUndefined();
  });

  it("is usable under every capability filter it advertises", () => {
    const seed = fallbackCatalog();
    expect(filterByCapability(seed, "chat").map((m) => m.id)).toHaveLength(5);
    expect(filterByCapability(seed, "chat", ["image"]).map((m) => m.id)).toEqual([
      "openai/gpt-5.5",
      "anthropic/claude-opus-4.8",
      "google/gemini-3.5-flash",
    ]);
    expect(filterByCapability(seed, "chat", ["video"]).map((m) => m.id)).toEqual(["google/gemini-3.5-flash"]);
    expect(filterByCapability(seed, "chat", ["audio"]).map((m) => m.id)).toEqual(["google/gemini-3.5-flash"]);
    expect(filterByCapability(seed, "embedding")).toEqual([]);
  });

  it("returns a fresh copy each time", () => {
    fallbackCatalog()[0]!.endpoints.push("mutated");
    expect(fallbackCatalog()[0]!.endpoints).not.toContain("mutated");
  });
});

describe("resolveCatalog — live vs degraded", () => {
  const live = parseCatalog({ data: [{ id: "live/one", supported_endpoint_types: ["openai"] }] });

  it("prefers live and marks it not degraded", () => {
    const result = resolveCatalog(live, "chat");
    expect(result).toMatchObject({ source: "live", degraded: false, capability: "chat" });
    expect(result.models.map((m) => m.id)).toEqual(["live/one"]);
  });

  it("falls back to the seed with degraded:true when live is unavailable", () => {
    const result = resolveCatalog(null, "chat");
    expect(result).toMatchObject({ source: "fallback", degraded: true });
    expect(result.models.map((m) => m.id)).toEqual(ORCAROUTER_FALLBACK_CATALOG.map((m) => m.id));
  });

  it("treats an empty live answer as authoritative, not as an outage", () => {
    // The capability-scoped catalog can legitimately answer with no models — a
    // key whose workspace cannot call that capability. Serving the seed there
    // would offer models this key cannot use, so an empty live list is reported
    // as live, not degraded.
    const result = resolveCatalog(live, "embedding");
    expect(result).toMatchObject({ source: "live", degraded: false, capability: "embedding" });
    expect(result.models).toEqual([]);
  });

  it("never substitutes the seed for a live answer, even an empty one", () => {
    const result = resolveCatalog(live, "embedding");
    const seedIds = ORCAROUTER_FALLBACK_CATALOG.map((m) => m.id);
    expect(result.models.some((m) => seedIds.includes(m.id))).toBe(false);
  });

  it("NEVER mixes live with the seed", () => {
    const result = resolveCatalog(live, "chat");
    expect(result.models.map((m) => m.id)).not.toContain("openai/gpt-5.5");
  });

  it("carries the requested capability and modalities through the fallback", () => {
    const result = resolveCatalog(null, "chat", ["video"]);
    expect(result.models.map((m) => m.id)).toEqual(["google/gemini-3.5-flash"]);
    expect(result.capability).toBe("chat");
  });
});

describe("toPublicModels", () => {
  it("emits minimal metadata and never an endpoint or key field", () => {
    const [model] = toPublicModels(
      parseCatalog({
        data: [{ id: "a/b", endpoints: ["openai"], architecture: { input_modalities: ["text"] }, api_key: "sk-orca-x" }],
      }),
    );
    expect(Object.keys(model ?? {}).sort()).toEqual(["id", "inputModalities", "name"]);
  });
});

describe("query param parsing", () => {
  it("parses a modalities CSV and drops unknown names", () => {
    expect(parseModalitiesParam("image,video,telepathy")).toEqual(["image", "video"]);
    expect(parseModalitiesParam("")).toEqual([]);
    expect(parseModalitiesParam(undefined)).toEqual([]);
    expect(parseModalitiesParam(["image", "audio"])).toEqual(["image", "audio"]);
  });

  it("de-duplicates modalities", () => {
    expect(parseModalitiesParam("image,image")).toEqual(["image"]);
  });

  it("defaults the capability to chat", () => {
    expect(parseCapabilityParam("embedding")).toBe("embedding");
    expect(parseCapabilityParam("")).toBe("chat");
    expect(parseCapabilityParam("nonsense")).toBe("chat");
    expect(parseCapabilityParam(undefined)).toBe("chat");
  });

  it("parseCapabilitiesAndModalities combines both", () => {
    expect(parseCapabilitiesAndModalities("chat", "image,audio")).toEqual({
      capability: "chat",
      modalities: ["image", "audio"],
    });
  });
});
