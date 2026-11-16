/**
 * Self-service number linking: "here is my WhatsApp number, make it me."
 *
 * Two steps. The signed-in session says who the person is; the number they
 * type is sent a one-time code on WhatsApp, and the link exists once they type
 * that code back here — so only whoever holds the phone can link it. From then
 * on, the next message they send is answered as them.
 *
 * The number belongs to the person, not to one assistant, so there is nothing
 * to pick: one confirmed code links it on every channel the org runs, and any
 * assistant in the org — a business number or a colleague's personal one —
 * knows who they are.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  confirmChannelNumber,
  listMyChannelNumbers,
  requestChannelNumberCode,
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

/** A code is on its way to `phone`; `channel` is the route that sent it. */
interface Pending {
  phone: string;
  channel: MessagingChannelKey;
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
  const [pending, setPending] = useState<Pending | null>(null);
  const [code, setCode] = useState("");
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

  /** One code, whichever channel takes the request: a channel this deployment
   *  does not run refuses with 404, and the next one is tried. */
  const sendCode = useCallback(
    async (number: string) => {
      setBusy(true);
      setError(null);
      try {
        let failure: unknown = null;
        for (const key of channels) {
          try {
            await requestChannelNumberCode(key, number);
            setPending({ phone: number, channel: key });
            setCode("");
            return;
          } catch (err) {
            // Keep the first real refusal over a "not on this channel".
            if (!failure || (failure instanceof ApiError && failure.status === 404)) failure = err;
            if (!(err instanceof ApiError) || err.status !== 404) break;
          }
        }
        throw failure ?? new Error("Could not send a code. Please try again.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not send a code. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channelKey],
  );

  const confirm = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const link = await confirmChannelNumber(pending.channel, pending.phone, code);
      setJustLinked(link);
      setPending(null);
      setPhone("");
      setCode("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify this code. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [pending, code, refresh]);

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

      {pending ? (
        <>
          <p className="text-[12px] text-xyne-fg-secondary">
            We sent a code to <span className="font-mono text-xyne-fg-primary">{pending.phone}</span> on {channelName}. Enter it
            to link the number.
          </p>
          <div className="flex items-center gap-2">
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="6-digit code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              className="h-8 min-w-0 flex-1 rounded-md border border-xyne-border-subtle bg-transparent px-2.5 font-mono text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-muted"
            />
            <button
              onClick={confirm}
              disabled={busy || code.replace(/\s/g, "").length !== 6}
              className="h-8 shrink-0 rounded-md bg-xyne-brand px-3 text-[12px] font-medium text-xyne-fg-inverse transition hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Verifying…" : "Verify"}
            </button>
          </div>
          <p className="text-[11px] text-xyne-fg-muted">
            <button
              onClick={() => void sendCode(pending.phone)}
              disabled={busy}
              className="underline-offset-2 hover:underline disabled:opacity-60"
            >
              Send a new code
            </button>
            {" · "}
            <button
              onClick={() => {
                setPending(null);
                setError(null);
              }}
              className="underline-offset-2 hover:underline"
            >
              Use a different number
            </button>
          </p>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+91 98765 43210"
              inputMode="tel"
              className="h-8 min-w-0 flex-1 rounded-md border border-xyne-border-subtle bg-transparent px-2.5 font-mono text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-muted"
            />
            <button
              onClick={() => void sendCode(phone)}
              disabled={busy || phone.trim().length < 6}
              className="h-8 shrink-0 rounded-md bg-xyne-brand px-3 text-[12px] font-medium text-xyne-fg-inverse transition hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Sending…" : "Send code"}
            </button>
          </div>
          <p className="text-[11px] text-xyne-fg-muted">+91 assumed unless you add a country code.</p>
        </>
      )}

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
