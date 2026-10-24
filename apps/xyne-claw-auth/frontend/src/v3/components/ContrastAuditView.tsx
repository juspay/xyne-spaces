import { ArrowRightIcon, CheckIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import type { ContrastAudit, ContrastPairResult, ContrastSlot } from "../../lib/api";

/**
 * WCAG 2.2 contrast audit for a design system's token pairs (XYNE-66828).
 *
 * Presentational only. Every ratio, rating and suggestion is computed server
 * side with the canonical implementation in
 * packages/xyne-claw-shared/src/wcag-contrast.ts — this frontend has no
 * workspace dependencies by design, and a second copy of the maths here would
 * drift from the one that is under test.
 *
 * Used by the Brand Review Card before a system is saved, and exported for the
 * specimen page (XYNE-66820) and anywhere a saved system is listed.
 */

/** What an Apply click asks the caller to do: rewrite ONE named custom
 *  property. Never keyed by colour value — a white page background and white
 *  text on a primary fill are the same hex, and fixing the second by value
 *  would darken the first. */
export interface ContrastFix {
  pairId: string;
  slot: ContrastSlot;
  /** The custom property to rewrite, without `--`. Null when the palette never
   *  named it, which is when a fix cannot be applied for the user. */
  token: string | null;
  from: string;
  to: string;
  /** What the new colour achieves against this pair's background. */
  ratio: number;
}

export const CONTRAST_WARNING_COPY =
  "Contains contrast issues. You can still save, but designs will display a contrast warning.";

const SLOT_LABELS: Record<ContrastSlot, string> = {
  background: "background",
  surface: "surface",
  body: "body text",
  muted: "muted text",
  primary: "primary",
  onPrimary: "text on primary",
  onSurface: "text on surface",
  link: "link",
};

const formatRatio = (ratio: number): string => `${ratio.toFixed(2)}:1`;

/**
 * Shown wherever a failing system is used. Carries the count as text rather
 * than only an amber colour, so it survives a colourblind reader, a greyscale
 * print and the dark theme.
 */
export function ContrastWarningBadge({
  failing,
  className = "",
}: {
  /** Omitted when only the verdict is known, as on a list response. */
  failing?: number | undefined;
  className?: string;
}): React.JSX.Element {
  const label =
    failing === undefined
      ? "Contrast issues"
      : `${failing} contrast ${failing === 1 ? "issue" : "issues"}`;
  return (
    <span
      data-id="contrast-warning-badge"
      title={CONTRAST_WARNING_COPY}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200 ${className}`}
    >
      <WarningIcon size={11} aria-hidden />
      {label}
    </span>
  );
}

/** One rating. The glyph and the level name both carry the verdict; colour is
 *  the third signal, not the only one. */
function RatingPill({ level, passed }: { level: string; passed: boolean }): React.JSX.Element {
  return (
    <span
      className={
        passed
          ? "inline-flex items-center gap-0.5 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-px text-[10px] font-medium text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "inline-flex items-center gap-0.5 rounded border border-red-300 bg-red-50 px-1.5 py-px text-[10px] font-medium text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300"
      }
    >
      {passed ? <CheckIcon size={9} aria-hidden /> : <XIcon size={9} aria-hidden />}
      {level}
      <span className="sr-only">{passed ? " passes" : " fails"}</span>
    </span>
  );
}

/** The pair itself, rendered in its own colours. A reviewer can see the problem
 *  before they read the number. */
function PairPreview({ pair }: { pair: ContrastPairResult }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className="inline-flex h-7 w-10 shrink-0 items-center justify-center rounded border border-xyne-border-subtle text-[11px] font-medium"
      // Both hexes are validated server-side before they reach this style.
      style={{ backgroundColor: pair.backgroundHex ?? "transparent", color: pair.foregroundHex ?? "inherit" }}
    >
      Ag
    </span>
  );
}

function tokenLabel(token: string | null, slot: ContrastSlot): string {
  return token ? `--${token}` : SLOT_LABELS[slot];
}

function PairRow({
  pair,
  onApply,
  applying,
  busy,
}: {
  pair: ContrastPairResult;
  onApply: ((fix: ContrastFix) => void) | undefined;
  applying: boolean;
  busy: boolean;
}): React.JSX.Element {
  // A pair with no token on one side is not a failure — a system that never
  // names a link colour has no link pair to get wrong — but naming the missing
  // token is more useful than saying "unavailable".
  if (pair.status === "missing" || pair.status === "invalid") {
    const reason = pair.status === "missing" ? "not defined" : "not a flat colour";
    return (
      <li className="flex items-center gap-2 py-1.5 text-[11px] text-xyne-fg-muted">
        <span className="h-7 w-10 shrink-0 rounded border border-dashed border-xyne-border-subtle" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          {pair.label} — not checked,{" "}
          {pair.unresolved.map((slot) => SLOT_LABELS[slot]).join(" and ")} {reason}
        </span>
      </li>
    );
  }

  const failed = pair.status === "fail";
  const suggestion = pair.suggestion;
  const canApply = failed && suggestion !== null && pair.foregroundToken !== null && onApply;

  return (
    <li className="flex flex-wrap items-center gap-2 py-1.5">
      <PairPreview pair={pair} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] text-xyne-fg-primary">{pair.label}</div>
        <div className="truncate text-[10px] text-xyne-fg-muted">
          {tokenLabel(pair.foregroundToken, pair.foreground)} on{" "}
          {tokenLabel(pair.backgroundToken, pair.background)}
        </div>
      </div>

      <span
        className={
          failed
            ? "shrink-0 text-[12px] font-medium tabular-nums text-red-700 dark:text-red-300"
            : "shrink-0 text-[12px] font-medium tabular-nums text-xyne-fg-secondary"
        }
      >
        {pair.ratio === null ? "—" : formatRatio(pair.ratio)}
      </span>

      {pair.ratings && (
        <span className="flex shrink-0 items-center gap-1">
          <RatingPill level="AA" passed={pair.ratings.aaNormal} />
          <RatingPill level="AA large" passed={pair.ratings.aaLarge} />
          <RatingPill level="AAA" passed={pair.ratings.aaaNormal} />
        </span>
      )}

      {failed && suggestion && (
        <span className="flex w-full shrink-0 items-center gap-2 pl-12 text-[11px] text-xyne-fg-muted">
          <ArrowRightIcon size={11} aria-hidden />
          <span
            aria-hidden
            className="h-4 w-4 shrink-0 rounded border border-xyne-border-subtle"
            style={{ backgroundColor: suggestion.hex }}
          />
          <span className="uppercase tabular-nums">{suggestion.hex}</span>
          <span className="tabular-nums">({formatRatio(suggestion.ratio)})</span>
          {canApply ? (
            <button
              type="button"
              disabled={busy}
              // Five rows offer an "Apply", so the label has to say which one.
              aria-label={`Apply ${suggestion.hex} to ${tokenLabel(pair.foregroundToken, pair.foreground)}`}
              onClick={() =>
                onApply({
                  pairId: pair.id,
                  slot: pair.foreground,
                  token: pair.foregroundToken,
                  from: pair.foregroundHex ?? "",
                  to: suggestion.hex,
                  ratio: suggestion.ratio,
                })
              }
              className="inline-flex h-6 items-center rounded border border-xyne-border-subtle px-2 text-[11px] font-medium text-xyne-fg-secondary hover:border-xyne-border-strong hover:text-xyne-fg-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {applying ? "Applying" : "Apply"}
            </button>
          ) : (
            // No token name to rewrite: the palette carried the colour but
            // never named it, so the fix has to be made by hand.
            <span>— set {SLOT_LABELS[pair.foreground]} to this by hand</span>
          )}
        </span>
      )}
    </li>
  );
}

export function ContrastAuditView({
  audit,
  onApplySuggestion,
  applyingPairId = null,
  className = "",
}: {
  audit: ContrastAudit;
  /** Omit to render the audit read-only, as the specimen page does. */
  onApplySuggestion?: ((fix: ContrastFix) => void) | undefined;
  /** The pair whose fix is in flight, so its button shows progress and the
   *  rest cannot be clicked into a race. */
  applyingPairId?: string | null;
  className?: string;
}): React.JSX.Element {
  const busy = applyingPairId !== null;

  return (
    <section data-id="contrast-audit" className={className}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-xyne-fg-muted">
          Contrast
        </div>
        {audit.hasIssues ? (
          <ContrastWarningBadge failing={audit.failing} />
        ) : (
          <span className="text-[10px] text-xyne-fg-muted">
            {audit.audited === 0 ? "Nothing to check" : "Every pair passes AA"}
          </span>
        )}
      </div>

      {audit.hasIssues && (
        <p
          data-id="contrast-warning-banner"
          className="mb-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-5 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
        >
          {CONTRAST_WARNING_COPY}
        </p>
      )}

      {audit.audited === 0 && (
        <p className="mb-1 text-[11px] leading-5 text-xyne-fg-muted">
          This palette does not name both sides of any standard pair, so there is nothing to
          measure yet. Name the tokens below and it will be checked on save.
        </p>
      )}

      <ul className="divide-y divide-xyne-border-subtle">
        {audit.pairs.map((pair) => (
          <PairRow
            key={pair.id}
            pair={pair}
            onApply={onApplySuggestion}
            applying={applyingPairId === pair.id}
            busy={busy}
          />
        ))}
      </ul>
    </section>
  );
}
