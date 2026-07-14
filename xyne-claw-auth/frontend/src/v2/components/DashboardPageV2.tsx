import { useState, useEffect, useCallback } from "react";
import { listAgents } from "../../lib/api";
import type { AgentLight } from "../../lib/types";
import { AgentCard } from "./common/AgentCard";
import { CreateAgentModal } from "../../components/CreateAgentModal";

interface Props {
  userId: string;
  isAdmin?: boolean;
}

export function DashboardPageV2({ userId, isAdmin }: Props) {
  const [agents, setAgents] = useState<AgentLight[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateAgent, setShowCreateAgent] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAgents(userId);
      setAgents(data);
    } catch (err) {
      console.error("[DashboardV2] failed to load agents:", err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const myAgents = agents.filter((a) => a.ownerUserId === userId);
  const globalAgents = agents.filter((a) => a.scope === "global");

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-zinc-900">Agents</h2>
        <button
          onClick={() => setShowCreateAgent(true)}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
        >
          + Create Agent
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-zinc-400">Loading agents…</div>
      ) : (
        <>
          {/* My Agents */}
          {myAgents.length > 0 && (
            <section className="mt-8">
              <h3 className="mb-4 text-sm font-semibold text-zinc-500">My Agents</h3>
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(380px, 460px))" }}>
                {myAgents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    userId={userId}
                    onUpdate={load}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Global Agents */}
          {globalAgents.length > 0 && (
            <section>
              <h3 className="mb-4 text-sm font-semibold text-zinc-500">Global Agents</h3>
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(380px, 460px))" }}>
                {globalAgents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    userId={userId}
                    onUpdate={load}
                  />
                ))}
              </div>
            </section>
          )}

          {agents.length === 0 && (
            <div className="rounded-xl border border-dashed border-zinc-300 py-16 text-center">
              <p className="text-sm text-zinc-400">No agents yet. Create your first agent to get started.</p>
            </div>
          )}
        </>
      )}

      {showCreateAgent && (
        <CreateAgentModal
          userId={userId}
          onClose={() => setShowCreateAgent(false)}
          onCreated={() => { setShowCreateAgent(false); load(); }}
        />
      )}
    </div>
  );
}
