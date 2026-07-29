import { useEffect, useState } from "react";
import { ThumbsUpIcon, ThumbsDownIcon } from "@phosphor-icons/react";
import { rateRun } from "../lib/api";

type Rating = "up" | "down";

/**
 * Per-assistant-message 👍/👎 control. Persists via the existing
 * `POST /runs/:sessionId/rate` endpoint (one AgentRun = one assistant turn,
 * sessionId is unique per turn), so ratings flow straight into the metrics
 * SentimentPanel with no backend changes. On 👎 we reveal an inline optional
 * comment, matching the ActivityTab run-drawer pattern.
 *
 * Shared by the v3 chat (ChatPageV3) and the legacy v1 chat (AgentChat).
 */
export function MessageRatingButtons({
  userId,
  sessionId,
  rating,
  ratingComment,
  onRated,
}: {
  userId: string;
  sessionId: string;
  rating: Rating | null;
  ratingComment?: string | null;
  onRated?: (rating: Rating, comment?: string) => void;
}) {
  const [current, setCurrent] = useState<Rating | null>(rating);
  const [saving, setSaving] = useState<Rating | null>(null);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState(ratingComment ?? "");

  // Re-sync from props when the server-side rating for this message changes
  // (e.g. after a runs refetch), but never while the user is mid-save or has
  // the comment box open — we don't want to clobber their in-progress input.
  useEffect(() => {
    if (saving === null && !showComment) {
      setCurrent(rating);
      setComment(ratingComment ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rating, ratingComment]);

  const submit = async (r: Rating, commentArg?: string) => {
    setSaving(r);
    setCurrent(r); // optimistic — reflect the click immediately
    try {
      await rateRun(userId, sessionId, r, commentArg);
      onRated?.(r, commentArg);
    } catch (err) {
      console.warn("[rating] failed", err);
    } finally {
      setSaving(null);
    }
  };

  const isUp = current === "up";
  const isDown = current === "down";

  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => { setShowComment(false); submit("up"); }}
        disabled={saving !== null}
        title="This response was helpful"
        className={`inline-flex h-5 w-5 items-center justify-center rounded transition ${
          isUp
            ? "bg-green-500/15 text-green-500"
            : "text-xyne-fg-muted hover:bg-xyne-surface hover:text-green-500"
        }`}
      >
        <ThumbsUpIcon size={12} weight={isUp ? "fill" : "regular"} />
      </button>
      <button
        type="button"
        onClick={() => { setShowComment(true); if (current !== "down") submit("down"); }}
        disabled={saving !== null}
        title="This response missed the mark"
        className={`inline-flex h-5 w-5 items-center justify-center rounded transition ${
          isDown
            ? "bg-red-500/15 text-red-500"
            : "text-xyne-fg-muted hover:bg-xyne-surface hover:text-red-500"
        }`}
      >
        <ThumbsDownIcon size={12} weight={isDown ? "fill" : "regular"} />
      </button>
      {showComment && isDown && (
        <span className="ml-1 inline-flex items-center gap-1">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="what went wrong?"
            className="w-44 rounded border border-xyne-border-subtle bg-xyne-surface px-2 py-0.5 text-[11px] text-xyne-fg-primary placeholder-xyne-fg-muted focus:border-xyne-border-strong focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter") { submit("down", comment); setShowComment(false); }
              if (e.key === "Escape") setShowComment(false);
            }}
          />
          <button
            type="button"
            onClick={() => { submit("down", comment); setShowComment(false); }}
            disabled={saving !== null}
            className="rounded bg-xyne-surface px-2 py-0.5 text-[11px] text-xyne-fg-secondary hover:text-xyne-fg-primary"
          >
            save
          </button>
        </span>
      )}
    </span>
  );
}
