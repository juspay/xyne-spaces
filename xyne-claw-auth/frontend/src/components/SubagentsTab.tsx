import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  listSubagents,
  deleteSubagent,
  enableSubagent,
  type SubagentDef,
} from "../lib/api";

interface SubagentsTabProps {
  userId: string;
  isAdmin: boolean;
}

export function SubagentsTab({ userId, isAdmin }: SubagentsTabProps) {
  const navigate = useNavigate();
  const [items, setItems] = useState<SubagentDef[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listSubagents());
    } catch (err) {
      console.error("[subagents-tab] load error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const remove = async (name: string) => {
    if (!confirm(`Disable subagent "${name}"?`)) return;
    try {
      await deleteSubagent(name);
      await reload();
    } catch (err) {
      console.error("[subagents-tab] delete error:", err);
    }
  };

  const enable = async (name: string) => {
    try {
      await enableSubagent(name);
      await reload();
    } catch (err) {
      console.error("[subagents-tab] enable error:", err);
    }
  };

  if (loading) {
    return <div className="py-10 text-center text-sm text-zinc-400">Loading subagents…</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={() => navigate("/subagents/new")}
          className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 transition hover:bg-white"
        >
          + Create Subagent
        </button>
      </div>

      {items.map((row) => {
        const canEdit = row.source === "custom" && (
          isAdmin
          || row.createdByUserId === userId
          || (row.shares ?? []).some((s) => s.userId === userId && s.role === "EDITOR")
        );
        return (
          <SubagentCard
            key={row.name}
            row={row}
            canEdit={canEdit}
            onDelete={() => remove(row.name)}
            onEnable={() => enable(row.name)}
          />
        );
      })}
    </div>
  );
}

function SubagentCard({
  row, canEdit, onDelete, onEnable,
}: {
  row: SubagentDef;
  canEdit: boolean;
  onDelete: () => void;
  onEnable: () => void;
}) {
  const isBuiltin = row.source === "builtin";
  const badgeClass = isBuiltin
    ? "bg-blue-900 text-blue-200"
    : row.enabled
      ? "bg-emerald-900 text-emerald-200"
      : "bg-zinc-800 text-zinc-400";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold text-zinc-100">{row.name}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${badgeClass}`}>
              {isBuiltin ? "built-in" : row.enabled ? "custom" : "disabled"}
            </span>
            {!isBuiltin && (row.shares?.length ?? 0) > 0 && (
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">
                +{row.shares!.length} contributor{row.shares!.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-zinc-400">{row.description}</p>
          <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-zinc-500">
            {isBuiltin && row.serverType && (
              <span className="rounded bg-zinc-800 px-1.5 py-0.5">serverType: {row.serverType}</span>
            )}
            {!isBuiltin && row.tools?.direct?.length ? (
              <span className="rounded bg-zinc-800 px-1.5 py-0.5">{row.tools.direct.length} direct</span>
            ) : null}
            {!isBuiltin && row.tools?.custom?.length ? (
              <span className="rounded bg-zinc-800 px-1.5 py-0.5">{row.tools.custom.length} custom</span>
            ) : null}
            {row.skills.length > 0 && (
              <span className="rounded bg-zinc-800 px-1.5 py-0.5">
                {row.skills.length} skill{row.skills.length === 1 ? "" : "s"}: {row.skills.map((s) => s.slug).join(", ")}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            to={`/subagents/${encodeURIComponent(row.name)}`}
            className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            {isBuiltin ? "View" : canEdit ? "Edit" : "View"}
          </Link>
          {!isBuiltin && canEdit && (
            row.enabled ? (
              <button onClick={onDelete} className="rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950">
                Disable
              </button>
            ) : (
              <button onClick={onEnable} className="rounded border border-emerald-900 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-950">
                Enable
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
