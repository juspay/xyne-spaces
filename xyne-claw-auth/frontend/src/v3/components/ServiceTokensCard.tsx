import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckIcon, CopyIcon, KeyIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";

import {
  listOrgServiceTokens,
  mintOrgServiceToken,
  revokeOrgServiceToken,
  type MintedServiceAccessToken,
  type OrgDetail,
  type ServiceAccessToken,
} from "../../lib/api";
import { Button } from "./ui/Button";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { Dialog } from "./ui/Dialog";
import { SelectField } from "./ui/SelectField";
import { TextField } from "./ui/TextField";
import { useSnackbar } from "./ui/Snackbar";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

export function ServiceTokensCard({ userId, org }: { userId: string; org: OrgDetail }) {
  const { show } = useSnackbar();
  const [tokens, setTokens] = useState<ServiceAccessToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [mintOpen, setMintOpen] = useState(false);
  const [name, setName] = useState("");
  const [boundUserId, setBoundUserId] = useState(org.members[0]?.userId ?? "");
  const [expiry, setExpiry] = useState("");
  const [minting, setMinting] = useState(false);
  const [minted, setMinted] = useState<MintedServiceAccessToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ServiceAccessToken | null>(null);

  const memberOptions = useMemo(() => org.members.map((member) => ({
    value: member.userId,
    label: member.name ? `${member.name} (${member.email})` : member.email,
  })), [org.members]);
  const memberById = useMemo(() => new Map(org.members.map((member) => [member.userId, member])), [org.members]);

  const loadTokens = useCallback(async () => {
    setLoading(true);
    try {
      setTokens(await listOrgServiceTokens(userId, org.id));
    } catch (error) {
      show({ variant: "error", title: error instanceof Error ? error.message : "Failed to load service tokens" });
    } finally {
      setLoading(false);
    }
  }, [org.id, show, userId]);

  useEffect(() => { void loadTokens(); }, [loadTokens]);

  function closeMintDialog() {
    setMintOpen(false);
    setMinted(null);
    setCopied(false);
    setName("");
    setExpiry("");
  }

  async function handleMint() {
    if (!name.trim() || !boundUserId) return;
    setMinting(true);
    try {
      const result = await mintOrgServiceToken(userId, org.id, {
        name: name.trim(),
        userId: boundUserId,
        expiresAt: expiry ? new Date(expiry).toISOString() : null,
      });
      setMinted(result);
      await loadTokens();
    } catch (error) {
      show({ variant: "error", title: error instanceof Error ? error.message : "Failed to mint service token" });
    } finally {
      setMinting(false);
    }
  }

  async function handleCopy() {
    if (!minted) return;
    await navigator.clipboard.writeText(minted.token);
    setCopied(true);
    show({ variant: "success", title: "Service token copied" });
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    const target = revokeTarget;
    setRevokeTarget(null);
    try {
      await revokeOrgServiceToken(userId, org.id, target.id);
      show({ variant: "success", title: `Revoked ${target.name ?? target.prefix}` });
      await loadTokens();
    } catch (error) {
      show({ variant: "error", title: error instanceof Error ? error.message : "Failed to revoke service token" });
    }
  }

  return (
    <>
      <section className="mt-6 rounded-lg border border-xyne-border-subtle p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-2">
            <KeyIcon size={17} className="mt-0.5 shrink-0 text-xyne-fg-secondary" />
            <div>
              <h2 className="text-[13px] font-semibold text-xyne-fg-primary">Service tokens</h2>
              <p className="mt-1 text-[12px] text-xyne-fg-muted">
                Long-lived, revocable credentials for servers calling the Claw API.
              </p>
            </div>
          </div>
          <Button variant="primary" size="sm" leadingIcon={<PlusIcon size={14} />} onClick={() => setMintOpen(true)}>
            New token
          </Button>
        </div>

        <div className="mt-4 divide-y divide-xyne-border-subtle rounded-lg border border-xyne-border-subtle">
          {loading ? (
            <p className="px-4 py-3 text-[13px] text-xyne-fg-muted">Loading…</p>
          ) : tokens.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-xyne-fg-muted">No service tokens yet.</p>
          ) : tokens.map((token) => {
            const member = memberById.get(token.userId);
            const inactive = Boolean(token.revokedAt) || Boolean(token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now());
            return (
              <div key={token.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-xyne-fg-primary">{token.name || "Unnamed token"}</span>
                    <code className="text-[11px] text-xyne-fg-muted">{token.prefix}…</code>
                    {inactive && <span className="text-[11px] font-medium text-xyne-error-fg">{token.revokedAt ? "Revoked" : "Expired"}</span>}
                  </div>
                  <div className="mt-1 text-[11px] text-xyne-fg-muted">
                    Runs as {member?.name || member?.email || token.userId} · Last used {formatDate(token.lastUsedAt)} · Expires {formatDate(token.expiresAt)}
                  </div>
                </div>
                {!token.revokedAt && (
                  <Button variant="ghost" size="icon" aria-label={`Revoke ${token.name ?? token.prefix}`} onClick={() => setRevokeTarget(token)}>
                    <TrashIcon size={15} />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <Dialog
        open={mintOpen}
        onOpenChange={(open) => { if (!open) closeMintDialog(); else setMintOpen(true); }}
        title={minted ? "Copy your service token" : "Create service token"}
        description={minted ? "This secret is shown only once." : "Bind this credential to an organization member."}
        footer={minted ? (
          <Button variant="primary" onClick={closeMintDialog}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={closeMintDialog}>Cancel</Button>
            <Button variant="primary" disabled={minting || !name.trim() || name.trim().length > 60 || !boundUserId} onClick={handleMint}>
              {minting ? "Creating…" : "Create token"}
            </Button>
          </>
        )}
      >
        {minted ? (
          <div>
            <div className="flex items-center gap-2 rounded-lg border border-xyne-border bg-xyne-surface-subtle p-3">
              <code className="min-w-0 flex-1 break-all text-[12px] text-xyne-fg-primary">{minted.token}</code>
              <Button variant="secondary" size="sm" leadingIcon={copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />} onClick={() => void handleCopy()}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="mt-3 text-[12px] font-medium text-xyne-error-fg">You won’t see this token again. Store it securely before closing.</p>
          </div>
        ) : (
          <>
            <TextField label="Name" value={name} maxLength={60} placeholder="Production billing worker" onChange={(event) => setName(event.target.value)} hint={`${name.length}/60 characters`} />
            <SelectField label="Run as member" value={boundUserId} options={memberOptions} onValueChange={(value) => setBoundUserId(value ?? "")} />
            <TextField label="Expiry (optional)" type="datetime-local" value={expiry} onChange={(event) => setExpiry(event.target.value)} hint="Leave blank for no expiry." />
          </>
        )}
      </Dialog>

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => { if (!open) setRevokeTarget(null); }}
        title="Revoke service token"
        description={revokeTarget ? `Revoke ${revokeTarget.name ?? revokeTarget.prefix}? Calls using it will stop immediately.` : ""}
        confirmLabel="Revoke"
        danger
        onConfirm={() => void handleRevoke()}
      />
    </>
  );
}
