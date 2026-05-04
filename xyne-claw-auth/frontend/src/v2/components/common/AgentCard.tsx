import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Agent } from "../../../lib/types";
import { ProviderPopup } from "./ProviderPopup";
import { Toggle } from "./Toggle";

// ── Pill ──────────────────────────────────────────────────────────────
function Pill({ children, green }: { children: React.ReactNode; green?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
        green
          ? "bg-green-200 text-green-700"
          : "bg-zinc-200 text-zinc-600"
      }`}
    >
      {children}
    </span>
  );
}

// ── AgentCard ─────────────────────────────────────────────────────────
interface Props {
  agent: Agent;
  userId: string;
  onUpdate: () => void;
}

export function AgentCard({ agent, userId, onUpdate }: Props) {
  const navigate = useNavigate();
  const [providerOpen, setProviderOpen] = useState(false);

  const letter = agent.name.trim()[0]?.toUpperCase() ?? "A";

  return (
    <div
      className="flex cursor-pointer flex-col min-h-64 rounded-3xl bg-zinc-100 p-5 transition hover:shadow-md overflow-hidden"
      onClick={() => navigate(`/v2/agents/${agent.slug}`)}
    >
      {/* Avatar */}
      <div
        className="mb-5 flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white"
        style={{ backgroundColor: agent.color || "#6366f1" }}
      >
        {letter}
      </div>

      {/* Name + description — flex-1 so toggle is always pushed to bottom */}
      <div className="flex-1">
        <p className="font-semibold text-zinc-900">{agent.name}</p>
        {agent.description && (
          <p className="mt-1 text-sm leading-relaxed text-zinc-500 line-clamp-3">
            {agent.description}
          </p>
        )}
      </div>

      {/* Pills */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        <Pill>{agent.slug}</Pill>
        <Pill>{agent.scope}</Pill>
        <Pill green={!!agent.spacesAppId}>
          {agent.spacesAppId ? "Registered" : "Not registered"}
        </Pill>
      </div>

      {/* Provider — click anywhere in this row to open popup */}
      <div
        className="mt-5 flex cursor-pointer items-center gap-8"
        onClick={(e) => { e.stopPropagation(); setProviderOpen(true); }}
      >
        <span className="text-sm font-medium text-zinc-700">Provider</span>
        <Toggle checked={agent.enabled} onChange={() => setProviderOpen(true)} />
      </div>

      {providerOpen && (
        <ProviderPopup
          agentSlug={agent.slug}
          userId={userId}
          onClose={() => setProviderOpen(false)}
        />
      )}
    </div>
  );
}
