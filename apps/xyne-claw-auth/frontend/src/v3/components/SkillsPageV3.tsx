import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  PlusIcon,
  MagnifyingGlassIcon,
  WrenchIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { PageListHeader } from "./ui/PageListHeader";
import { PageLayout } from "./ui/PageLayout";
import { Button } from "./ui/Button";
import { Skeleton } from "./ui/Skeleton";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { useSnackbar } from "./ui/Snackbar";
import { SkillRow } from "./skills/SkillRow";
import { SkillSlideOver } from "./skills/SkillSlideOver";
import { CreateSkillDialog } from "./dialogs/CreateSkillDialog";
import { useSkills } from "../hooks/useSkills";
import { useAuth } from "../../hooks/useAuth";
import { updateSkill, deleteSkill } from "../../lib/api";
import type { Skill } from "../../lib/api";

/* ── Scope tabs ──────────────────────────────────────────────────────── */

const SCOPE_TAB_LABELS = ["All", "Mine", "Global"] as const;
type ScopeTabLabel = (typeof SCOPE_TAB_LABELS)[number];

function labelToScope(label: ScopeTabLabel): string {
  switch (label) {
    case "Mine":
      return "mine";
    case "Global":
      return "global";
    default:
      return "all";
  }
}

function scopeToLabel(scope: string): ScopeTabLabel {
  switch (scope) {
    case "mine":
      return "Mine";
    case "global":
      return "Global";
    default:
      return "All";
  }
}

/* ── Skeleton ────────────────────────────────────────────────────────── */

function SkillsSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-[12px] rounded-xl border border-xyne-border bg-xyne-surface px-[14px] py-[10px]"
        >
          <Skeleton className="h-[6px] w-[6px] rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-12" />
          <Skeleton className="h-4 w-4" />
        </div>
      ))}
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────────── */

interface SkillsPageV3Props {
  /**
   * When true, admin users can manage (toggle/edit/delete) any
   * **global-scope** skill they don't own — matches V1 DashboardPage's
   * `canManage = isOwner || isAdmin` on global skill cards.
   */
  isAdmin?: boolean;
}

export function SkillsPageV3({ isAdmin = false }: SkillsPageV3Props = {}) {
  const auth = useAuth();
  const userId =
    auth.status === "authenticated" ? auth.user.id : "";
  const { skills, agentsBySkill, loading, error, reload } =
    useSkills(userId);
  const { show: showSnackbar } = useSnackbar();

  const [searchParams, setSearchParams] = useSearchParams();
  const searchQuery = searchParams.get("q") ?? "";
  const [inputValue, setInputValue] = useState(searchQuery);

  const scopeParam = searchParams.get("scope") ?? "all";
  const activeScope =
    scopeParam === "mine" || scopeParam === "global"
      ? scopeParam
      : "all";
  const activeTabLabel = scopeToLabel(activeScope);

  // Track only the slug of the currently-selected skill, then derive
  // the live `Skill` object from the `skills` array each render. The
  // earlier approach (`useState<Skill | null>`) cached a snapshot
  // taken at click-time and never refreshed after the list reloaded
  // — that caused the slide-over's `enabled` to drift from the
  // list-row toggle's state. Tracking the slug keeps them in sync.
  const [selectedSlug, setSelectedSlug] =
    useState<string | null>(null);
  const selectedSkill =
    selectedSlug == null
      ? null
      : skills.find((s) => s.slug === selectedSlug) ?? null;
  const [showCreateDialog, setShowCreateDialog] =
    useState(false);
  const [deleteTarget, setDeleteTarget] =
    useState<Skill | null>(null);
  const [togglingSlug, setTogglingSlug] = useState<
    string | null
  >(null);

  /* Sync URL search → input */
  useEffect(() => {
    setInputValue(searchQuery);
  }, [searchQuery]);

  /* Debounced input → URL */
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (inputValue) next.set("q", inputValue);
          else next.delete("q");
          return next;
        },
        { replace: true },
      );
    }, 150);
    return () => clearTimeout(timer);
  }, [inputValue, setSearchParams]);

  const handleScopeChange = (label: ScopeTabLabel) => {
    const scope = labelToScope(label);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (scope === "all") next.delete("scope");
        else next.set("scope", scope);
        return next;
      },
      { replace: true },
    );
  };

  const handleToggle = async (
    skill: Skill,
    value: boolean,
  ) => {
    setTogglingSlug(skill.slug);
    try {
      await updateSkill(skill.slug, { enabled: value });
      showSnackbar({
        variant: "success",
        title: value
          ? `${skill.name || skill.slug} enabled`
          : `${skill.name || skill.slug} disabled`,
      });
      reload();
    } catch (err) {
      const status = (err as { status?: number })?.status;
      showSnackbar({
        variant: "error",
        title:
          status === 403
            ? "Only the owner can modify this skill"
            : "Failed to update skill",
      });
    } finally {
      setTogglingSlug(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteSkill(deleteTarget.slug);
      setDeleteTarget(null);
      setSelectedSlug(null);
      showSnackbar({
        variant: "success",
        title: `${deleteTarget.name || deleteTarget.slug} deleted`,
      });
      reload();
    } catch {
      showSnackbar({
        variant: "error",
        title: "Failed to delete skill",
      });
    }
  };

  /* Filtering */
  const matchesSearch = (skill: Skill) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      skill.name?.toLowerCase().includes(q) ||
      skill.slug.toLowerCase().includes(q) ||
      skill.description?.toLowerCase().includes(q)
    );
  };

  const sortByUsage = (a: Skill, b: Skill) => {
    const aCount = agentsBySkill[a.id]?.length ?? 0;
    const bCount = agentsBySkill[b.id]?.length ?? 0;
    return bCount - aCount;
  };

  /**
   * Whether the current user can manage (toggle/edit/delete) this skill.
   * Owners always can; admins additionally can on **global-scope** skills.
   * Mirrors V1 DashboardPage's `canManage = isOwner || isAdmin` rule, which
   * V1 only applied to the Global Skills section.
   */
  const canManage = (skill: Skill): boolean =>
    skill.ownerUserId === userId || (isAdmin && skill.scope === "global");

  const mySkills = skills
    .filter(
      (s) => s.ownerUserId === userId && matchesSearch(s),
    )
    .sort(sortByUsage);

  const globalSkills = skills
    .filter(
      (s) => s.ownerUserId !== userId && matchesSearch(s),
    )
    .sort(sortByUsage);

  /* Stats */
  const totalSkills = skills.length;
  const myCount = skills.filter(
    (s) => s.ownerUserId === userId,
  ).length;
  const globalCount = skills.filter(
    (s) => s.ownerUserId !== userId,
  ).length;
  const unusedCount = skills.filter(
    (s) => (agentsBySkill[s.id]?.length ?? 0) === 0,
  ).length;

  /* Empty states */
  const hasNoResults =
    mySkills.length === 0 &&
    globalSkills.length === 0 &&
    searchQuery.trim();

  const fullEmpty = skills.length === 0 && !loading;

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageLayout
          header={
            <PageListHeader
              title="Skills"
              subtitle="Markdown playbooks your agents consult while working — runbooks, guidelines, reference material."
              icon={<WrenchIcon size={18} />}
              stats={[
                { value: loading ? undefined : totalSkills, label: "Total" },
                { value: loading ? undefined : skills.filter((s) => s.enabled).length, label: "Active", highlight: "success" as const },
                { value: loading ? undefined : myCount, label: "Personal" },
                { value: loading ? undefined : unusedCount, label: "Unused", highlight: unusedCount > 0 ? "warning" : null },
              ]}
              createLabel="New skill"
              onCreateClick={() => setShowCreateDialog(true)}
              searchValue={inputValue}
              onSearchChange={setInputValue}
              searchPlaceholder="Search skills…"
              tabs={[
                { key: "all", label: "All" },
                { key: "mine", label: "Mine" },
                { key: "global", label: "Global" },
              ]}
              activeTab={activeScope}
              onTabChange={(key) => handleScopeChange(scopeToLabel(key))}
              loading={loading}
            />
          }
          body={
            <div className="flex flex-col gap-4 py-4 px-[20px] max-w-[1024px] mx-auto w-full">
              {loading ? (
                <SkillsSkeleton />
              ) : error ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16">
                  <WarningCircleIcon
                    size={32}
                    className="text-xyne-error-fg"
                  />
                  <p className="text-[14px] text-xyne-fg-muted">
                    {error}
                  </p>
                  <Button variant="secondary" onClick={reload}>
                    Retry
                  </Button>
                </div>
              ) : fullEmpty ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16">
                  <WrenchIcon
                    size={48}
                    className="text-xyne-fg-muted"
                  />
                  <p className="text-[14px] text-xyne-fg-muted">
                    No skills yet
                  </p>
                  <p className="text-[13px] text-xyne-fg-secondary">
                    Create your first skill to enhance your
                    agents
                  </p>
                  <Button
                    variant="primary"
                    onClick={() => setShowCreateDialog(true)}
                  >
                    + Create skill
                  </Button>
                </div>
              ) : hasNoResults ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16">
                  <MagnifyingGlassIcon
                    size={32}
                    className="text-xyne-fg-muted"
                  />
                  <p className="text-[14px] text-xyne-fg-muted">
                    No skills match &ldquo;{searchQuery}
                    &rdquo;
                  </p>
                  <button
                    onClick={() => {
                      setInputValue("");
                      setSearchParams(
                        (prev) => {
                          const next = new URLSearchParams(
                            prev,
                          );
                          next.delete("q");
                          return next;
                        },
                        { replace: true },
                      );
                    }}
                    className="text-[13px] text-xyne-brand hover:underline"
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                <>
                  {/* My Skills */}
                  {activeScope !== "global" && (
                    <div>
                      <div className="mb-[10px] mt-[4px] flex items-baseline gap-[8px]">
                        <span className="text-[13px] font-medium text-xyne-fg-primary">
                          My skills
                        </span>
                        <span className="text-[12px] text-xyne-fg-tertiary">
                          · {mySkills.length}
                        </span>
                        <span className="ml-[4px] text-[11px] text-xyne-fg-tertiary">
                          Skills you own and can edit
                        </span>
                      </div>
                      {mySkills.length === 0 &&
                      activeScope === "mine" ? (
                        <div className="flex flex-col items-center justify-center gap-[8px] py-[40px]">
                          <p className="text-[13px] text-xyne-fg-secondary">
                            No personal skills yet
                          </p>
                          <Button
                            variant="secondary"
                            onClick={() =>
                              setShowCreateDialog(true)
                            }
                          >
                            + Create a skill
                          </Button>
                        </div>
                      ) : (
                        mySkills.map((skill) => (
                          <SkillRow
                            key={skill.id}
                            skill={skill}
                            showScopeBadge={
                              activeScope === "all"
                            }
                            isOwner={canManage(skill)}
                            onSelect={(s) => setSelectedSlug(s.slug)}
                            onToggleEnabled={handleToggle}
                            toggling={
                              togglingSlug === skill.slug
                            }
                          />
                        ))
                      )}
                    </div>
                  )}

                  {/* Global Skills */}
                  {activeScope !== "mine" && (
                    <div>
                      <div className="mb-[10px] mt-[4px] flex items-baseline gap-[8px]">
                        <span className="text-[13px] font-medium text-xyne-fg-primary">
                          Global skills
                        </span>
                        <span className="text-[12px] text-xyne-fg-tertiary">
                          · {globalSkills.length}
                        </span>
                        <span className="ml-[4px] text-[11px] text-xyne-fg-tertiary">
                          Shared across the workspace
                        </span>
                      </div>
                      {globalSkills.length === 0 &&
                      activeScope === "global" ? (
                        <div className="flex flex-col items-center justify-center py-[40px]">
                          <p className="text-[13px] text-xyne-fg-secondary">
                            No global skills available
                          </p>
                        </div>
                      ) : (
                        globalSkills.map((skill) => (
                          <SkillRow
                            key={skill.id}
                            skill={skill}
                            showScopeBadge={
                              activeScope === "all"
                            }
                            isOwner={canManage(skill)}
                            onSelect={(s) => setSelectedSlug(s.slug)}
                            onToggleEnabled={handleToggle}
                            toggling={
                              togglingSlug === skill.slug
                            }
                          />
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          }
        />
      </div>

      {/* Slide-over — wrapped in a tinted tray so the floating panel reads
          as a lifted card against a soft gray strip (matches the agent /
          MCP / subagent slide-over treatment). */}
      {selectedSkill && (
        <div className="h-full bg-xyne-surface-sunken border-l border-xyne-border-subtle">
        <SkillSlideOver
          skill={selectedSkill}
          userId={userId}
          isAdmin={isAdmin}
          onClose={() => setSelectedSlug(null)}
          onUpdated={() => {
            reload();
          }}
          onDeleted={() => {
            setSelectedSlug(null);
            reload();
          }}
          onDeleteRequest={setDeleteTarget}
        />
        </div>
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete skill"
        description={`Delete "$
          {deleteTarget?.name || deleteTarget?.slug}
        "? This cannot be undone. Agents using this
        skill will lose access to it.`}
        danger
        confirmLabel="Delete"
        onConfirm={handleDelete}
      />

      {/* Create dialog */}
      <CreateSkillDialog
        open={showCreateDialog}
        onOpenChange={(open) => setShowCreateDialog(open)}
        onCreated={() => {
          setShowCreateDialog(false);
          reload();
        }}
      />
    </div>
  );
}
