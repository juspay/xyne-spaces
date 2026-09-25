/**
 * Card for messaging channels (WhatsApp today; Telegram etc. later are one more
 * entry in CHANNELS). Talks to /claw/api/v1/surfaces/:channel.
 *
 * Rendered in two places, selected by `scope`: user-scoped channels on a
 * person's own Settings page, org-scoped ones on the organisation page — which
 * already renders it only for an org OWNER/ADMIN, the same gate the API
 * applies. This component adds no gate of its own: an earlier backstop here
 * checked platform CLAW_ADMIN instead, which is stricter than the API and made
 * the card vanish for the org owners it is meant for.
 *
 * Flow is the same either way — pick the agent, connect (a QR dialog for a
 * linked device, a token form for a business number), then the per-account
 * settings.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowsClockwiseIcon, CaretDownIcon, CaretUpIcon, DeviceMobileIcon, SealCheckIcon, CopyIcon } from "@phosphor-icons/react";

import {
  createChannelAccount,
  deleteChannelAccount,
  getChannelLoginArtifact,
  listAgents,
  listChannelAccounts,
  listChannelGroups,
  loginChannelAccount,
  logoutChannelAccount,
  updateChannelAccount,
  type ChannelAccountView,
  type ChannelGroup,
  type MessagingChannelKey,
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
  /** Mirrors the plugin's accountScope: "user" accounts are one person's own
   *  number and live in their Settings; "org" accounts are shared and live on
   *  the organisation page. */
  scope: "org" | "user";
}

const CHANNELS: ChannelMeta[] = [
  {
    key: "whatsapp",
    scope: "user",
    name: "WhatsApp (linked device)",
    noun: "number",
    icon: <DeviceMobileIcon size={17} className="mt-0.5 shrink-0 text-xyne-fg-secondary" />,
    caveat:
      "Your own number, linked by scanning a QR the way WhatsApp Web does. Out of the box it answers only where you address it — your own chat and the groups you tick below — so it never replies to someone on your behalf unless you switch that on. This is not an official WhatsApp API: your number carries the risk of being blocked, so use a number you can afford to lose.",
  },
  {
    key: "whatsapp-cloud",
    scope: "org",
    name: "WhatsApp Business API",
    noun: "number",
    icon: <SealCheckIcon size={17} className="mt-0.5 shrink-0 text-xyne-fg-secondary" />,
    caveat:
      "Meta's official API. No ban risk, but no groups, no self chat, and free-form replies only within 24 hours of the person's last message.",
  },
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

/**
 * Placement follows the app's existing split: per-user configuration lives in
 * Settings beside your own provider keys, org configuration on the org page.
 * The admin check is the backstop for the org page, which members can open too.
 */
export function MessagingChannelsCard({
  userId,
  scope,
  orgId,
}: {
  userId: string;
  scope: "org" | "user";
  /** Org-scoped channels only; a personal account uses the session's org. */
  orgId?: string;
}) {
  return (
    <>
      {CHANNELS.filter((channel) => channel.scope === scope).map((channel) => (
        <ChannelSection key={channel.key} channel={channel} userId={userId} orgId={orgId} />
      ))}
    </>
  );
}

function ChannelSection({ channel, userId, orgId }: { channel: ChannelMeta; userId: string; orgId?: string }) {
  const { show } = useSnackbar();
  const [accounts, setAccounts] = useState<ChannelAccountView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [agents, setAgents] = useState<Array<{ slug: string; name: string }>>([]);
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
        setAccounts(await listChannelAccounts(channel.key, orgId));
        setLoadFailed(false);
      } catch (error) {
        // A failed load must not read as "you have none" — that invites
        // someone to add a second number they already have.
        if (!silent) {
          setLoadFailed(true);
          show({ variant: "error", title: errorMessage(error, `Failed to load ${channel.name} accounts`) });
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [channel.key, channel.name, orgId, show],
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
    if (!newAgent) return;
    setCreating(true);
    try {
      const account = await createChannelAccount(channel.key, {
        ...(orgId ? { orgId } : {}),
        agentSlug: newAgent,
      });
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
              Let people message a {channel.name} {channel.noun} and talk to your agents. Each {channel.noun} has a default
              agent; a message starting with <code>/agent-slug</code> picks another one.
            </p>
            <p className="mt-1 text-[11px] text-xyne-fg-muted">{channel.caveat}</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" leadingIcon={<ArrowsClockwiseIcon size={14} />} onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {/* No name to type: an account is identified by the agent that answers
          on it, so the label is derived from the agent server-side. */}
      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <SelectField label="Default agent" options={agentOptions} value={newAgent ?? undefined} onValueChange={(value) => setNewAgent(value)} placeholder="Pick an agent" />
        <Button variant="primary" size="sm" disabled={creating || !newAgent} onClick={() => void create()}>
          {creating ? "Adding…" : `Add ${channel.noun}`}
        </Button>
      </div>

      <div className="mt-4 rounded-lg border border-xyne-border-subtle">
        {loading ? (
          <p className="px-4 py-3 text-[13px] text-xyne-fg-muted">Loading…</p>
        ) : loadFailed ? (
          <p className="px-4 py-3 text-[13px] text-xyne-fg-muted">
            Couldn't load your {channel.name} {channel.noun}s.{" "}
            <button type="button" className="underline hover:text-xyne-fg-primary" onClick={() => void load()}>
              Try again
            </button>
          </p>
        ) : accounts.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-xyne-fg-muted">No {channel.name} {channel.noun}s yet.</p>
        ) : (
          accounts.map((account) => (
            <AccountRow
              key={account.id}
              channel={channel}
              account={account}
              agentOptions={agentOptions}
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

/** A URL someone has to paste into a provider's console. Always visible, not
 *  only during the connect dialog — Meta's webhook config is re-edited long
 *  after the account is live. */
function CopyableUrl({ url, label, hint }: { url: string; label: string; hint?: string }) {
  const { show } = useSnackbar();
  return (
    <div className="grid gap-1.5">
      <p className="text-[11px] uppercase tracking-wide text-xyne-fg-muted">{label}</p>
      <div className="flex items-center gap-2 rounded-md border border-xyne-border-subtle p-2">
        <code className="min-w-0 flex-1 truncate text-[12px] text-xyne-fg-primary">{url}</code>
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<CopyIcon size={13} />}
          onClick={() => {
            void navigator.clipboard.writeText(url);
            show({ variant: "success", title: "Copied" });
          }}
        >
          Copy
        </Button>
      </div>
      {hint && <p className="text-[11px] text-xyne-fg-muted">{hint}</p>}
    </div>
  );
}

function AccountRow({
  channel,
  account,
  agentOptions,
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
        <div className="mt-3">
          <PolicyEditor channel={channel} account={account} agentOptions={agentOptions} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}

function PolicyEditor({
  channel,
  account,
  agentOptions,
  onChanged,
}: {
  channel: ChannelMeta;
  account: ChannelAccountView;
  agentOptions: Array<{ value: string; label: string }>;
  onChanged: () => void;
}) {
  const { show } = useSnackbar();
  const [agentSlug, setAgentSlug] = useState<string | null>(account.agent?.slug ?? null);
  const [answerOtherDms, setAnswerOtherDms] = useState(account.dmPolicy !== "disabled");
  const [answerGroups, setAnswerGroups] = useState(account.groupPolicy !== "disabled");
  const [groupAllowlist, setGroupAllowlist] = useState(account.groupAllowlist.join("\n"));
  const [requireMention, setRequireMention] = useState(account.requireMention);
  const [groupHistoryLimit, setGroupHistoryLimit] = useState(String(account.groupHistoryLimit));
  const residue = (account.channelConfig ?? {}) as { selfChat?: boolean; agentActions?: { sendToOtherChats?: boolean; reactions?: boolean; listGroups?: boolean } };
  const [selfChat, setSelfChat] = useState(residue.selfChat ?? true);
  const [agentSend, setAgentSend] = useState(residue.agentActions?.sendToOtherChats ?? false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateChannelAccount(channel.key, account.id, {
        ...(agentSlug && agentSlug !== account.agent?.slug ? { agentSlug } : {}),
        dmPolicy: (answerOtherDms ? "linked" : "disabled") as ChannelAccountView["dmPolicy"],
        groupPolicy: (answerGroups ? "allowlist" : "disabled") as ChannelAccountView["groupPolicy"],
        groupAllowlist: splitList(groupAllowlist),
        requireMention,
        ...(Number.isFinite(Number(groupHistoryLimit)) ? { groupHistoryLimit: Number(groupHistoryLimit) } : {}),
        channel: {
          ...(account.channelConfig ?? {}),
          ...(channel.scope === "user"
            ? {
                selfChat,
                agentActions: { ...(residue.agentActions ?? {}), sendToOtherChats: agentSend },
              }
            : {}),
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
      {account.webhookUrl && (
        <div className="mt-3">
          <CopyableUrl
            url={account.webhookUrl}
            label="Callback URL"
            hint="Meta app → WhatsApp → Configuration → Edit webhook, with the verify token you set at connect time. Over a tunnel, swap the host and keep the path exactly as shown."
          />
        </div>
      )}
      <div className="mt-3 grid gap-3 md:grid-cols-2 md:items-start">
        <SelectField label="Default agent" options={agentOptions} value={agentSlug ?? undefined} onValueChange={setAgentSlug} />
        {channel.scope === "user" && (
        <div className="grid gap-2 rounded-md border border-xyne-border-subtle p-3 md:col-span-2">
          <p className="text-[12px] font-semibold text-xyne-fg-primary">What this {channel.noun} does</p>
          <p className="-mt-1 text-[11px] text-xyne-fg-muted">Anything switched off is ignored entirely — no reply, no run.</p>
          <ToggleRow
            label="My own chat"
            hint="Messages you send to your own number run the agent as you."
            checked={selfChat}
            onChange={setSelfChat}
          />
          <ToggleRow
            label="Direct messages from other people"
            hint="People who have linked their number run as themselves; anyone else is told where to register. On your own number, leave this off unless you want it replying to strangers for you."
            checked={answerOtherDms}
            onChange={setAnswerOtherDms}
          />
          {account.capabilities.groups && (
            <ToggleRow
              label="Groups"
              hint="Only the groups ticked below."
              checked={answerGroups}
              onChange={setAnswerGroups}
            />
          )}
          <ToggleRow
            label="Let it message someone else"
            hint="Off, it only ever answers where it was spoken to. On, it can start a message to another number or group when you ask it to."
            checked={agentSend}
            onChange={setAgentSend}
          />
        </div>
        )}

        <div className="md:col-span-2">
          <ToggleRow
            label="Only answer when addressed"
            hint="An @mention, a reply to the agent, or a message starting with /agent-name. Applies everywhere — your own chat, direct messages and groups. Off, it answers every message it can see."
            checked={requireMention}
            onChange={setRequireMention}
          />
        </div>

        {account.capabilities.groups && answerGroups && (
          <>
            <div className="md:col-span-2">
              <GroupPicker
                channel={channel}
                account={account}
                selected={splitList(groupAllowlist)}
                onChange={(ids) => setGroupAllowlist(ids.join("\n"))}
              />
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

        <div className="md:col-span-2">
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
          <CopyableUrl
            url={webhookUrl}
            label="Callback URL"
            hint="Meta needs to reach this over public HTTPS. On a laptop, put a tunnel in front and swap the host for the tunnel's, keeping the path exactly as shown. You can find this again under Settings."
          />
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

/**
 * Pick the groups the agent may answer in, by name.
 *
 * The ids are opaque ("120363…@g.us") and a person has no way to discover one
 * except by reading the server log, so the account is asked for its own group
 * list instead. Ids already saved but not in that list are still shown, so a
 * stale entry can be seen and removed rather than silently dropped.
 */
function GroupPicker({
  channel,
  account,
  selected,
  onChange,
}: {
  channel: ChannelMeta;
  account: ChannelAccountView;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [groups, setGroups] = useState<ChannelGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGroups(await listChannelGroups(channel.key, account.id));
    } catch (err) {
      setError(errorMessage(err, "Could not load groups"));
    } finally {
      setLoading(false);
    }
  }, [channel.key, account.id]);

  useEffect(() => {
    if (account.connState === "connected") void load();
  }, [account.connState, load]);

  const known = new Set((groups ?? []).map((group) => group.id));
  const orphans = selected.filter((id) => !known.has(id));
  const needle = query.trim().toLowerCase();
  const shown = (groups ?? []).filter((group) => !needle || group.name.toLowerCase().includes(needle));
  // Searching must never look like it deselected something, so the count is
  // always of everything ticked, not of what survived the filter.
  const searchable = (groups?.length ?? 0) > 6;

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] text-xyne-fg-primary">
          Groups the agent answers in
          {selected.length > 0 && <span className="ml-1 text-xyne-fg-muted">· {selected.length} selected</span>}
        </p>
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => void load()}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {account.connState !== "connected" ? (
        <p className="mt-1 text-[11px] text-xyne-fg-muted">Connect the {channel.noun} to see its groups.</p>
      ) : error ? (
        <p className="mt-1 text-[11px] text-xyne-error-fg">{error}</p>
      ) : groups === null ? (
        <p className="mt-1 text-[11px] text-xyne-fg-muted">Loading groups…</p>
      ) : groups.length === 0 ? (
        <p className="mt-1 text-[11px] text-xyne-fg-muted">
          This {channel.noun} isn't in any groups yet. Add it to one from the phone, then Refresh.
        </p>
      ) : (
        <>
          {searchable && (
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${groups.length} groups`}
              className="mt-2 w-full rounded-md border border-xyne-border-subtle bg-transparent px-2 py-1.5 text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-muted"
            />
          )}
          {shown.length === 0 ? (
            <p className="mt-2 text-[11px] text-xyne-fg-muted">No group matches “{query.trim()}”.</p>
          ) : (
            <ul className="mt-2 max-h-48 overflow-y-auto rounded-md border border-xyne-border-subtle">
              {shown.map((group) => (
            <li key={group.id} className="flex items-center gap-2 border-b border-xyne-border-subtle px-2 py-1.5 last:border-b-0">
              <input
                type="checkbox"
                id={`grp-${account.id}-${group.id}`}
                checked={selected.includes(group.id)}
                onChange={() => toggle(group.id)}
              />
              <label htmlFor={`grp-${account.id}-${group.id}`} className="min-w-0 flex-1 cursor-pointer">
                <span className="block truncate text-[12px] text-xyne-fg-primary">{group.name || group.id}</span>
                <span className="text-[11px] text-xyne-fg-muted">{group.participants} members</span>
              </label>
            </li>
              ))}
            </ul>
          )}
        </>
      )}

      {orphans.length > 0 && (
        <p className="mt-1 text-[11px] text-xyne-fg-muted">
          {orphans.length} saved group{orphans.length === 1 ? "" : "s"} the {channel.noun} is no longer in:{" "}
          <button className="underline" onClick={() => onChange(selected.filter((id) => known.has(id)))}>
            remove
          </button>
        </p>
      )}
    </div>
  );
}
