import { useState, useEffect, useCallback } from "react";
import { useAuth } from "./hooks/useAuth";
import {
  listServers,
  listConnections,
  createConnection,
  deleteConnection,
  getCredentialFields,
  listGateways,
  createGateway,
  deleteGateway,
  linkIdentity,
  listAgents,
} from "./lib/api";
import type { McpServer, UserConnection, CredentialField, Gateway, Agent } from "./lib/types";
import { ConnectionList } from "./components/ConnectionList";
import { AddConnectionDialog } from "./components/AddConnectionDialog";
import { GatewayList } from "./components/GatewayList";
import { AddGatewayDialog } from "./components/AddGatewayDialog";
import { LinkIdentityDialog } from "./components/LinkIdentityDialog";
import { AgentList } from "./components/AgentList";

export function App() {
  const auth = useAuth();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [connections, setConnections] = useState<UserConnection[]>([]);
  const [credentialFields, setCredentialFields] = useState<Record<string, CredentialField[]>>({});
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [gatewaysLoading, setGatewaysLoading] = useState(false);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddConnection, setShowAddConnection] = useState(false);
  const [editConnectionServerId, setEditConnectionServerId] = useState<string | undefined>(undefined);
  const [showAddGateway, setShowAddGateway] = useState(false);
  const [linkGatewayId, setLinkGatewayId] = useState<string | null>(null);

  const userId = auth.status === "authenticated" ? auth.user.id : null;

  const loadServers = useCallback(async () => {
    try {
      const [serverList, fields] = await Promise.all([listServers(), getCredentialFields()]);
      setServers(serverList);
      setCredentialFields(fields);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load servers");
    }
  }, []);

  const loadConnections = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      setConnections(await listConnections(userId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load connections");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const loadGateways = useCallback(async () => {
    setGatewaysLoading(true);
    try {
      setGateways(await listGateways());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load gateways");
    } finally {
      setGatewaysLoading(false);
    }
  }, []);

  const loadAgents = useCallback(async () => {
    if (!userId) return;
    setAgentsLoading(true);
    try {
      setAgents(await listAgents(userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setAgentsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (auth.status !== "authenticated") return;
    loadConnections();
    loadServers();
    loadGateways();
    loadAgents();
  }, [auth.status, loadConnections, loadServers, loadGateways, loadAgents]);

  const handleAddConnection = useCallback(async (mcpServerId: string, credentials: Record<string, string>) => {
    if (!userId) return;
    try {
      await createConnection(userId, { mcpServerId, credentials });
      setShowAddConnection(false);
      setEditConnectionServerId(undefined);
      await loadConnections();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create connection");
    }
  }, [userId, loadConnections]);

  const handleDeleteConnection = useCallback(async (id: string) => {
    if (!userId) return;
    try {
      await deleteConnection(userId, id);
      await loadConnections();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete connection");
    }
  }, [userId, loadConnections]);

  const handleAddGateway = useCallback(async (type: string, name: string) => {
    try {
      await createGateway({ type, name });
      setShowAddGateway(false);
      await loadGateways();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create gateway");
    }
  }, [loadGateways]);

  const handleDeleteGateway = useCallback(async (id: string) => {
    try {
      await deleteGateway(id);
      await loadGateways();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete gateway");
    }
  }, [loadGateways]);

  const handleLinkIdentity = useCallback(async (externalUserId: string, targetUserId: string) => {
    if (!linkGatewayId) return;
    try {
      await linkIdentity(linkGatewayId, { externalUserId, userId: targetUserId });
      setLinkGatewayId(null);
      await loadGateways();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link identity");
    }
  }, [linkGatewayId, loadGateways]);

  if (auth.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <p className="text-zinc-400">Loading…</p>
      </div>
    );
  }

  if (auth.status === "unauthenticated") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-950 text-zinc-100">
        <h1 className="text-2xl font-semibold">XyneClaw Auth</h1>
        <p className="text-zinc-400">Sign in with your Xyne Spaces account to manage MCP integrations.</p>
        <button
          onClick={auth.login}
          className="rounded-lg bg-white px-6 py-2.5 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <h1 className="text-lg font-semibold">XyneClaw Auth</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-400">{auth.user.email}</span>
            <button
              onClick={auth.logout}
              className="rounded-md px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {error && (
          <div className="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-200">
            {error}
            <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-200">✕</button>
          </div>
        )}

        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-medium">MCP Integrations</h2>
          <button
            onClick={() => setShowAddConnection(true)}
            className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-300"
          >
            Add Integration
          </button>
        </div>

        <ConnectionList
          connections={connections}
          loading={loading}
          userId={auth.user.id}
          onDelete={handleDeleteConnection}
          onEdit={(conn) => {
            setEditConnectionServerId(conn.mcpServerId);
            setShowAddConnection(true);
          }}
          onUpdate={loadConnections}
        />

        <div className="mb-4 mt-10 flex items-center justify-between">
          <h2 className="text-lg font-medium">Agents</h2>
        </div>

        <AgentList
          agents={agents}
          loading={agentsLoading}
          onUpdate={loadAgents}
        />

        <div className="mb-4 mt-10 flex items-center justify-between">
          <h2 className="text-lg font-medium">Gateways</h2>
          <button
            onClick={() => setShowAddGateway(true)}
            className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-300"
          >
            Add Gateway
          </button>
        </div>

        <GatewayList
          gateways={gateways}
          loading={gatewaysLoading}
          onDelete={handleDeleteGateway}
          onLinkIdentity={setLinkGatewayId}
        />

        <AddConnectionDialog
          open={showAddConnection}
          onOpenChange={(open) => {
            setShowAddConnection(open);
            if (!open) setEditConnectionServerId(undefined);
          }}
          onSubmit={handleAddConnection}
          servers={servers}
          credentialFields={credentialFields}
          editServerId={editConnectionServerId}
        />

        <AddGatewayDialog
          open={showAddGateway}
          onOpenChange={setShowAddGateway}
          onSubmit={handleAddGateway}
        />

        <LinkIdentityDialog
          open={linkGatewayId !== null}
          onOpenChange={(open) => { if (!open) setLinkGatewayId(null); }}
          onSubmit={handleLinkIdentity}
          currentUserId={auth.user.id}
        />
      </main>
    </div>
  );
}
