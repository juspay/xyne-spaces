/**
 * Org admin card for messaging channels (WhatsApp today; Telegram etc. later
 * are one more entry in CHANNELS). Talks to /claw/api/v1/surfaces/:channel.
 *
 * Flow: add a number (label + default agent) → Connect (QR dialog polls the
 * login artifact until the phone links) → policy settings
 * per account.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowsClockwiseIcon, CaretDownIcon, CaretUpIcon, SealCheckIcon, CopyIcon } from "@phosphor-icons/react";

import {
  createChannelAccount,
  deleteChannelAccount,
  getChannelLoginArtifact,
  listAgents,
  listChannelAccounts,
  loginChannelAccount,
  logoutChannelAccount,
  updateChannelAccount,
  type ChannelAccountView,
  type MessagingChannelKey,
  type OrgDetail,
} from "../../lib/api";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { Dialog } from "./ui/Dialog";
import { SelectField } from "./ui/SelectField";
import { Switch } from "./ui/Switch";
import { TextField } from "./ui/TextField";
import { useSnackbar } from "./ui/Snackbar";

interface ChannelMeta {
  key: MessagingChannelKey;
  name: string;
  noun: string;
  icon: ReactNode;
  caveat: string;
}

const CHANNELS: ChannelMeta[] = [
  {
    key: "whatsapp-cloud",
    name: "WhatsApp Business API",
    noun: "number",
    icon: <SealCheckIcon size={17} className="mt-0.5 shrink-0 text-xyne-fg-secondary" />,
    caveat:
      "Meta's official API. No ban risk, but no groups, no self chat, and free-form replies only within 24 hours of the person's last message.",
  },
];

const DM_POLICY_OPTIONS = [
  { value: "linked", label: "Linked only — unknown senders are told to add their number in Claw" },
  { value: "disabled", label: "Disabled — ignore direct messages" },
];
const GROUP_POLICY_OPTIONS = [
  { value: "allowlist", label: "Allowlist — only listed groups" },
  { value: "open", label: "Open — any group" },
  { value: "disabled", label: "Disabled — ignore groups" },
];

function connStateBadge(state: ChannelAccountView["connState"]): { label: string; variant: "success" | "warning" | "neutral" | "info" } {
  switch (state) {
    case "connected":
      return { label: "Connected", variant: "success" };
    case "pending_login":
      return { label: "Waiting for scan", variant: "info" };
    case "logged_out":
      return { label: "Logged out", variant: "warning" };
    default:
      return { label: "Disconnected", variant: "neutral" };
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function MessagingChannelsCard({ userId, org }: { userId: string; org: OrgDetail }) {
  return (
    <>
      {CHANNELS.map((channel) => (
        <ChannelSection key={channel.key} channel={channel} userId={userId} org={org} />
      ))}
    </>
  );
}

function ChannelSection({ channel, userId, org }: { channel: ChannelMeta; userId: string; org: OrgDetail }) {
  const { show } = useSnackbar();
  const [accounts, setAccounts] = useState<ChannelAccountView[]>([]);
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<Array<{ slug: string; name: string }>>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newAgent, setNewAgent] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [qrAccount, setQrAccount] = useState<ChannelAccountView | null>(null);
  const [tokenAccount, setTokenAccount] = useState<ChannelAccountView | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ChannelAccountView | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        setAccounts(await listChannelAccounts(channel.key, org.id));
      } catch (error) {
        if (!silent) show({ variant: "error", title: errorMessage(error, `Failed to load ${channel.name} accounts`) });
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [channel.key, channel.name, org.id, show],
  );

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    listAgents(userId)
      .then((rows) => {
        const own = rows.map((agent) => ({ slug: agent.slug, name: agent.name })).sort((a, b) => a.slug.localeCompare(b.slug));
        setAgents(own);
        setNewAgent((current) => current ?? own[0]?.slug ?? null);
      })
      .catch(() => setAgents([]));
  }, [userId]);

  const agentOptions = useMemo(() => agents.map((agent) => ({ value: agent.slug, label: `${agent.name} (/${agent.slug})` })), [agents]);

  const create = async () => {
    if (!newLabel.trim() || !newAgent) return;
    setCreating(true);
    try {
      const account = await createChannelAccount(channel.key, { orgId: org.id, label: newLabel.trim(), agentSlug: newAgent });
      setNewLabel("");
      await load(true);
      show({ variant: "success", title: `${channel.name} ${channel.noun} added` });
      await connect(account);
    } catch (error) {
      show({ variant: "error", title: errorMessage(error, "Failed to add account") });
    } finally {
      setCreating(false);
    }
  };

  const connect = async (account: ChannelAccountView) => {
    // Token channels collect their credentials in a dialog first; QR channels
    // start the socket immediately and show the code.
    if (account.login.kind === "token") {
      setTokenAccount(account);
      return;
    }
    try {
      await loginChannelAccount(channel.key, account.id);
      setQrAccount(account);
    } catch (error) {
      show({ variant: "error", title: errorMessage(error, "Failed to start login") });
    }
  };

  const logout = async (account: ChannelAccountView) => {
    try {
      await logoutChannelAccount(channel.key, account.id);
      show({ variant: "success", title: "Logged out — the device was unlinked" });
      await load(true);
    } catch (error) {
      show({ variant: "error", title: errorMessage(error, "Logout failed") });
    }
  };

  const remove = async (account: ChannelAccountView) => {
    try {
      await deleteChannelAccount(channel.key, account.id);
      setConfirmDelete(null);
      if (expanded === account.id) setExpanded(null);
      show({ variant: "success", title: "Account removed" });
      await load(true);
    } catch (error) {
      show({ variant: "error", title: errorMessage(error, "Delete failed") });
    }
  };

  return (
    <section className="mt-6 rounded-lg border border-xyne-border-subtle p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-2">
          {channel.icon}
          <div>
            <h2 className="text-[13px] font-semibold text-xyne-fg-primary">{channel.name}</h2>
            <p className="mt-1 text-[12px] text-xyne-fg-muted">
              Let people message a {channel.name} {channel.noun} and talk to this org's agents. Each {channel.noun} has a default
              agent; a message starting with <code>/agent-slug</code> picks another one.
            </p>
            <p className="mt-1 text-[11px] text-xyne-fg-muted">{channel.caveat}</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" leadingIcon={<ArrowsClockwiseIcon size={14} />} onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <TextField
          label="Label"
          placeholder={`e.g. Support ${channel.noun}`}
          value={newLabel}
          onChange={(event) => setNewLabel(event.target.value)}
        />
        <SelectField label="Default agent" options={agentOptions} value={newAgent ?? undefined} onValueChange={(value) => setNewAgent(value)} placeholder="Pick an agent" />
        <Button variant="primary" size="sm" disabled={creating || !newLabel.trim() || !newAgent} onClick={() => void create()}>
          {creating ? "Adding…" : `Add ${channel.noun}`}
        </Button>
      </div>

      <div className="mt-4 rounded-lg border border-xyne-border-subtle">
        {loading ? (
          <p className="px-4 py-3 text-[13px] text-xyne-fg-muted">Loading…</p>
        ) : accounts.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-xyne-fg-muted">No {channel.name} {channel.noun}s yet.</p>
        ) : (
          accounts.map((account) => (
            <AccountRow
              key={account.id}
              channel={channel}
              account={account}
              agentOptions={agentOptions}
              org={org}
              userId={userId}
              expanded={expanded === account.id}
              onToggle={() => setExpanded(expanded === account.id ? null : account.id)}
              onConnect={() => void connect(account)}
              onLogout={() => void logout(account)}
              onDelete={() => setConfirmDelete(account)}
              onChanged={() => void load(true)}
            />
          ))
        )}
      </div>

      {tokenAccount && (
        <TokenLoginDialog
          channel={channel}
          account={tokenAccount}
          onClose={() => {
            setTokenAccount(null);
            void load(true);
          }}
        />
      )}

      {qrAccount && (
        <LoginDialog
          channel={channel}
          account={qrAccount}
          onClose={() => {
            setQrAccount(null);
            void load(true);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        title={`Remove ${confirmDelete?.label ?? "account"}?`}
        description="The device is unlinked, stored credentials are wiped, and every linked identity for this account is deleted."
        confirmLabel="Remove"
        danger
        onConfirm={() => {
          if (confirmDelete) void remove(confirmDelete);
        }}
      />
    </section>
  );
}

function AccountRow({
  channel,
  account,
  agentOptions,
  org,
  userId,
  expanded,
  onToggle,
  onConnect,
  onLogout,
  onDelete,
  onChanged,
}: {
  channel: ChannelMeta;
  account: ChannelAccountView;
  agentOptions: Array<{ value: string; label: string }>;
  org: OrgDetail;
  userId: string;
  expanded: boolean;
  onToggle: () => void;
  onConnect: () => void;
  onLogout: () => void;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const badge = connStateBadge(account.connState);
  const connected = account.connState === "connected";
  return (
    <div className="border-b border-xyne-border-subtle px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-xyne-fg-primary">{account.label}</span>
            <Badge label={badge.label} variant={badge.variant} size="sm" />
          </div>
          <p className="mt-0.5 text-[12px] text-xyne-fg-muted">
            {account.displayId ?? "Not linked yet"} · default agent {account.agent ? `/${account.agent.slug}` : "none"} · DMs: {account.dmPolicy} · groups: {account.groupPolicy}
          </p>
          {account.lastDisconnect && !connected && (
            <p className="mt-0.5 text-[11px] text-xyne-fg-muted">
              Last disconnect: {account.lastDisconnect.reason ?? "unknown"} ({new Date(account.lastDisconnect.at).toLocaleString()})
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <Button variant="secondary" size="sm" onClick={onLogout}>
              Log out
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={onConnect}>
              {account.connState === "pending_login" ? "Show QR" : "Connect"}
            </Button>
          )}
          <Button variant="ghost" size="sm" trailingIcon={expanded ? <CaretUpIcon size={12} /> : <CaretDownIcon size={12} />} onClick={onToggle}>
            {expanded ? "Hide" : "Settings"}
          </Button>
          <Button variant="destructive" size="sm" onClick={onDelete}>
            Remove
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <PolicyEditor channel={channel} account={account} agentOptions={agentOptions} org={org} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}

function PolicyEditor({
  channel,
  account,
  agentOptions,
  org,
  onChanged,
}: {
  channel: ChannelMeta;
  account: ChannelAccountView;
  agentOptions: Array<{ value: string; label: string }>;
  org: OrgDetail;
  onChanged: () => void;
}) {
  const { show } = useSnackbar();
  const [agentSlug, setAgentSlug] = useState<string | null>(account.agent?.slug ?? null);
  const [dmPolicy, setDmPolicy] = useState<string | null>(account.dmPolicy);
  const [groupPolicy, setGroupPolicy] = useState<string | null>(account.groupPolicy);
  const [groupAllowlist, setGroupAllowlist] = useState(account.groupAllowlist.join("\n"));
  const [groupAllowFrom, setGroupAllowFrom] = useState(account.groupAllowFrom.join("\n"));
  const [requireMention, setRequireMention] = useState(account.requireMention);
  const [groupHistoryLimit, setGroupHistoryLimit] = useState(String(account.groupHistoryLimit));
  const [ackReaction, setAckReaction] = useState(account.ackReaction ?? "");
  const residue = (account.channelConfig ?? {}) as { selfChat?: boolean; agentActions?: { sendToOtherChats?: boolean; reactions?: boolean; listGroups?: boolean } };
  const [selfChat, setSelfChat] = useState(residue.selfChat ?? true);
  const [agentSend, setAgentSend] = useState(residue.agentActions?.sendToOtherChats ?? false);
  const [agentReact, setAgentReact] = useState(residue.agentActions?.reactions ?? true);
  const [agentGroups, setAgentGroups] = useState(residue.agentActions?.listGroups ?? true);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateChannelAccount(channel.key, account.id, {
        ...(agentSlug && agentSlug !== account.agent?.slug ? { agentSlug } : {}),
        dmPolicy: (dmPolicy ?? "linked") as ChannelAccountView["dmPolicy"],
        groupPolicy: (groupPolicy ?? "allowlist") as ChannelAccountView["groupPolicy"],
        groupAllowlist: splitList(groupAllowlist),
        groupAllowFrom: splitList(groupAllowFrom),
        requireMention,
        ...(Number.isFinite(Number(groupHistoryLimit)) ? { groupHistoryLimit: Number(groupHistoryLimit) } : {}),
        ...(ackReaction.trim() ? { ackReaction: ackReaction.trim() } : {}),
        channel: {
          ...(account.channelConfig ?? {}),
          selfChat,
          agentActions: { sendToOtherChats: agentSend, reactions: agentReact, listGroups: agentGroups },
        },
      });
      show({ variant: "success", title: "Settings saved" });
      onChanged();
    } catch (error) {
      show({ variant: "error", title: errorMessage(error, "Save failed") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-xyne-border-subtle p-3">
      <h3 className="text-[12px] font-semibold text-xyne-fg-primary">Who can talk to this {channel.noun}</h3>
      <div className="mt-3 grid gap-3">
        <SelectField label="Default agent" options={agentOptions} value={agentSlug ?? undefined} onValueChange={setAgentSlug} />
        <SelectField label="Direct messages" options={DM_POLICY_OPTIONS} value={dmPolicy ?? undefined} onValueChange={setDmPolicy} />
        {account.capabilities.groups && (
          <>
            <SelectField label="Groups" options={GROUP_POLICY_OPTIONS} value={groupPolicy ?? undefined} onValueChange={setGroupPolicy} />
            <TextField
              label="Allowed groups"
              hint="Group ids (…@g.us). Find them in the backend log when a group message is ignored."
              multiline
              rows={2}
              value={groupAllowlist}
              onChange={(event) => setGroupAllowlist(event.target.value)}
            />
            <TextField
              label="Group senders"
              hint="Optional: only these numbers may trigger the agent inside groups."
              multiline
              rows={2}
              value={groupAllowFrom}
              onChange={(event) => setGroupAllowFrom(event.target.value)}
            />
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[12px] text-xyne-fg-primary">Require @mention in groups</p>
                <p className="text-[11px] text-xyne-fg-muted">Off = reply to every message in allowed groups.</p>
              </div>
              <Switch checked={requireMention} onChange={setRequireMention} ariaLabel="Require mention" />
            </div>
            <TextField
              label="Group context carried forward"
              hint="Messages that didn't mention the agent are quoted to it on the next reply, so it knows what was discussed. 0 = it only ever sees what was said to it directly."
              value={groupHistoryLimit}
              inputMode="numeric"
              onChange={(event) => setGroupHistoryLimit(event.target.value)}
            />
          </>
        )}
        <div className="mt-1 border-t border-xyne-border-subtle pt-3">
          <p className="text-[12px] font-semibold text-xyne-fg-primary">What the agent may do on this {channel.noun}</p>
          <p className="text-[11px] text-xyne-fg-muted">Replying in the chat that messaged it is always allowed.</p>
        </div>
        <ToggleRow label="Self chat" hint="Messages you send to your own number run the agent as the fallback user." checked={selfChat} onChange={setSelfChat} />
        <ToggleRow label="Send to other chats" hint="Let the agent message other numbers and groups when asked." checked={agentSend} onChange={setAgentSend} />
        <ToggleRow label="React to messages" hint="Let the agent add emoji reactions." checked={agentReact} onChange={setAgentReact} />
        <ToggleRow label="List groups" hint="Let the agent see which groups this number is in." checked={agentGroups} onChange={setAgentGroups} />
        {account.capabilities.reactions && (
          <TextField label="Ack reaction" hint="Emoji added to a message when a run starts (optional)." placeholder="👀" value={ackReaction} onChange={(event) => setAckReaction(event.target.value)} />
        )}
        <div>
          <Button variant="primary" size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function LoginDialog({ channel, account, onClose }: { channel: ChannelMeta; account: ChannelAccountView; onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [state, setState] = useState<ChannelAccountView["connState"]>(account.connState);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const artifact = await getChannelLoginArtifact(channel.key, account.id);
        if (cancelled) return;
        setState(artifact.connState);
        setQr(artifact.qr);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, "Could not fetch login status"));
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 2_500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [channel.key, account.id]);

  const connected = state === "connected";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={connected ? `${account.label} is connected` : `Link ${account.label} to ${channel.name}`}
      maxWidth={460}
      footer={
        <Button variant={connected ? "primary" : "secondary"} size="sm" onClick={onClose}>
          {connected ? "Done" : "Close"}
        </Button>
      }
    >
      {connected ? (
        <p className="text-[13px] text-xyne-fg-secondary">
          The phone is linked. Message this {channel.noun} from another {channel.name} account to try it — a sender whose number isn't linked is pointed to Claw to add it themselves.
        </p>
      ) : (
        <div className="flex flex-col items-center gap-3">
          {qr ? (
            <img src={qr} alt={`${channel.name} login QR`} className="h-64 w-64 rounded-md bg-white p-2" />
          ) : (
            <div className="flex h-64 w-64 items-center justify-center rounded-md border border-dashed border-xyne-border-subtle text-[12px] text-xyne-fg-muted">
              {error ?? "Generating QR…"}
            </div>
          )}
          <ol className="list-decimal pl-5 text-[12px] text-xyne-fg-secondary">
            <li>Open {channel.name} on the phone that owns the {channel.noun}.</li>
            <li>Settings → Linked devices → Link a device.</li>
            <li>Scan this code. It refreshes automatically until the phone links.</li>
          </ol>
          <p className="text-[11px] text-xyne-fg-muted">Status: {connStateBadge(state).label}</p>
        </div>
      )}
    </Dialog>
  );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[12px] text-xyne-fg-primary">{label}</p>
        <p className="text-[11px] text-xyne-fg-muted">{hint}</p>
      </div>
      <Switch checked={checked} onChange={onChange} ariaLabel={label} />
    </div>
  );
}

/**
 * Token login for webhook channels (WhatsApp Business API today). Collects the
 * plugin's declared fields, saves them, then shows the webhook URL the admin
 * must paste into the provider's console — which only exists once the account
 * does, hence the ordering.
 */
function TokenLoginDialog({
  channel,
  account,
  onClose,
}: {
  channel: ChannelMeta;
  account: ChannelAccountView;
  onClose: () => void;
}) {
  const { show } = useSnackbar();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(account.connState === "connected");

  const fields = account.loginFields ?? [];
  const complete = fields.every((field) => (values[field.key] ?? "").trim());
  const webhookUrl = account.webhookUrl ?? "";

  const submit = async () => {
    setSaving(true);
    try {
      await loginChannelAccount(channel.key, account.id, { secrets: values });
      setSaved(true);
      show({ variant: "success", title: "Credentials saved" });
    } catch (error) {
      show({ variant: "error", title: errorMessage(error, "Could not save credentials") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={saved ? `Point Meta at ${account.label}` : `Connect ${account.label}`}
      maxWidth={560}
      footer={
        saved ? (
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={saving || !complete} onClick={() => void submit()}>
              {saving ? "Saving…" : "Save credentials"}
            </Button>
          </div>
        )
      }
    >
      {saved ? (
        <div className="grid gap-3">
          <p className="text-[13px] text-xyne-fg-secondary">
            In your Meta app open WhatsApp, Configuration, and edit the webhook. Paste this callback URL and the verify
            token you just entered, then subscribe to the <code>messages</code> field.
          </p>
          <div className="flex items-center gap-2 rounded-md border border-xyne-border-subtle p-2">
            <code className="min-w-0 flex-1 truncate text-[12px] text-xyne-fg-primary">{webhookUrl}</code>
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<CopyIcon size={13} />}
              onClick={() => {
                void navigator.clipboard.writeText(webhookUrl);
                show({ variant: "success", title: "Copied" });
              }}
            >
              Copy
            </Button>
          </div>
          <p className="text-[11px] text-xyne-fg-muted">
            Meta needs to reach this over public HTTPS. On a laptop, put a tunnel in front and swap the host for the
            tunnel's, keeping the path exactly as shown.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          <p className="text-[13px] text-xyne-fg-secondary">
            From your Meta app. These are stored encrypted and never leave the server.
          </p>
          {fields.map((field) => (
            <TextField
              key={field.key}
              label={field.label}
              type={field.type === "password" ? "password" : "text"}
              autoComplete="off"
              {...(field.placeholder ? { placeholder: field.placeholder } : {})}
              {...(field.hint ? { hint: field.hint } : {})}
              value={values[field.key] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
            />
          ))}
        </div>
      )}
    </Dialog>
  );
}
