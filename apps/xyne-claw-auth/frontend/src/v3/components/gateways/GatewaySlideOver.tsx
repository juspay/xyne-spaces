import { useState, useEffect } from "react";
import { LockIcon, TrashIcon, Plus, ArrowRight } from "@phosphor-icons/react";
import { SidePanel } from "../ui/SidePanel";
import { Button } from "../ui/Button";
import { Tabs } from "../ui/Tabs";
import { Skeleton } from "../ui/Skeleton";
import { useSnackbar } from "../ui/Snackbar";
import { Avatar } from "../ui/Avatar";
import { Dialog } from "../ui/Dialog";
import { listIdentities, linkIdentity, unlinkIdentity } from "../../../lib/api";
import type { Gateway, GatewayIdentity } from "../../../lib/types";

interface GatewaySlideOverProps {
  gateway: Gateway | null;
  onClose: () => void;
  onDeleteRequest: (gateway: Gateway) => void;
}

export function GatewaySlideOver({ gateway, onClose, onDeleteRequest }: GatewaySlideOverProps) {
  const [activeTab, setActiveTab] = useState<"details" | "identities">("details");

  useEffect(() => {
    setActiveTab("details");
  }, [gateway?.id]);

  if (!gateway) return null;

  const footer =
    gateway.type !== "xyne-spaces" ? (
      <Button
        variant="ghost"
        className="text-xyne-error-fg hover:bg-xyne-error-bg"
        onClick={() => onDeleteRequest(gateway)}
      >
        <TrashIcon size={14} />
        Delete gateway
      </Button>
    ) : undefined;

  return (
    <SidePanel
      onClose={onClose}
      icon={
        <Avatar
          name={gateway.name}
          size={40}
          shape="circle"
          className="!bg-xyne-surface-sunken !text-xyne-fg-secondary border border-xyne-border"
        />
      }
      title={gateway.name}
      footer={footer}
      width={520}
      floating
    >
      {/* Type and status badges */}
      <div className="flex items-center gap-[6px] mb-[16px]">
        <span className="rounded bg-xyne-surface-sunken px-[6px] py-[1px] text-[11px] font-mono text-xyne-fg-tertiary">
          {gateway.type}
        </span>
        {gateway.enabled ? (
          <span className="inline-flex items-center gap-[4px] text-[11px] font-medium px-[8px] py-[2px] rounded-full bg-xyne-success-bg text-xyne-success-fg border border-xyne-success-fg/20">
            <div className="w-[5px] h-[5px] rounded-full bg-xyne-success-fg" />
            Enabled
          </span>
        ) : (
          <span className="inline-flex items-center gap-[4px] text-[11px] font-medium px-[8px] py-[2px] rounded-full bg-xyne-warning-bg text-xyne-warning-fg border border-xyne-warning-fg/20">
            <div className="w-[5px] h-[5px] rounded-full bg-xyne-warning-fg" />
            Disabled
          </span>
        )}
        <span className="text-[11px] text-xyne-fg-tertiary">read-only</span>
      </div>

      {/* xyne-spaces banner */}
      {gateway.type === "xyne-spaces" && (
        <div className="flex items-center gap-[8px] px-[16px] py-[8px] bg-xyne-surface border-b border-xyne-border flex-shrink-0">
          <LockIcon size={13} className="text-xyne-fg-tertiary flex-shrink-0" />
          <span className="text-[12px] text-xyne-fg-secondary">
            System gateway — cannot be deleted
          </span>
        </div>
      )}

      {/* Tabs */}
      <Tabs
        items={[
          { id: "details", label: "Details" },
          { id: "identities", label: "Identities" },
        ]}
        selected={activeTab}
        onSelect={(id) => setActiveTab(id as "details" | "identities")}
      />

      {/* Tab content */}
      <div className="mt-[16px]">
        {activeTab === "details" ? (
          <DetailsTab gateway={gateway} />
        ) : (
          <IdentitiesTab gateway={gateway} />
        )}
      </div>
    </SidePanel>
  );
}

function DetailsTab({ gateway }: { gateway: Gateway }) {
  return (
    <div className="flex flex-col">
      <DetailRow label="Type">
        <span className="text-[12px] font-mono text-xyne-fg-primary">{gateway.type}</span>
      </DetailRow>

      <DetailRow label="Status">
        <div className="flex flex-col gap-[3px]">
          {gateway.enabled ? (
            <span className="inline-flex items-center gap-[4px] text-[12px] font-medium text-xyne-success-fg">
              <div className="w-[6px] h-[6px] rounded-full bg-xyne-success-fg" />
              Enabled
            </span>
          ) : (
            <span className="inline-flex items-center gap-[4px] text-[12px] font-medium text-xyne-warning-fg">
              <div className="w-[6px] h-[6px] rounded-full bg-xyne-warning-fg" />
              Disabled
            </span>
          )}
          <span className="text-[11px] text-xyne-fg-tertiary">
            {gateway.type === "xyne-spaces"
              ? "Toggle not supported for this gateway"
              : "Enable/disable not yet supported"}
          </span>
        </div>
      </DetailRow>

      <DetailRow label="Created">
        <span className="text-[12px] text-xyne-fg-primary">
          {new Date(gateway.createdAt).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </span>
      </DetailRow>

      <DetailRow label="Configuration">
        <div className="flex flex-col gap-[3px]">
          {Object.keys(gateway.config ?? {}).length === 0 ? (
            <span className="text-[12px] italic text-xyne-fg-muted">No configuration</span>
          ) : (
            <div className="bg-xyne-surface-sunken rounded-[6px] p-[8px]">
              <pre className="text-[11px] font-mono text-xyne-fg-secondary whitespace-pre-wrap overflow-auto">
                {JSON.stringify(gateway.config, null, 2)}
              </pre>
            </div>
          )}
          <span className="text-[11px] text-xyne-fg-tertiary">
            Configuration editing not supported
          </span>
        </div>
      </DetailRow>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-[12px] py-[10px] border-b border-xyne-border last:border-b-0">
      <span className="text-[11px] text-xyne-fg-tertiary w-[90px] flex-shrink-0 pt-[1px] font-medium">
        {label}
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function IdentitiesTab({ gateway }: { gateway: Gateway }) {
  const { show: showSnackbar } = useSnackbar();
  const [identities, setIdentities] = useState<GatewayIdentity[]>([]);
  const [identitiesLoading, setIdentitiesLoading] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [externalUserId, setExternalUserId] = useState("");
  const [xyneUserId, setXyneUserId] = useState("");
  const [linking, setLinking] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  useEffect(() => {
    setIdentitiesLoading(true);
    listIdentities(gateway.id)
      .then(setIdentities)
      .catch(() => {})
      .finally(() => setIdentitiesLoading(false));
  }, [gateway.id]);

  useEffect(() => {
    if (!showLinkModal) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowLinkModal(false);
        setExternalUserId("");
        setXyneUserId("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showLinkModal]);

  const handleLink = async () => {
    if (!gateway || !externalUserId.trim() || !xyneUserId.trim()) return;
    setLinking(true);
    try {
      await linkIdentity(gateway.id, {
        externalUserId: externalUserId.trim(),
        userId: xyneUserId.trim(),
      });
      showSnackbar({ variant: "success", title: "Identity linked" });
      setExternalUserId("");
      setXyneUserId("");
      setShowLinkModal(false);
      const updated = await listIdentities(gateway.id);
      setIdentities(updated);
    } catch {
      showSnackbar({ variant: "error", title: "Failed to link identity" });
    } finally {
      setLinking(false);
    }
  };

  const handleUnlink = async (identity: GatewayIdentity) => {
    if (!gateway) return;
    setUnlinkingId(identity.id);
    try {
      await unlinkIdentity(gateway.id, identity.id);
      setIdentities((prev) => prev.filter((i) => i.id !== identity.id));
      showSnackbar({ variant: "success", title: "Identity unlinked" });
    } catch {
      showSnackbar({ variant: "error", title: "Failed to unlink identity" });
    } finally {
      setUnlinkingId(null);
    }
  };

  const closeModal = () => {
    setShowLinkModal(false);
    setExternalUserId("");
    setXyneUserId("");
  };

  return (
    <div>
      {identitiesLoading ? (
        <div className="flex flex-col gap-[6px]">
          <Skeleton className="h-[40px] rounded-lg" />
          <Skeleton className="h-[40px] rounded-lg" />
          <Skeleton className="h-[40px] rounded-lg" />
        </div>
      ) : identities.length === 0 ? (
        <div className="flex flex-col gap-[10px] py-[24px] px-[16px]">
          <div className="w-[40px] h-[40px] rounded-full bg-xyne-surface-sunken border border-xyne-border flex items-center justify-center text-[18px]">
            👤
          </div>
          <div>
            <p className="text-[13px] font-medium text-xyne-fg-primary mb-[4px]">
              No linked users yet
            </p>
            <p className="text-[12px] text-xyne-fg-secondary leading-[1.6]">
              Link external user IDs to Xyne Spaces accounts so agents can identify callers from this gateway
            </p>
          </div>
          <button
            onClick={() => setShowLinkModal(true)}
            className="mt-[4px] self-start flex items-center gap-[5px] bg-xyne-fg-primary text-xyne-fg-inverse px-[14px] py-[7px] rounded-[7px] text-[12px] font-medium border-0 cursor-pointer hover:opacity-90 transition-opacity font-sans"
          >
            <Plus size={13} weight="bold" />
            Link your first user
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between px-[16px] py-[10px] border-b border-xyne-border flex-shrink-0">
            <div>
              <div className="text-[13px] font-medium text-xyne-fg-primary">
                Linked users
              </div>
              <div className="text-[11px] text-xyne-fg-tertiary mt-[1px]">
                {identities.length} identit{identities.length !== 1 ? "ies" : "y"} configured
              </div>
            </div>
            <button
              onClick={() => setShowLinkModal(true)}
              className="flex items-center gap-[5px] bg-xyne-fg-primary text-xyne-fg-inverse px-[12px] py-[6px] rounded-[7px] text-[12px] font-medium border-0 cursor-pointer hover:opacity-90 font-sans"
            >
              <Plus size={12} weight="bold" />
              Link user
            </button>
          </div>

          {identities.map((identity) => (
            <div
              key={identity.id}
              className="flex items-center gap-[10px] px-[16px] py-[10px] border-b border-xyne-border last:border-b-0"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-mono text-xyne-fg-primary truncate">
                  {identity.externalUserId}
                </div>
                <div className="text-[11px] text-xyne-fg-tertiary mt-[1px] flex items-center gap-[4px]">
                  <ArrowRight size={10} />
                  {identity.userId}
                </div>
              </div>
              <button
                disabled={unlinkingId === identity.id}
                onClick={() => handleUnlink(identity)}
                className="text-[11px] text-xyne-error-fg hover:underline flex-shrink-0 disabled:opacity-50 bg-transparent border-0 cursor-pointer font-sans"
              >
                {unlinkingId === identity.id ? "Removing…" : "Unlink"}
              </button>
            </div>
          ))}
        </>
      )}

      <Dialog
        open={showLinkModal}
        onOpenChange={(open) => {
          setShowLinkModal(open);
          if (!open) {
            setExternalUserId("");
            setXyneUserId("");
          }
        }}
        title="Link an identity"
        description="Map an external user ID from this gateway to a Xyne Spaces account"
        maxWidth={400}
        footer={
          <div className="flex gap-[8px] w-full">
            <button
              onClick={closeModal}
              className="px-[14px] py-[8px] rounded-[7px] border border-xyne-border text-[13px] text-xyne-fg-secondary bg-transparent cursor-pointer hover:bg-xyne-surface-sunken font-sans"
            >
              Cancel
            </button>
            <button
              onClick={handleLink}
              disabled={!externalUserId.trim() || !xyneUserId.trim() || linking}
              className="flex-1 py-[8px] rounded-[7px] bg-xyne-fg-primary text-xyne-fg-inverse text-[13px] font-medium border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity font-sans"
            >
              {linking ? "Linking…" : "Link identity"}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-[12px]">
          <div>
            <label className="text-[11px] font-medium text-xyne-fg-secondary mb-[5px] block">
              External user ID
            </label>
            <input
              value={externalUserId}
              onChange={(e) => setExternalUserId(e.target.value)}
              placeholder="e.g. U04ABC123"
              className="w-full text-[12px] bg-xyne-surface-sunken border border-xyne-border rounded-[7px] px-[10px] py-[7px] text-xyne-fg-primary placeholder:text-xyne-fg-tertiary focus:outline-none focus:border-xyne-brand transition-colors"
            />
            <p className="text-[10px] text-xyne-fg-tertiary mt-[4px] leading-[1.4]">
              The user ID from the external system (e.g. Slack, Teams)
            </p>
          </div>
          <div>
            <label className="text-[11px] font-medium text-xyne-fg-secondary mb-[5px] block">
              Xyne Spaces user ID
            </label>
            <input
              value={xyneUserId}
              onChange={(e) => setXyneUserId(e.target.value)}
              placeholder="Internal user ID"
              className="w-full text-[12px] bg-xyne-surface-sunken border border-xyne-border rounded-[7px] px-[10px] py-[7px] text-xyne-fg-primary placeholder:text-xyne-fg-tertiary focus:outline-none focus:border-xyne-brand transition-colors"
            />
            <p className="text-[10px] text-xyne-fg-tertiary mt-[4px] leading-[1.4]">
              The internal Xyne Spaces account to map to
            </p>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
