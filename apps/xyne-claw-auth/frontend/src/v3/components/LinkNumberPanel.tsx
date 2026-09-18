/**
 * Self-service number linking: "here is my WhatsApp number, make it me."
 *
 * One step. The signed-in session says who the person is, and the number they
 * type says which sender id that identity answers to — so the link exists the
 * moment they submit, and the very next message they send is answered as them.
 * Nothing is asked of the phone.
 */
import { useCallback, useEffect, useState } from "react";
import {
  linkChannelNumber,
  listLinkableChannelAccounts,
  listMyChannelNumbers,
  unlinkMyChannelNumber,
  type ChannelNumberLink,
  type LinkableChannelAccount,
  type LinkedChannelNumber,
  type MessagingChannelKey,
} from "../../lib/api";

function formatNumber(senderId: string): string {
  const digits = senderId.replace(/\D/g, "");
  return digits ? `+${digits}` : senderId;
}

export function LinkNumberPanel({
  channel,
  channelName,
  userEmail,
}: {
  channel: MessagingChannelKey;
  channelName: string;
  userEmail: string;
}) {
  const [accounts, setAccounts] = useState<LinkableChannelAccount[]>([]);
  const [linked, setLinked] = useState<LinkedChannelNumber[]>([]);
  const [accountId, setAccountId] = useState("");
  const [phone, setPhone] = useState("");
  const [justLinked, setJustLinked] = useState<ChannelNumberLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const [available, mine] = await Promise.all([
      listLinkableChannelAccounts(channel).catch(() => [] as LinkableChannelAccount[]),
      listMyChannelNumbers(channel).catch(() => [] as LinkedChannelNumber[]),
    ]);
    setAccounts(available);
    setLinked(mine);
    setAccountId((current) => current || (available.length === 1 ? (available[0]?.id ?? "") : ""));
    setLoaded(true);
  }, [channel]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await linkChannelNumber(channel, phone, accountId || undefined);
      setJustLinked(result);
      setPhone("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link this number. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [channel, phone, accountId, refresh]);

  const unlink = useCallback(
    async (senderId: string) => {
      await unlinkMyChannelNumber(channel, senderId).catch(() => undefined);
      setJustLinked((current) => (current?.senderId === senderId ? null : current));
      await refresh();
    },
    [channel, refresh],
  );

  if (justLinked) {
    return (
      <div className="text-[12px] text-xyne-fg-secondary">
        <span className="font-mono text-xyne-fg-primary">{formatNumber(justLinked.senderId)}</span> now runs as {userEmail}.{" "}
        {justLinked.sendTo ? (
          <>
            Message <span className="font-mono text-xyne-fg-primary">{justLinked.sendTo}</span> on {channelName} and it answers as
            you.
          </>
        ) : (
          <>Message the assistant on {channelName} and it answers as you.</>
        )}
        <button onClick={() => setJustLinked(null)} className="ml-2 text-xyne-fg-muted underline-offset-2 hover:underline">
          Add another
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {loaded && accounts.length === 0 && (
        <p className="text-[12px] text-xyne-fg-muted">No {channelName} assistant is available for you to link to yet.</p>
      )}

      {accounts.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            {accounts.length > 1 && (
              <select
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                className="h-8 shrink-0 rounded-md border border-xyne-border-subtle bg-transparent px-2 text-[12px] text-xyne-fg-primary"
              >
                <option value="">Assistant…</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}
                    {account.number ? ` (${account.number})` : ""}
                  </option>
                ))}
              </select>
            )}
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+91 98765 43210"
              inputMode="tel"
              className="h-8 min-w-0 flex-1 rounded-md border border-xyne-border-subtle bg-transparent px-2.5 font-mono text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-muted"
            />
            <button
              onClick={submit}
              disabled={busy || phone.trim().length < 6 || (accounts.length > 1 && !accountId)}
              className="h-8 shrink-0 rounded-md bg-xyne-brand px-3 text-[12px] font-medium text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Connecting…" : "Connect"}
            </button>
          </div>
          <p className="text-[11px] text-xyne-fg-muted">+91 assumed unless you add a country code.</p>

          {error && <p className="text-[12px] text-xyne-error-fg">{error}</p>}
        </>
      )}

      {linked.length > 0 && (
        <ul className="space-y-1.5">
          {linked.map((number) => (
            <li
              key={number.senderId}
              className="flex items-center justify-between gap-2 rounded-md border border-xyne-border-subtle px-2.5 py-1.5 text-[12px]"
            >
              <span className="font-mono text-xyne-fg-primary">{formatNumber(number.senderId)}</span>
              <button
                onClick={() => void unlink(number.senderId)}
                className="text-[11px] text-xyne-fg-muted hover:text-xyne-error-fg"
              >
                Unlink
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
