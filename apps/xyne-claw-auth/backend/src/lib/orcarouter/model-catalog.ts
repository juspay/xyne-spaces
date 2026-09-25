/**
 * OrcaRouter model catalog: bounded parsing, capability filtering, and the
 * verified fallback seed.
 *
 * The live catalog (`GET ${apiBase}/models`, authenticated with the user's
 * stored OrcaRouter key) is the single source of truth when it succeeds. When
 * it fails, the verified seed keeps a fresh installation usable — never
 * free-text entry, and never a mix of the two (live success is authoritative).
 *
 * Model ids are preserved verbatim (`vendor/model`).
 */

import {
  CHAT_ENDPOINT_TYPES,
  EMBEDDING_ENDPOINT_TYPE,
  IMAGE_ENDPOINT_TYPE,
  KNOWN_ENDPOINT_TYPES,
  MAX_CATALOG_ITEMS,
  MAX_MODEL_ID_LENGTH,
  ORCAROUTER_FALLBACK_CATALOG,
  RERANK_ENDPOINT_TYPE,
  VIDEO_ENDPOINT_TYPE,
  isOrcaRouterCapability,
  isOrcaRouterModality,
  type OrcaRouterCapability,
  type OrcaRouterModel,
  type OrcaRouterModality,
} from "./constants.js";

const CHAT_ENDPOINT_SET = new Set<string>(CHAT_ENDPOINT_TYPES);
const KNOWN_ENDPOINT_SET = new Set<string>(KNOWN_ENDPOINT_TYPES);

/** What the parser carries forward from an upstream record. `endpoints` is the
 *  union of `supported_endpoint_types` and `endpoints` — the two spellings
 *  upstream uses for the same idea. */
export interface ParsedCatalogModel extends OrcaRouterModel {
  endpoints: string[];
  /** True only when `architecture.input_modalities` declared modalities. */
  declaresModalities: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return "";
  return trimmed;
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

function readPositiveInt(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(Math.floor(n), 100_000_000);
}

/**
 * Parse a live catalog payload into bounded, well-formed records.
 *
 * Never throws on junk: a malformed record is dropped, a payload that is not
 * an object yields nothing, and the item count is capped. Accepts the OpenAI
 * `{ data: [...] }` envelope as well as a bare array or `{ models: [...] }`.
 */
export function parseCatalog(payload: unknown): ParsedCatalogModel[] {
  const rows = catalogRows(payload);
  const models: ParsedCatalogModel[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (models.length >= MAX_CATALOG_ITEMS) break;
    const record = asRecord(row);
    if (!record) continue;

    const id = readString(record["id"] ?? record["model"] ?? record["name"], MAX_MODEL_ID_LENGTH);
    if (!id || seen.has(id)) continue;

    const endpoints = collectEndpoints(record);
    // A record that advertises no route this client can speak is not a model
    // we can offer — drop it rather than list something unusable.
    if (endpoints.length === 0) continue;

    const name =
      readString(record["name"] ?? record["display_name"], MAX_MODEL_ID_LENGTH) || id;

    const architecture = asRecord(record["architecture"]);
    const declared = readStringList(architecture?.["input_modalities"]).filter(isOrcaRouterModality);
    const declaredAny = Array.isArray(architecture?.["input_modalities"]);

    const contextLength =
      readPositiveInt(record["context_length"] ?? record["contextLength"] ?? record["context_window"]);

    const reasoning = readStringList(
      record["reasoning_efforts"] ?? record["reasoningEfforts"] ?? record["reasoning"],
    );

    seen.add(id);
    models.push({
      id,
      name,
      endpoints,
      declaresModalities: declaredAny,
      ...(contextLength !== undefined ? { contextLength } : {}),
      // Only a record that DECLARED modalities gets them recorded; absent means
      // "undeclared", which the multimodal filter treats as a fail-closed miss.
      ...(declaredAny ? { inputModalities: declared } : {}),
      ...(reasoning.length > 0 ? { reasoning } : {}),
    });
  }

  return models;
}

function catalogRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of ["data", "models"]) {
    const rows = record[key];
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

function collectEndpoints(record: Record<string, unknown>): string[] {
  const endpoints: string[] = [];
  for (const key of ["supported_endpoint_types", "endpoints"]) {
    for (const entry of readStringList(record[key])) {
      // Only endpoint types this client understands are trusted.
      if (KNOWN_ENDPOINT_SET.has(entry) && !endpoints.includes(entry)) endpoints.push(entry);
    }
  }
  return endpoints;
}

/** The seed as parser-shaped records, so filtering treats it identically to live data. */
export function fallbackCatalog(): ParsedCatalogModel[] {
  return ORCAROUTER_FALLBACK_CATALOG.map((model) => ({
    id: model.id,
    name: model.name,
    ...(model.contextLength !== undefined ? { contextLength: model.contextLength } : {}),
    ...(model.inputModalities ? { inputModalities: [...model.inputModalities] } : {}),
    ...(model.reasoning ? { reasoning: [...model.reasoning] } : {}),
    declaresModalities: Boolean(model.inputModalities),
    // The seed's endpoint types are exactly the routes each entry is verified on.
    endpoints: seedEndpoints(model),
  }));
}

function seedEndpoints(model: OrcaRouterModel): string[] {
  const endpoints: string[] = ["openai"];
  if (model.id === "google/gemini-3.5-flash") endpoints.push("gemini");
  if (model.id.startsWith("anthropic/")) endpoints.push("anthropic");
  return endpoints;
}

/**
 * Capability rules, applied exactly.
 *
 * - `chat`: at least one of `openai` / `anthropic` / `gemini` /
 *   `openai-response`, excluding image-generation / openai-video /
 *   jina-rerank-only models.
 * - `chat` + extra modalities (`image`/`audio`/`video`): first satisfy chat,
 *   then require `architecture.input_modalities` to EXPLICITLY contain that
 *   modality. **Fail closed** — an undeclared modality excludes the model.
 * - `embedding`: `embeddings` endpoint.
 * - `image`: `image-generation`. `video`: `openai-video`. `rerank`: `jina-rerank`.
 */
export function filterByCapability(
  models: readonly ParsedCatalogModel[],
  capability: string,
  extraModalities: readonly string[] = [],
): ParsedCatalogModel[] {
  if (!isOrcaRouterCapability(capability)) return [];

  const wanted = extraModalities.filter(isOrcaRouterModality);
  const rows =
    capability === "chat" ? models.filter(isChatCapable) : models.filter((m) => matchesEndpoint(m, capability));

  if (capability !== "chat" || wanted.length === 0) return [...rows];

  return rows.filter((model) => wanted.every((modality) => declaresModality(model, modality)));
}

function isChatCapable(model: ParsedCatalogModel): boolean {
  // "exclude image-generation / openai-video / jina-rerank-only models" — a
  // model is chat-capable exactly when it advertises at least one route this
  // client can drive as chat; a model that advertises ONLY the non-chat routes
  // is therefore excluded.
  return model.endpoints.some((endpoint) => CHAT_ENDPOINT_SET.has(endpoint));
}

function matchesEndpoint(model: ParsedCatalogModel, capability: string): boolean {
  switch (capability) {
    case "embedding":
      return model.endpoints.includes(EMBEDDING_ENDPOINT_TYPE);
    case "image":
      return model.endpoints.includes(IMAGE_ENDPOINT_TYPE);
    case "video":
      return model.endpoints.includes(VIDEO_ENDPOINT_TYPE);
    case "rerank":
      return model.endpoints.includes(RERANK_ENDPOINT_TYPE);
    default:
      return false;
  }
}

function declaresModality(model: ParsedCatalogModel, modality: OrcaRouterModality): boolean {
  // Fail closed: a model that does not declare the modality is excluded.
  if (!model.declaresModalities) return false;
  return (model.inputModalities ?? []).includes(modality);
}

/** Browser-facing projection: minimal metadata only, never the key. */
export function toPublicModels(models: readonly ParsedCatalogModel[]): OrcaRouterModel[] {
  return models.map((model) => ({
    id: model.id,
    name: model.name,
    ...(model.contextLength !== undefined ? { contextLength: model.contextLength } : {}),
    ...(model.inputModalities ? { inputModalities: [...model.inputModalities] } : {}),
    ...(model.reasoning ? { reasoning: [...model.reasoning] } : {}),
  }));
}

export interface CatalogResult {
  models: OrcaRouterModel[];
  source: "live" | "fallback";
  degraded: boolean;
  capability: string;
}

/**
 * Resolve the catalog for a capability. Live success is authoritative and is
 * never mixed with the seed; a live failure (or an empty live result for the
 * capability) degrades to the verified seed and says so.
 */
export function resolveCatalog(
  live: readonly ParsedCatalogModel[] | null,
  capability: string,
  extraModalities: readonly string[] = [],
): CatalogResult {
  const wanted = extraModalities.filter(isOrcaRouterModality);
  if (live) {
    // A live answer is authoritative even when it filters down to nothing: an
    // empty list is a real answer ("this key's workspace can call no model of
    // this capability"), not an outage. Substituting the seed here would offer
    // models the key cannot serve.
    const filtered = filterByCapability(live, capability, wanted);
    return { models: toPublicModels(filtered), source: "live", degraded: false, capability };
  }
  const fallback = filterByCapability(fallbackCatalog(), capability, wanted);
  return { models: toPublicModels(fallback), source: "fallback", degraded: true, capability };
}

/** Parse a `modalities` CSV query param into known modality names. */
export function parseModalitiesParam(raw: unknown): OrcaRouterModality[] {
  const value = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join(",") : "";
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(isOrcaRouterModality)
    .filter((entry, index, all) => all.indexOf(entry) === index);
}

/** Parse a `capability` query param, defaulting to `chat`. */
export function parseCapabilityParam(raw: unknown): OrcaRouterCapability {
  const value = typeof raw === "string" ? raw.trim() : "";
  return isOrcaRouterCapability(value) ? value : "chat";
}

/** Both query params the catalog route accepts, parsed together. */
export function parseCapabilitiesAndModalities(
  capability: unknown,
  modalities: unknown,
): { capability: OrcaRouterCapability; modalities: OrcaRouterModality[] } {
  return {
    capability: parseCapabilityParam(capability),
    modalities: parseModalitiesParam(modalities),
  };
}
