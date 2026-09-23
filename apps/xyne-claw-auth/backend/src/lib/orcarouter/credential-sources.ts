/**
 * The OrcaRouter credential seam.
 *
 * There is ONE provider id (`orcarouter`) with two explicit authentication
 * choices. The second choice is a *credential source* of the same provider,
 * not a second provider id: credentials are keyed by `@@id([userId, provider])`
 * and a second id would create two live credential rows for one account.
 *
 * Both adapters return the SAME `{ apiKey, baseUrl }` shape, so downstream
 * (provider dispatch, model catalog) never asks which one ran. There is no
 * `if (source === "pkce")` anywhere outside this module.
 *
 * No client secret, ever. No pre-registered redirect URI. No device grant.
 */

import {
  ORCAROUTER_INFERENCE_BASE_URL,
  ORCAROUTER_KEY_PREFIX,
  MIN_ORCAROUTER_KEY_LENGTH,
  MAX_ORCAROUTER_KEY_LENGTH,
  resolveApiBase,
} from "./constants.js";
import { exchangeCode } from "./pkce.js";

export interface OrcaRouterCredential {
  apiKey: string;
  baseUrl: string;
}

/** Whatever each adapter needs. An adapter ignores the fields it does not use. */
export interface OrcaRouterAcquireInput {
  apiKey?: string;
  code?: string;
  state?: string;
  /** Resolved auth origin; the PKCE adapter exchanges here (tests / self-hosted). */
  authBase?: string;
  /** Resolved inference base; both adapters return it as `baseUrl`. */
  apiBase?: string;
  /** Test seam: inject a fetch implementation (never used to reach the network in tests). */
  fetchImpl?: typeof fetch;
  /** Test seam: the stored verifier for `state` (the route reads it from Redis). */
  verifier?: string;
}

export interface OrcaRouterCredentialSource {
  /** stable id for the source, used by the UI and tests */
  readonly id: "orcarouter" | "orcarouter-oauth";
  readonly method: "api_key" | "pkce";
  readonly label: string;
  readonly description: string;
  /** both adapters return the SAME shape; downstream must not care which ran */
  acquire(input: OrcaRouterAcquireInput): Promise<OrcaRouterCredential>;
}

/** Shape-only validation. An `sk-orca-` prefix is NOT proof the key is valid —
 *  only the first real request (or the catalog call) establishes that, and we
 *  never spend an inference request just to make a form say "valid". */
export function isWellFormedOrcaRouterKey(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return (
    trimmed.startsWith(ORCAROUTER_KEY_PREFIX) &&
    trimmed.length >= MIN_ORCAROUTER_KEY_LENGTH &&
    trimmed.length <= MAX_ORCAROUTER_KEY_LENGTH
  );
}

export class OrcaRouterCredentialError extends Error {
  constructor(message: string, public readonly reason: "shape" | "exchange" = "shape") {
    super(message);
    this.name = "OrcaRouterCredentialError";
  }
}

function inferenceBase(input: OrcaRouterAcquireInput): string {
  const explicit = input.apiBase?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  return resolveApiBase() || ORCAROUTER_INFERENCE_BASE_URL;
}

/** The API-key choice: the user pastes an `sk-orca-…` key they already hold. */
export const apiKeyCredentialSource: OrcaRouterCredentialSource = {
  id: "orcarouter",
  method: "api_key",
  label: "OrcaRouter - API",
  description: "Paste an existing OrcaRouter API key (sk-orca-…).",
  async acquire(input: OrcaRouterAcquireInput): Promise<OrcaRouterCredential> {
    const raw = (input.apiKey ?? "").trim();
    if (!raw) throw new OrcaRouterCredentialError("An OrcaRouter API key is required.", "shape");
    if (!isWellFormedOrcaRouterKey(raw)) {
      throw new OrcaRouterCredentialError(
        "That does not look like an OrcaRouter key — it should start with sk-orca-.",
        "shape",
      );
    }
    // No inference call here: validity is established by the first real request.
    return { apiKey: raw, baseUrl: inferenceBase(input) };
  },
};

/** The account-login choice: PKCE (Flow B, out-of-band code) issues a key. */
export const pkceCredentialSource: OrcaRouterCredentialSource = {
  id: "orcarouter-oauth",
  method: "pkce",
  label: "OrcaRouter - Auth",
  description: "Sign in with your OrcaRouter account to issue a key.",
  async acquire(input: OrcaRouterAcquireInput): Promise<OrcaRouterCredential> {
    const code = (input.code ?? "").trim();
    if (!code) throw new OrcaRouterCredentialError("An authorization code is required.", "exchange");
    if (!input.verifier) {
      throw new OrcaRouterCredentialError(
        "This sign-in attempt has no stored verifier — start sign-in again.",
        "exchange",
      );
    }
    const result = await exchangeCode({
      code,
      verifier: input.verifier,
      ...(input.authBase ? { authBase: input.authBase } : {}),
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });
    return { apiKey: result.apiKey, baseUrl: inferenceBase(input) };
  },
};

const SOURCES: readonly OrcaRouterCredentialSource[] = [apiKeyCredentialSource, pkceCredentialSource];

/** Both choices, in the order the UI shows them. */
export function describeCredentialSources(): OrcaRouterCredentialSource[] {
  return [...SOURCES];
}

export function credentialSource(id: string): OrcaRouterCredentialSource {
  const found = SOURCES.find((source) => source.id === id);
  if (!found) {
    throw new OrcaRouterCredentialError(
      `Unknown OrcaRouter credential source "${id}". Use one of: ${SOURCES.map((s) => s.id).join(", ")}.`,
    );
  }
  return found;
}
