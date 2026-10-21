import { describe, expect, it } from "vitest";
import { litellmEndpoint, normalizeBaseUrl } from "../src/config.js";

describe("normalizeBaseUrl", () => {
  it("trims whitespace and trailing slashes and falls back when empty", () => {
    expect(normalizeBaseUrl(" https://llm.example.com/ ", "http://d")).toBe("https://llm.example.com");
    expect(normalizeBaseUrl("https://llm.example.com///", "http://d")).toBe("https://llm.example.com");
    expect(normalizeBaseUrl("", "http://d")).toBe("http://d");
    expect(normalizeBaseUrl("   ", "http://d")).toBe("http://d");
    expect(normalizeBaseUrl(undefined, "http://d")).toBe("http://d");
  });

  it("keeps a /v1 suffix so clients that expect it still get it", () => {
    expect(normalizeBaseUrl("https://llm.example.com/v1/", "http://d")).toBe("https://llm.example.com/v1");
  });
});

describe("litellmEndpoint", () => {
  it("never doubles /v1 whatever form the base URL takes", () => {
    for (const base of ["https://llm.example.com", "https://llm.example.com/v1"]) {
      expect(litellmEndpoint("/v1/chat/completions", base)).toBe("https://llm.example.com/v1/chat/completions");
      expect(litellmEndpoint("/v1/models", base)).toBe("https://llm.example.com/v1/models");
    }
  });

  it("puts root endpoints at the proxy root even when the base ends in /v1", () => {
    expect(litellmEndpoint("/model/info", "https://llm.example.com/v1")).toBe("https://llm.example.com/model/info");
    expect(litellmEndpoint("model/info", "https://llm.example.com")).toBe("https://llm.example.com/model/info");
  });
});
