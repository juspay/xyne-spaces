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
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
        <h2 className="text-lg font-semibold text-zinc-100">You're connected</h2>
        <p className="mt-2 text-sm text-zinc-400">
          <span className="font-mono text-zinc-200">{formatNumber(justLinked.senderId)}</span> now runs as {userEmail}.
          {justLinked.sendTo ? (
            <>
              {" "}
              Message <span className="font-mono text-zinc-200">{justLinked.sendTo}</span> on {channelName} and it will
              answer as you — nothing else to set up.
            </>
          ) : (
            <> Message the assistant on {channelName} and it will answer as you — nothing else to set up.</>
          )}
        </p>
        <button
          onClick={() => setJustLinked(null)}
          className="mt-5 text-xs text-zinc-400 underline-offset-2 hover:underline"
        >
          Add another number
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
      <h2 className="text-lg font-semibold text-zinc-100">Connect your {channelName} number</h2>
      <p className="mt-2 text-sm text-zinc-400">
        Add the number you message from and it will run as {userEmail} — your own Xyne access, your own history.
      </p>

      {loaded && accounts.length === 0 && (
        <p className="mt-5 text-sm text-zinc-400">
          There's no {channelName} assistant available for you to link to yet.
        </p>
      )}

      {accounts.length > 0 && (
        <>
          {accounts.length > 1 && (
            <label className="mt-5 block">
              <span className="text-xs uppercase tracking-wide text-zinc-500">Assistant</span>
              <select
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
              >
                <option value="">Choose one…</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}
                    {account.number ? ` (${account.number})` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="mt-4 block">
            <span className="text-xs uppercase tracking-wide text-zinc-500">Your number</span>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+91 98765 43210"
              inputMode="tel"
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-200 placeholder:text-zinc-600"
            />
            <span className="mt-1 block text-xs text-zinc-500">Include the country code.</span>
          </label>

          {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}

          <button
            onClick={submit}
            disabled={busy || phone.trim().length < 6 || (accounts.length > 1 && !accountId)}
            className="mt-5 w-full rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-white disabled:opacity-60"
          >
            {busy ? "Connecting…" : "Connect this number"}
          </button>
        </>
      )}

      {linked.length > 0 && (
        <div className="mt-8 border-t border-zinc-800 pt-5">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Your linked numbers</p>
          <ul className="mt-3 space-y-2">
            {linked.map((number) => (
              <li key={number.senderId} className="flex items-center justify-between gap-4 text-sm">
                <span className="font-mono text-zinc-200">{formatNumber(number.senderId)}</span>
                <button onClick={() => void unlink(number.senderId)} className="text-xs text-zinc-400 hover:text-rose-400">
                  Unlink
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
