/**
 * OrcaRouter origins, paths, PKCE policy and the verified fallback catalog.
 *
 * Authentication and inference live on DIFFERENT public origins
 * (`www.orcarouter.ai` for auth, `api.orcarouter.ai/v1` for inference) and the
 * paths are NOT derivable from one another — the auth endpoints are not served
 * under the inference host's `/v1`. Every URL built by this module names the
 * origin it belongs to explicitly; nothing here replaces a hostname or appends
 * `/v1` to reach the other side.
 */

/** One provider, two explicit authentication choices (see credential-sources.ts). */
export const ORCAROUTER_PROVIDER_ID = "orcarouter";

/** Public defaults. Self-hosted deployments override these (see below). */
export const ORCAROUTER_AUTH_ORIGIN = "https://www.orcarouter.ai";
export const ORCAROUTER_API_ORIGIN = "https://api.orcarouter.ai";
export const ORCAROUTER_INFERENCE_BASE_URL = `${ORCAROUTER_API_ORIGIN}/v1`;

/** Env names. Explicit override wins over the shared fallback; the shared
 *  fallback wins over the public default. */
export const ORCA_AUTH_BASE_URL_ENV = "ORCA_AUTH_BASE_URL";
export const ORCA_API_BASE_URL_ENV = "ORCA_API_BASE_URL";
export const ORCA_BASE_URL_ENV = "ORCA_BASE_URL";

/** Paths, each relative to its OWN origin — never interchangeable. */
export const ORCAROUTER_AUTHORIZE_PATH = "/auth";
export const ORCAROUTER_EXCHANGE_PATH = "/api/v1/auth/keys";
export const ORCAROUTER_MODELS_PATH = "/models";

/** Consent-screen label presented to the user as a claim. */
export const ORCAROUTER_APP_NAME = "Xyne Spaces";

/** The scope this app asks for. `connector` exists upstream but is not used here. */
export const ORCAROUTER_SCOPE = "api";

/** A displayed code is put into human hands, so S256 is mandatory (Flow B). */
export const ORCAROUTER_CODE_CHALLENGE_METHOD = "S256";

/** Flow B: the code is shown on the consent screen, not redirected anywhere. */
export const ORCAROUTER_OOB_CALLBACK = "oob";

/** Auth codes are single-use with a 10 minute TTL; our stored verifier matches. */
export const ORCAROUTER_PKCE_TTL_SECONDS = 600;

/** Redis key prefix for the server-side verifier store: `<prefix><userId>:<state>`. */
export const ORCAROUTER_PKCE_PREFIX = "orcarouter-pkce:";

/** Upstream caps PKCE-issued keys at 10 per user per 24h; over it the consent
 *  endpoint answers 429. A 429 here is terminal for this attempt, never a
 *  reason to retry in a loop. */
export const ORCAROUTER_KEY_ISSUE_LIMIT_PER_DAY = 10;

/** Bounds on a live catalog response — a catalog must never consume unbounded
 *  memory or advertise more than a picker can show. */
export const MAX_CATALOG_ITEMS = 400;
export const MAX_CATALOG_BYTES = 1_000_000;
export const MAX_MODEL_ID_LENGTH = 200;
export const CATALOG_TIMEOUT_MS = 15_000;
export const EXCHANGE_TIMEOUT_MS = 20_000;

/** Acceptable `sk-orca-…` shape. A prefix is NOT proof of validity — it only
 *  catches obvious typos; the first real request establishes validity. */
export const ORCAROUTER_KEY_PREFIX = "sk-orca-";
export const MIN_ORCAROUTER_KEY_LENGTH = 16;
export const MAX_ORCAROUTER_KEY_LENGTH = 512;

/** Capability names accepted by the catalog route's `capability` query param. */
export const ORCAROUTER_CAPABILITIES = ["chat", "embedding", "image", "video", "rerank"] as const;
export type OrcaRouterCapability = (typeof ORCAROUTER_CAPABILITIES)[number];

export function isOrcaRouterCapability(value: unknown): value is OrcaRouterCapability {
  return typeof value === "string" && (ORCAROUTER_CAPABILITIES as readonly string[]).includes(value);
}

/** Input modalities a model may declare. `text` is never filtered on — every
 *  chat model has it — but `image` / `audio` / `video` are attachment gates. */
export const ORCAROUTER_MODALITIES = ["text", "image", "audio", "video"] as const;
export type OrcaRouterModality = (typeof ORCAROUTER_MODALITIES)[number];

export function isOrcaRouterModality(value: unknown): value is OrcaRouterModality {
  return typeof value === "string" && (ORCAROUTER_MODALITIES as readonly string[]).includes(value);
}

/**
 * Endpoint/route types the inference API can speak. A model is only usable
 * here when it declares one of these; the exclusions (`image-generation`,
 * `openai-video`, `jina-rerank`) are routes this app cannot drive as chat.
 */
export const CHAT_ENDPOINT_TYPES = ["openai", "anthropic", "gemini", "openai-response"] as const;
export const NON_CHAT_ENDPOINT_TYPES = ["image-generation", "openai-video", "jina-rerank"] as const;
export const EMBEDDING_ENDPOINT_TYPE = "embeddings";
export const IMAGE_ENDPOINT_TYPE = "image-generation";
export const VIDEO_ENDPOINT_TYPE = "openai-video";
export const RERANK_ENDPOINT_TYPE = "jina-rerank";

/** Every endpoint type this app understands. Anything else in a catalog
 *  response is dropped rather than trusted. */
export const KNOWN_ENDPOINT_TYPES: readonly string[] = [
  ...CHAT_ENDPOINT_TYPES,
  ...NON_CHAT_ENDPOINT_TYPES,
  EMBEDDING_ENDPOINT_TYPE,
];

/** Minimal metadata for one model, as returned to the browser. Never the key. */
export interface OrcaRouterModel {
  id: string;
  name: string;
  contextLength?: number;
  inputModalities?: string[];
  reasoning?: string[];
}

/**
 * The verified fallback seed. Live discovery is authoritative when it
 * succeeds; when it fails the seed keeps a fresh installation usable, WITH the
 * context / modality / reasoning metadata the spec requires preserved (an
 * outage must not silently downgrade `openai/gpt-5.5`'s effort ladder).
 */
export const ORCAROUTER_FALLBACK_CATALOG: readonly OrcaRouterModel[] = [
  {
    id: "openai/gpt-5.5",
    name: "openai/gpt-5.5",
    contextLength: 400_000,
    inputModalities: ["text", "image"],
    reasoning: ["low", "medium", "high", "xhigh"],
  },
  {
    id: "anthropic/claude-opus-4.8",
    name: "anthropic/claude-opus-4.8",
    contextLength: 200_000,
    inputModalities: ["text", "image"],
    reasoning: ["low", "medium", "high"],
  },
  {
    id: "google/gemini-3.5-flash",
    name: "google/gemini-3.5-flash",
    contextLength: 1_000_000,
    inputModalities: ["text", "image", "audio", "video"],
    reasoning: ["low", "medium", "high"],
  },
  {
    id: "deepseek/deepseek-v4-pro",
    name: "deepseek/deepseek-v4-pro",
    contextLength: 164_000,
    inputModalities: ["text"],
    reasoning: ["low", "medium", "high"],
  },
  {
    id: "orcarouter/auto",
    name: "orcarouter/auto",
    contextLength: 200_000,
    inputModalities: ["text"],
  },
];

/** Loopback hosts allowed to use `http:` — everything else must be `https:`. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return LOOPBACK_HOSTS.has(normalized) || normalized.startsWith("127.");
}

export class OrcaRouterConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrcaRouterConfigError";
  }
}

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
}

/**
 * The origin discipline: a remote origin must be `https:`, `http:` is allowed
 * only for loopback development, and credentials must not be embedded in the
 * URL. Returns the normalized origin (no trailing slash) or throws.
 */
export function assertAllowedOrcaRouterOrigin(rawUrl: string, label: string): string {
  const value = stripTrailingSlashes((rawUrl ?? "").trim());
  if (!value) throw new OrcaRouterConfigError(`${label} is empty`);

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new OrcaRouterConfigError(`${label} must be an absolute URL`);
  }
  if (parsed.username || parsed.password) {
    throw new OrcaRouterConfigError(`${label} must not carry credentials in the URL`);
  }
  if (parsed.protocol === "https:") return stripTrailingSlashes(parsed.origin + parsed.pathname.replace(/\/+$/, ""));
  if (parsed.protocol === "http:") {
    if (!isLoopbackHost(parsed.hostname)) {
      throw new OrcaRouterConfigError(
        `${label} must use https for a remote host (http is allowed only for localhost, 127.0.0.1 or [::1])`,
      );
    }
    return stripTrailingSlashes(parsed.origin + parsed.pathname.replace(/\/+$/, ""));
  }
  throw new OrcaRouterConfigError(`${label} must be an https URL`);
}

function readEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The auth origin: `/auth` and the code exchange are served from here.
 * Explicit `ORCA_AUTH_BASE_URL` → shared `ORCA_BASE_URL` → public default.
 */
export function resolveAuthBase(env: Record<string, string | undefined> = process.env): string {
  const explicit = readEnv(env, ORCA_AUTH_BASE_URL_ENV);
  if (explicit) return assertAllowedOrcaRouterOrigin(explicit, ORCA_AUTH_BASE_URL_ENV);
  const shared = readEnv(env, ORCA_BASE_URL_ENV);
  if (shared) return assertAllowedOrcaRouterOrigin(shared, ORCA_BASE_URL_ENV);
  return ORCAROUTER_AUTH_ORIGIN;
}

/**
 * The inference base (`…/v1`): model discovery and every completion call go
 * here. Explicit `ORCA_API_BASE_URL` → shared `ORCA_BASE_URL` (+`/v1`) →
 * public default. A bare origin override gets `/v1` appended; an override that
 * already carries a path is used verbatim.
 */
export function resolveApiBase(env: Record<string, string | undefined> = process.env): string {
  const explicit = readEnv(env, ORCA_API_BASE_URL_ENV);
  if (explicit) return withInferencePath(assertAllowedOrcaRouterOrigin(explicit, ORCA_API_BASE_URL_ENV));
  const shared = readEnv(env, ORCA_BASE_URL_ENV);
  if (shared) return `${assertAllowedOrcaRouterOrigin(shared, ORCA_BASE_URL_ENV)}/v1`;
  return ORCAROUTER_INFERENCE_BASE_URL;
}

function withInferencePath(origin: string): string {
  try {
    const parsed = new URL(origin);
    if (!parsed.pathname || parsed.pathname === "/") return `${origin}/v1`;
  } catch {
    return origin;
  }
  return origin;
}

/** Full authorize URL origin+path, for tests and diagnostics. */
export function orcaRouterAuthorizeUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  return `${resolveAuthBase(env)}${ORCAROUTER_AUTHORIZE_PATH}`;
}

/** Full code-exchange URL origin+path — auth origin only, never the api origin. */
export function orcaRouterExchangeUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  return `${resolveAuthBase(env)}${ORCAROUTER_EXCHANGE_PATH}`;
}

/** Full catalog URL origin+path — api origin only, never the auth origin. */
export function orcaRouterModelsUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  return `${resolveApiBase(env)}${ORCAROUTER_MODELS_PATH}`;
}
