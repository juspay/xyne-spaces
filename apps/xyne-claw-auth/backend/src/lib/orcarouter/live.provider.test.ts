// Live check through the provider code this integration adds — not a bare curl.
// It builds the request the way the settings route does (credential source →
// inference base URL from the credential → Bearer key → `/models` and
// `/chat/completions`) and asserts the capability filter holds against the
// real catalog. Runs only when ORCAROUTER_API_KEY is present; the verifier
// supplies it for live checks and every other check runs on fake keys.
import { describe, expect, it } from "vitest";
import { ORCAROUTER_INFERENCE_BASE_URL, ORCAROUTER_MODELS_PATH } from "./constants.js";
import { credentialSource } from "./credential-sources.js";
import { filterByCapability, parseCatalog, type ParsedCatalogModel } from "./model-catalog.js";

const apiKey = process.env["ORCAROUTER_API_KEY"] ?? "";
const live = apiKey ? describe : describe.skip;

async function catalog(
  capability: string,
  modalities: string[] = [],
): Promise<ParsedCatalogModel[]> {
  const params = new URLSearchParams({ capability });
  if (modalities.length > 0) params.set("modalities", modalities.join(","));
  const res = await fetch(`${ORCAROUTER_INFERENCE_BASE_URL}${ORCAROUTER_MODELS_PATH}?${params}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  expect(res.status).toBe(200);
  return filterByCapability(parseCatalog(await res.json()), capability, modalities as never);
}

live("OrcaRouter live provider path", () => {
  it("resolves the same credential result the API-key adapter hands downstream", async () => {
    const credential = await credentialSource("orcarouter").acquire({ apiKey });
    expect(credential.apiKey).toBe(apiKey);
    expect(credential.baseUrl).toBe(ORCAROUTER_INFERENCE_BASE_URL);
  });

  it("returns a chat catalog whose ids keep their vendor/model namespace", async () => {
    const models = await catalog("chat");
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) expect(model.id).toMatch(/^[a-z0-9][\w.-]*\/[\w.:-]+$/i);
  });

  it("filters the multimodal dropdown to chat models that declare image input", async () => {
    const text = await catalog("chat");
    const vision = await catalog("chat", ["image"]);
    expect(vision.length).toBeGreaterThan(0);
    expect(vision.length).toBeLessThan(text.length);
    for (const model of vision) {
      expect(model.inputModalities ?? []).toContain("image");
    }
  });

  it("completes a real chat request through the resolved provider endpoint", async () => {
    const credential = await credentialSource("orcarouter").acquire({ apiKey });
    const models = await catalog("chat");
    expect(models.length).toBeGreaterThan(0);

    // A workspace key can be scoped to a subset of the catalog, and a model
    // outside that scope answers 403 `model_access_denied` (a correct refusal,
    // not a broken request). Walk the catalog until a permitted model answers,
    // and fail only if none does.
    const endpoint = `${credential.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    let answer: { model: string; content: string } | null = null;
    const denials: string[] = [];

    for (const model of models) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model.id,
          messages: [{ role: "user", content: "Reply with the single word: ok" }],
          max_tokens: 512,
        }),
      });
      if (res.status === 403) {
        denials.push(model.id);
        continue;
      }
      expect(res.status, `chat/completions for ${model.id}`).toBe(200);
      const payload = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      answer = { model: model.id, content: payload.choices?.[0]?.message?.content ?? "" };
      break;
    }

    expect(answer, `no permitted model in catalog (denied: ${denials.join(", ")})`).not.toBeNull();
    expect(answer!.content.length).toBeGreaterThan(0);
  });
});
