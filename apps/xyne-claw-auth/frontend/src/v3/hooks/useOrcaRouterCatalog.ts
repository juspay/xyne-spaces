import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  listOrcaRouterModelsForUser,
  type OrcaRouterModelInfo,
} from "../../lib/api";
/** How the catalog fetch failed — the UI gives each class its own copy and
 *  its own remedy (re-connect vs. retry vs. pick another model). */
export type OrcaRouterCatalogErrorKind = "auth" | "network" | "server";

export interface OrcaRouterCatalogError {
  kind: OrcaRouterCatalogErrorKind;
  message: string;
}

export interface OrcaRouterCatalogState {
  models: OrcaRouterModelInfo[];
  source: "live" | "fallback" | null;
  degraded: boolean;
  loading: boolean;
  error: OrcaRouterCatalogError | null;
  refresh: () => void;
}

function classify(err: unknown): OrcaRouterCatalogError {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) {
      return {
        kind: "auth",
        message:
          "OrcaRouter rejected the stored credential. Re-connect below, or paste a new key.",
      };
    }
    return { kind: "server", message: err.message };
  }
  if (err instanceof TypeError) {
    return {
      kind: "network",
      message: "Couldn't reach the OrcaRouter catalog. Check your connection and retry.",
    };
  }
  return { kind: "server", message: err instanceof Error ? err.message : "Failed to load models" };
}

/**
 * Model catalog for the OrcaRouter provider. `capability`/`modalities` are the
 * filter the backend applies; both are part of the request key so a change
 * (provider switch, attachment type) refetches instead of showing a stale list.
 */
export function useOrcaRouterCatalog(opts: {
  userId: string;
  provider: string;
  enabled: boolean;
  capability: string;
  modalities: string[];
  /** Optional debounce, for callers that recompute while the user types. */
  debounceMs?: number;
}): OrcaRouterCatalogState {
  const { userId, provider, enabled, capability, debounceMs = 0 } = opts;
  const modalitiesKey = [...opts.modalities].sort().join(",");
  const active = enabled && provider === "orcarouter" && userId !== "";

  const [models, setModels] = useState<OrcaRouterModelInfo[]>([]);
  const [source, setSource] = useState<"live" | "fallback" | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<OrcaRouterCatalogError | null>(null);
  const [nonce, setNonce] = useState(0);

  // Only the newest request may write state — a slow response for the previous
  // capability must not overwrite the list for the current one.
  const generation = useRef(0);

  useEffect(() => {
    if (!active) {
      generation.current += 1;
      setModels([]);
      setSource(null);
      setDegraded(false);
      setLoading(false);
      setError(null);
      return;
    }

    const mine = generation.current + 1;
    generation.current = mine;
    setLoading(true);
    setError(null);

    let cancelled = false;
    const timer = setTimeout(() => {
      void listOrcaRouterModelsForUser(userId, {
        capability,
        modalities: modalitiesKey ? modalitiesKey.split(",") : [],
      })
        .then((catalog) => {
          if (cancelled || generation.current !== mine) return;
          setModels(catalog.models ?? []);
          setSource(catalog.source);
          setDegraded(catalog.degraded === true || catalog.source === "fallback");
        })
        .catch((err: unknown) => {
          if (cancelled || generation.current !== mine) return;
          setModels([]);
          setSource(null);
          setDegraded(false);
          setError(classify(err));
        })
        .finally(() => {
          if (cancelled || generation.current !== mine) return;
          setLoading(false);
        });
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, userId, capability, modalitiesKey, nonce, debounceMs]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return { models, source, degraded, loading, error, refresh };
}
