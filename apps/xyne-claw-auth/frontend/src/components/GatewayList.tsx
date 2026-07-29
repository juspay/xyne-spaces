import { useState, useEffect, useCallback } from "react";
import type { Gateway, GatewayIdentity } from "../lib/types";
import { listIdentities, unlinkIdentity } from "../lib/api";

interface Props {
  gateways: Gateway[];
  loading: boolean;
  onDelete: (id: string) => void;
  onLinkIdentity: (gatewayId: string) => void;
}

export function GatewayList({ gateways, loading, onDelete, onLinkIdentity }: Props) {
  const [identities, setIdentities] = useState<Record<string, GatewayIdentity[]>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadIdentities = useCallback(async (gatewayId: string) => {
    try {
      const list = await listIdentities(gatewayId);
      setIdentities((prev) => ({ ...prev, [gatewayId]: list }));
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    for (const gw of gateways) {
      loadIdentities(gw.id);
    }
  }, [gateways, loadIdentities]);

  const handleUnlink = useCallback(async (gatewayId: string, identityId: string) => {
    try {
      await unlinkIdentity(gatewayId, identityId);
      await loadIdentities(gatewayId);
    } catch {
      // silently fail
    }
  }, [loadIdentities]);

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading gateways...</p>;
  }

  if (gateways.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center">
        <p className="text-zinc-400">No gateways configured yet.</p>
        <p className="mt-1 text-sm text-zinc-500">Add a gateway to allow external services like Slack to reach your digital twin.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {gateways.map((gw) => {
        const gwIdentities = identities[gw.id] ?? [];
        const isExpanded = expandedId === gw.id;

        return (
          <div key={gw.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{gw.name}</h3>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
                    {gw.type}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      gw.enabled
                        ? "bg-green-950 text-green-400"
                        : "bg-red-950 text-red-400"
                    }`}
                  >
                    {gw.enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {gwIdentities.length} linked user{gwIdentities.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="ml-4 flex shrink-0 items-center gap-2">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : gw.id)}
                  className="rounded-md px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100"
                >
                  {isExpanded ? "Hide Linked Users" : "Show Linked Users"}
                </button>
                <button
                  onClick={() => onLinkIdentity(gw.id)}
                  className="rounded-md px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100"
                >
                  Link User
                </button>
                {gw.type !== "xyne-spaces" && (
                  <button
                    onClick={() => onDelete(gw.id)}
                    className="rounded-md px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-950 hover:text-red-300"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>

            {isExpanded && (
              <div className="mt-3 space-y-2">
                {gwIdentities.length === 0 ? (
                  <p className="text-sm text-zinc-500">No users linked to this gateway.</p>
                ) : (
                  gwIdentities.map((identity) => (
                    <div
                      key={identity.id}
                      className="flex items-center justify-between rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2"
                    >
                      <div className="text-sm">
                        <span className="text-zinc-300">{identity.externalUserId}</span>
                        <span className="mx-2 text-zinc-600">&rarr;</span>
                        <span className="text-zinc-400">{identity.user.name}</span>
                        <span className="ml-1 text-xs text-zinc-500">({identity.user.email})</span>
                      </div>
                      <button
                        onClick={() => handleUnlink(gw.id, identity.id)}
                        className="text-xs text-red-400 transition hover:text-red-300"
                      >
                        Unlink
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
