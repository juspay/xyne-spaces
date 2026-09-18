import { describe, expect, it } from "vitest";
import { namesAnAgent, parseAgentRoute } from "./routing.js";

describe("parseAgentRoute", () => {
  it("splits a leading /slug off the task", () => {
    expect(parseAgentRoute("/ask-ai summarise this")).toEqual({ slug: "ask-ai", task: "summarise this", listAgents: false });
  });

  it("accepts @slug as well, and lower-cases the slug", () => {
    expect(parseAgentRoute("@Ask-AI hello")).toMatchObject({ slug: "ask-ai", task: "hello" });
  });

  it("keeps a bare slug with no task, so the caller can ask what they want", () => {
    expect(parseAgentRoute("/ask-ai")).toMatchObject({ slug: "ask-ai", task: "" });
  });

  it("leaves unprefixed text as the whole task", () => {
    expect(parseAgentRoute("what is my leave balance")).toEqual({
      task: "what is my leave balance",
      listAgents: false,
    });
  });

  it("recognises /agents on its own", () => {
    expect(parseAgentRoute("/agents")).toEqual({ task: "", listAgents: true });
  });
});

describe("namesAnAgent", () => {
  it("is true for the forms that address an agent", () => {
    for (const text of ["/ask-ai hi", "@ask-ai hi", "/agents", "/ask-ai"]) {
      expect(namesAnAgent(text)).toBe(true);
    }
  });

  it("is false for ordinary chatter, including a stray slash", () => {
    for (const text of ["hello there", "and/or", "50/50 split"]) {
      expect(namesAnAgent(text)).toBe(false);
    }
  });
});
