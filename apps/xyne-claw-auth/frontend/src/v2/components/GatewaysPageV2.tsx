import { useState, useEffect, useCallback } from "react";
import type { Gateway, GatewayIdentity } from "../../lib/types";
import {
  listGateways,
  createGateway,
  deleteGateway,
  listIdentities,
  linkIdentity,
  unlinkIdentity,
} from "../../lib/api";
import { AddGatewayDialog } from "../../components/AddGatewayDialog";
import { LinkIdentityDialog } from "../../components/LinkIdentityDialog";
import { ChevronDown, ChevronUp, Users, Link2, Trash2 } from "lucide-react";

// ── GatewayCard ───────────────────────────────────────────────────────
function GatewayCard({
  gateway,
  onDelete,
  onLinkIdentity,
}: {
  gateway: Gateway;
  onDelete: (id: string) => void;
  onLinkIdentity: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [identities, setIdentities] = useState<GatewayIdentity[]>([]);
  const [idLoaded, setIdLoaded] = useState(false);

  const loadIdentities = useCallback(async () => {
    try {
      const list = await listIdentities(gateway.id);
      setIdentities(list);
      setIdLoaded(true);
    } catch {
      // silently fail
    }
  }, [gateway.id]);

  const handleToggle = () => {
    if (!idLoaded) loadIdentities();
    setExpanded((v) => !v);
  };

  const handleUnlink = async (identityId: string) => {
    try {
      await unlinkIdentity(gateway.id, identityId);
      await loadIdentities();
    } catch {
      // silently fail
    }
  };

  return (
    <div className="rounded-2xl bg-zinc-100 p-5">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-zinc-900">{gateway.name}</h3>
            <span className="rounded-full bg-zinc-200 px-2.5 py-0.5 text-xs font-medium text-zinc-600">
              {gateway.type}
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                gateway.enabled
                  ? "bg-green-200 text-green-700"
                  : "bg-red-100 text-red-600"
              }`}
            >
              {gateway.enabled ? "Enabled" : "Disabled"}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            {idLoaded ? `${identities.length} linked user${identities.length !== 1 ? "s" : ""}` : "—"}
          </p>
        </div>

        <div className="ml-4 flex shrink-0 items-center gap-2">
          <button
            onClick={handleToggle}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-200"
          >
            <Users size={13} strokeWidth={1.8} />
            {expanded ? "Hide" : "Show"} Users
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          <button
            onClick={() => onLinkIdentity(gateway.id)}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-200"
          >
            <Link2 size={13} strokeWidth={1.8} />
            Link User
          </button>
          {gateway.type !== "xyne-spaces" && (
            <button
              onClick={() => onDelete(gateway.id)}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-red-500 transition hover:bg-red-50"
            >
              <Trash2 size={13} strokeWidth={1.8} />
              Delete
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-2">
          {identities.length === 0 ? (
            <p className="text-sm text-zinc-400">No users linked to this gateway.</p>
          ) : (
            identities.map((identity) => (
              <div
                key={identity.id}
                className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-2"
              >
                <div className="text-sm">
                  <span className="font-medium text-zinc-800">{identity.externalUserId}</span>
                  <span className="mx-2 text-zinc-300">→</span>
                  <span className="text-zinc-600">{identity.user.name}</span>
                  <span className="ml-1 text-xs text-zinc-400">({identity.user.email})</span>
                </div>
                <button
                  onClick={() => handleUnlink(identity.id)}
                  className="text-xs text-red-400 transition hover:text-red-600"
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
}

// ── GatewaysPageV2 ────────────────────────────────────────────────────
interface Props {
  userId: string;
}

export function GatewaysPageV2({ userId }: Props) {
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [linkGatewayId, setLinkGatewayId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setGateways(await listGateways());
    } catch (err) {
      console.error("[GatewaysV2] failed to load gateways:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (type: string, name: string) => {
    try {
      await createGateway({ type, name });
      setShowAdd(false);
      load();
    } catch (err) {
      console.error("[GatewaysV2] create gateway error:", err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteGateway(id);
      load();
    } catch (err) {
      console.error("[GatewaysV2] delete gateway error:", err);
    }
  };

  const handleLinkIdentity = async (externalUserId: string, targetUserId: string) => {
    if (!linkGatewayId) return;
    try {
      await linkIdentity(linkGatewayId, { externalUserId, userId: targetUserId });
      setLinkGatewayId(null);
      load();
    } catch (err) {
      console.error("[GatewaysV2] link identity error:", err);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-zinc-900">Gateways</h2>
        <button
          onClick={() => setShowAdd(true)}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
        >
          + Add Gateway
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-zinc-400">Loading gateways…</div>
      ) : gateways.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 p-16 text-center">
          <p className="text-sm text-zinc-400">No gateways configured yet.</p>
          <p className="mt-1 text-xs text-zinc-400">
            Add a gateway to allow external services like Slack to reach your digital twin.
          </p>
        </div>
      ) : (
        <section className="mt-8">
          <div className="space-y-3">
            {gateways.map((gw) => (
              <GatewayCard
                key={gw.id}
                gateway={gw}
                onDelete={handleDelete}
                onLinkIdentity={setLinkGatewayId}
              />
            ))}
          </div>
        </section>
      )}

      <AddGatewayDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        onSubmit={handleAdd}
      />

      <LinkIdentityDialog
        open={linkGatewayId !== null}
        onOpenChange={(open) => { if (!open) setLinkGatewayId(null); }}
        onSubmit={handleLinkIdentity}
        currentUserId={userId}
      />
    </div>
  );
}
