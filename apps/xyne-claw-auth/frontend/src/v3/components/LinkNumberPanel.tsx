/**
 * Self-service number linking: "here is my WhatsApp number, make it me."
 *
 * One step. The signed-in session says who the person is, and the number they
 * type says which sender id that identity answers to — so the link exists the
 * moment they submit, and the very next message they send is answered as them.
 * Nothing is asked of the phone.
 *
 * The number belongs to the person, not to one assistant, so there is nothing
 * to pick: it is linked on every channel passed in, and any assistant in the
 * org — a business number or a colleague's personal one — knows who they are.
 */
import { useCallback, useEffect, useState } from "react";
import {
  linkChannelNumber,
  listMyChannelNumbers,
  unlinkMyChannelNumber,
  type ChannelNumberLink,
  type MessagingChannelKey,
} from "../../lib/api";

function formatNumber(senderId: string): string {
  const digits = senderId.replace(/\D/g, "");
  return digits ? `+${digits}` : senderId;
}

/** One number the person has linked, and the channels it is linked on. */
interface Mine {
  display: string;
  entries: Array<{ channel: MessagingChannelKey; senderId: string }>;
}

export function LinkNumberPanel({
  channel,
  channelName,
  userEmail,
}: {
  /** One channel, or every channel this person could be reached on. An org may
   *  run a business number, personal numbers, or both, and the person linking
   *  neither knows nor cares which — they have one number either way. */
  channel: MessagingChannelKey | MessagingChannelKey[];
  channelName: string;
  userEmail: string;
}) {
  const channels = Array.isArray(channel) ? channel : [channel];
  // Stable across renders so the effect below does not loop on a fresh array.
  const channelKey = channels.join(",");
  const [linked, setLinked] = useState<Mine[]>([]);
  const [phone, setPhone] = useState("");
  const [justLinked, setJustLinked] = useState<ChannelNumberLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const results = await Promise.all(
      channels.map((key) =>
        listMyChannelNumbers(key)
          .then((rows) => rows.map((row) => ({ channel: key, senderId: row.senderId })))
          .catch(() => []),
      ),
    );
    // The same number is stored once per channel, in each channel's own
    // format; the person sees it once.
    const byDisplay = new Map<string, Mine>();
    for (const entry of results.flat()) {
      const display = formatNumber(entry.senderId);
      const mine = byDisplay.get(display) ?? { display, entries: [] };
      mine.entries.push(entry);
      byDisplay.set(display, mine);
    }
    setLinked([...byDisplay.values()]);
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // A channel this deployment does not run refuses; that is fine as long
      // as one of them took it.
      const results = await Promise.allSettled(channels.map((key) => linkChannelNumber(key, phone)));
      const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (ok.length === 0) {
        const first = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
        throw first?.reason ?? new Error("Could not link this number. Please try again.");
      }
      setJustLinked(ok.find((link) => link.sendTo) ?? ok[0]!);
      setPhone("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link this number. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [channels, phone, refresh]);

  const unlink = useCallback(
    async (mine: Mine) => {
      await Promise.all(
        mine.entries.map((entry) => unlinkMyChannelNumber(entry.channel, entry.senderId).catch(() => undefined)),
      );
      setJustLinked((current) => (current && formatNumber(current.senderId) === mine.display ? null : current));
      await refresh();
    },
    [refresh],
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
      {!loaded && <p className="text-[12px] text-xyne-fg-muted">Loading…</p>}

      <div className="flex items-center gap-2">
        <input
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="+91 98765 43210"
          inputMode="tel"
          className="h-8 min-w-0 flex-1 rounded-md border border-xyne-border-subtle bg-transparent px-2.5 font-mono text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-muted"
        />
        <button
          onClick={submit}
          disabled={busy || phone.trim().length < 6}
          className="h-8 shrink-0 rounded-md bg-xyne-brand px-3 text-[12px] font-medium text-xyne-fg-inverse transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Connecting…" : "Connect"}
        </button>
      </div>
      <p className="text-[11px] text-xyne-fg-muted">+91 assumed unless you add a country code.</p>

      {error && <p className="text-[12px] text-xyne-error-fg">{error}</p>}

      {linked.length > 0 && (
        <ul className="space-y-1.5">
          {linked.map((mine) => (
            <li
              key={mine.display}
              className="flex items-center justify-between gap-2 rounded-md border border-xyne-border-subtle px-2.5 py-1.5 text-[12px]"
            >
              <span className="font-mono text-xyne-fg-primary">{mine.display}</span>
              <button onClick={() => void unlink(mine)} className="text-[11px] text-xyne-fg-muted hover:text-xyne-error-fg">
                Unlink
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
