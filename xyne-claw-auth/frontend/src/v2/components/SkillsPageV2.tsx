import { useState, useEffect, useCallback } from "react";
import {
  listSkills,
  createSkill,
  deleteSkill,
  submitSkillRequest,
  type Skill,
} from "../../lib/api";
import { ChevronRight, Trash2, Globe } from "lucide-react";

// ── SkillCard ─────────────────────────────────────────────────────────
function SkillCard({
  skill,
  canDelete,
  canRequestGlobal,
  deletingSkill,
  onDelete,
  onRequestGlobal,
}: {
  skill: Skill;
  canDelete: boolean;
  canRequestGlobal: boolean;
  deletingSkill: string | null;
  onDelete: () => void;
  onRequestGlobal?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-2xl bg-zinc-100 overflow-hidden">
      <div
        className="flex cursor-pointer items-start justify-between p-4"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="min-w-0 flex-1 flex items-start gap-2">
          <ChevronRight
            size={14}
            strokeWidth={2}
            className={`mt-0.5 shrink-0 text-zinc-400 transition-transform ${expanded ? "rotate-90" : ""}`}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-zinc-900">
                {skill.label || skill.name}
              </span>
              <span className="text-xs text-zinc-400">{skill.slug}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  skill.scope === "global"
                    ? "bg-green-200 text-green-700"
                    : "bg-zinc-200 text-zinc-600"
                }`}
              >
                {skill.scope}
              </span>
              {skill.source !== "user-created" && (
                <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-600">
                  {skill.source}
                </span>
              )}
            </div>
            {skill.description && (
              <p className="mt-1 text-sm text-zinc-500">{skill.description}</p>
            )}
            {!expanded && (
              <p className="mt-1 text-xs text-zinc-400">{skill.content.length} chars</p>
            )}
          </div>
        </div>

        <div
          className="ml-3 flex shrink-0 items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {canRequestGlobal && onRequestGlobal && (
            <button
              onClick={onRequestGlobal}
              className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700"
              title="Request: Push to Global"
            >
              <Globe size={14} strokeWidth={1.8} />
            </button>
          )}
          {canDelete && (
            <button
              onClick={onDelete}
              disabled={deletingSkill === skill.slug}
              className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-red-100 hover:text-red-500 disabled:opacity-40"
              title="Delete skill"
            >
              <Trash2 size={14} strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-zinc-200 px-4 pb-4 pt-3">
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 font-mono text-xs text-zinc-700 border border-zinc-200">
            {skill.content}
          </pre>
          <p className="mt-2 text-xs text-zinc-400">{skill.content.length} chars</p>
        </div>
      )}
    </div>
  );
}

// ── SkillsPageV2 ──────────────────────────────────────────────────────
interface Props {
  userId: string;
  isAdmin?: boolean;
}

const EMPTY_SKILL = { slug: "", name: "", label: "", description: "", content: "" };

export function SkillsPageV2({ userId, isAdmin }: Props) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newSkill, setNewSkill] = useState(EMPTY_SKILL);
  const [saving, setSaving] = useState(false);
  const [deletingSkill, setDeletingSkill] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSkills(await listSkills(userId));
    } catch (err) {
      console.error("[SkillsV2] failed to load skills:", err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!newSkill.slug || !newSkill.name || !newSkill.content) return;
    setSaving(true);
    try {
      await createSkill(newSkill);
      setShowCreate(false);
      setNewSkill(EMPTY_SKILL);
      load();
    } catch (err) {
      console.error("[SkillsV2] create skill error:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (skill: Skill) => {
    if (!confirm(`Delete skill "${skill.label || skill.name}"?`)) return;
    setDeletingSkill(skill.slug);
    try {
      await deleteSkill(skill.slug);
      load();
    } catch (err) {
      console.error("[SkillsV2] delete skill error:", err);
    } finally {
      setDeletingSkill(null);
    }
  };

  const handleRequestGlobal = async (skill: Skill) => {
    try {
      await submitSkillRequest(skill.slug, userId);
      load();
    } catch (err) {
      console.error("[SkillsV2] skill request error:", err);
    }
  };

  const mySkills = skills.filter((s) => s.ownerUserId === userId);
  const globalSkills = skills.filter((s) => s.scope === "global");

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-zinc-900">Skills</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
        >
          + Create Skill
        </button>
      </div>

      {/* Inline create form */}
      {showCreate && (
        <div className="rounded-2xl bg-zinc-100 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-zinc-900">New Skill</h3>
          <div className="grid grid-cols-2 gap-3">
            <input
              value={newSkill.name}
              onChange={(e) => {
                const name = e.target.value;
                setNewSkill((s) => ({
                  ...s,
                  name,
                  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
                }));
              }}
              placeholder="Skill name"
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none"
            />
            <input
              value={newSkill.slug}
              onChange={(e) => setNewSkill((s) => ({ ...s, slug: e.target.value }))}
              placeholder="slug"
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-500 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none"
            />
          </div>
          <input
            value={newSkill.label}
            onChange={(e) => setNewSkill((s) => ({ ...s, label: e.target.value }))}
            placeholder="Display label (e.g. Code Review Guidelines)"
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none"
          />
          <input
            value={newSkill.description}
            onChange={(e) => setNewSkill((s) => ({ ...s, description: e.target.value }))}
            placeholder="Short description (optional)"
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none"
          />
          <textarea
            value={newSkill.content}
            onChange={(e) => setNewSkill((s) => ({ ...s, content: e.target.value }))}
            rows={5}
            placeholder="Skill content (instructions, knowledge, etc.)"
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={saving || !newSkill.slug || !newSkill.name || !newSkill.content}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40"
            >
              {saving ? "Creating…" : "Create"}
            </button>
            <button
              onClick={() => { setShowCreate(false); setNewSkill(EMPTY_SKILL); }}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-500 transition hover:text-zinc-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-zinc-400">Loading skills…</div>
      ) : skills.length === 0 && !showCreate ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 p-16 text-center">
          <p className="text-sm text-zinc-400">No skills yet. Create one to get started.</p>
        </div>
      ) : (
        <>
          {/* My Skills */}
          {mySkills.length > 0 && (
            <section className="mt-8">
              <h3 className="mb-4 text-sm font-semibold text-zinc-500">My Skills</h3>
              <div className="space-y-3">
                {mySkills.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    canDelete
                    canRequestGlobal={skill.scope !== "global"}
                    deletingSkill={deletingSkill}
                    onDelete={() => handleDelete(skill)}
                    onRequestGlobal={() => handleRequestGlobal(skill)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Global Skills */}
          {globalSkills.length > 0 && (
            <section>
              <h3 className="mb-4 text-sm font-semibold text-zinc-500">Global Skills</h3>
              <div className="space-y-3">
                {globalSkills.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    canDelete={skill.ownerUserId === userId || !!isAdmin}
                    canRequestGlobal={false}
                    deletingSkill={deletingSkill}
                    onDelete={() => handleDelete(skill)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
