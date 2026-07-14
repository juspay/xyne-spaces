/**
 * OrganizationsPageV3 — phase-1 org management (org-only).
 *
 * With one-org-per-user this shows the caller's single organization: details +
 * member list. OWNER/ADMIN can add members (existing claw users, by email/id),
 * change a member's role, and remove members. Members see a read-only view.
 *
 * DEFERRED (not here): org creation, invitations/email, workspaces, org delete,
 * ownership transfer. Those arrive in later phases.
 */
import { useCallback, useEffect, useState } from "react";
import { BuildingsIcon, UserPlusIcon, TrashIcon } from "@phosphor-icons/react";

import { PageLayout } from "./ui/PageLayout";
import { Button } from "./ui/Button";
import { TextField } from "./ui/TextField";
import { SelectField } from "./ui/SelectField";
import { Badge } from "./ui/Badge";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { useSnackbar } from "./ui/Snackbar";

import {
  listOrganizations,
  getOrganization,
  addOrgMember,
  updateOrgMemberRole,
  removeOrgMember,
  type OrgDetail,
  type OrgMemberRow,
  type OrgRole,
} from "../../lib/api";

function roleBadgeVariant(role: OrgRole): "info" | "warning" | "neutral" {
  if (role === "OWNER") return "info";
  if (role === "ADMIN") return "warning";
  return "neutral";
}

export function OrganizationsPageV3({ userId }: { userId: string }) {
  const { show } = useSnackbar();

  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [myRole, setMyRole] = useState<OrgRole | null>(null);

  // Add-member form state.
  const [newMember, setNewMember] = useState("");
  const [newRole, setNewRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [adding, setAdding] = useState(false);

  // Remove confirmation.
  const [removeTarget, setRemoveTarget] = useState<OrgMemberRow | null>(null);

  const canManage = myRole === "OWNER" || myRole === "ADMIN";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const orgs = await listOrganizations(userId);
      if (orgs.length === 0) {
        setOrg(null);
        setMyRole(null);
        return;
      }
      const primary = orgs[0]!;
      setMyRole(primary.role);
      const detail = await getOrganization(userId, primary.id);
      setOrg(detail);
    } catch {
      show({ variant: "error", title: "Failed to load organization" });
    } finally {
      setLoading(false);
    }
  }, [userId, show]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd() {
    const raw = newMember.trim();
    if (!raw || !org) return;
    setAdding(true);
    try {
      await addOrgMember(userId, org.id, raw, newRole);
      setNewMember("");
      setNewRole("MEMBER");
      show({ variant: "success", title: `Added ${raw}` });
      await load();
    } catch (e) {
      show({ variant: "error", title: e instanceof Error ? e.message : "Failed to add member" });
    } finally {
      setAdding(false);
    }
  }

  async function handleRoleChange(m: OrgMemberRow, role: OrgRole) {
    if (!org || role === m.role) return;
    try {
      await updateOrgMemberRole(userId, org.id, m.userId, role);
      show({ variant: "success", title: `${m.email} is now ${role}` });
      await load();
    } catch (e) {
      show({ variant: "error", title: e instanceof Error ? e.message : "Failed to change role" });
    }
  }

  async function handleRemove() {
    if (!org || !removeTarget) return;
    const target = removeTarget;
    setRemoveTarget(null);
    try {
      await removeOrgMember(userId, org.id, target.userId);
      show({ variant: "success", title: `Removed ${target.email}` });
      await load();
    } catch (e) {
      show({ variant: "error", title: e instanceof Error ? e.message : "Failed to remove member" });
    }
  }

  return (
    <>
      <PageLayout
        header={
          <div className="shrink-0 border-b border-xyne-border-subtle">
            <div className="mx-auto w-full max-w-[880px] px-[20px] py-xyne-header">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex shrink-0 items-center justify-center">
                  <BuildingsIcon size={22} weight="regular" className="text-xyne-fg-secondary" />
                </span>
                <div>
                  <h1 className="text-xl font-semibold text-xyne-fg-primary">
                    {org ? org.name : "Organization"}
                  </h1>
                  <p className="mt-1 text-[14px] text-xyne-fg-muted">
                    {org?.description || "Manage your organization and its members"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        }
        body={
        <div className="mx-auto w-full max-w-[880px] px-[20px] py-6">
          {loading ? (
            <p className="text-[13px] text-xyne-fg-secondary">Loading…</p>
          ) : !org ? (
            <p className="text-[13px] text-xyne-fg-secondary">
              You are not part of any organization yet.
            </p>
          ) : (
            <>
              {/* Add member (admins only) */}
              {canManage && (
                <div className="mb-6 rounded-lg border border-xyne-border-subtle p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <UserPlusIcon size={16} className="text-xyne-fg-secondary" />
                    <span className="text-[13px] font-semibold text-xyne-fg-primary">Add member</span>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-[260px] flex-1">
                      <TextField
                        label="User email or id"
                        placeholder="john.doe@gmail.com"
                        value={newMember}
                        onChange={(e) => setNewMember(e.target.value)}
                      />
                    </div>
                    <div className="w-[160px]">
                      <SelectField
                        label="Role"
                        value={newRole}
                        options={[
                          { value: "MEMBER", label: "Member" },
                          { value: "ADMIN", label: "Admin" },
                        ]}
                        onValueChange={(v) => setNewRole(v === "ADMIN" ? "ADMIN" : "MEMBER")}
                      />
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={adding || !newMember.trim()}
                      onClick={handleAdd}
                    >
                      {adding ? "Adding…" : "Add"}
                    </Button>
                  </div>
                  <p className="mt-2 text-[12px] text-xyne-fg-muted">
                    The user must already have signed in to Claw. Invitations by email arrive in a later phase.
                  </p>
                </div>
              )}

              {/* Member list */}
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-xyne-fg-primary">
                  Members ({org.members.length})
                </span>
              </div>
              <div className="divide-y divide-xyne-border-subtle rounded-lg border border-xyne-border-subtle">
                {org.members.map((m) => (
                  <div key={m.userId} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-xyne-fg-primary">
                        {m.name || m.email}
                      </div>
                      <div className="truncate text-[12px] text-xyne-fg-muted">{m.email}</div>
                    </div>
                    {canManage ? (
                      <div className="w-[150px]">
                        <SelectField
                          value={m.role}
                          options={[
                            { value: "OWNER", label: "Owner" },
                            { value: "ADMIN", label: "Admin" },
                            { value: "MEMBER", label: "Member" },
                          ]}
                          onValueChange={(v) => v && handleRoleChange(m, v as OrgRole)}
                        />
                      </div>
                    ) : (
                      <Badge as="span" variant={roleBadgeVariant(m.role)} label={m.role} />
                    )}
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${m.email}`}
                        onClick={() => setRemoveTarget(m)}
                      >
                        <TrashIcon size={16} />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        }
      />

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(o) => { if (!o) setRemoveTarget(null); }}
        title="Remove member"
        description={
          removeTarget
            ? `Remove ${removeTarget.email} from ${org?.name ?? "the organization"}?`
            : ""
        }
        confirmLabel="Remove"
        danger
        onConfirm={handleRemove}
      />
    </>
  );
}
