import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircleIcon, FloppyDiskIcon, WarningIcon } from "@phosphor-icons/react";
import {
  ApiError,
  BRAND_DESIGN_MD_FILENAME,
  BRAND_SUMMARY_FILENAME,
  BRAND_TOKENS_CSS_FILENAME,
  auditContrastTokens,
  createDesignSystem,
  fetchBrandSummary,
  fetchChatAttachmentText,
  recordBrandSaved,
  type BrandColor,
  type BrandSummary,
  type ChatAttachmentMeta,
  type ContrastAudit,
  type ContrastSlot,
} from "../../lib/api";
import { ContrastAuditView, ContrastWarningBadge, type ContrastFix } from "./ContrastAuditView";

/**
 * Review card for a brand extraction.
 *
 * Rendered when an assistant message carries the three files a `/brand` run
 * delivers. Deliberately generic over the SOURCE: XYNE-66819 extracts from a
 * GitHub repo and emits the same `brand.json`, so it reuses this component
 * unchanged — which is why nothing here mentions a URL specifically and why
 * the contract lives in xyne-claw-shared rather than in this file.
 *
 * The catalog view and the per-chat picker are XYNE-66820's, not this card's.
 */

const MAX_NAME_CHARS = 120;
/** DESIGN.md becomes a standing instruction for every /design run that uses
 *  this system, so it is capped before it is stored. */
const MAX_DESIGN_MD_CHARS = 20_000;

interface BrandFiles {
  summary: ChatAttachmentMeta | undefined;
  designMd: ChatAttachmentMeta | undefined;
  tokensCss: ChatAttachmentMeta | undefined;
}

/** Last match wins within THIS message's attachments — a run that
 *  re-delivered brand.json appends, so the later entry is the current one.
 *  This does not search other messages. */
function findBrandFiles(attachments: ChatAttachmentMeta[]): BrandFiles {
  const byName = (name: string): ChatAttachmentMeta | undefined =>
    [...attachments].reverse().find(
      (item) => item.originalFilename.toLowerCase() === name.toLowerCase(),
    );
  return {
    summary: byName(BRAND_SUMMARY_FILENAME),
    designMd: byName(BRAND_DESIGN_MD_FILENAME),
    tokensCss: byName(BRAND_TOKENS_CSS_FILENAME),
  };
}

const ROLE_ORDER = [
  "primary",
  "accent",
  "background",
  "surface",
  "text",
  "muted",
  "border",
  "success",
  "warning",
  "danger",
] as const;

function sortColors(colors: BrandColor[]): BrandColor[] {
  return [...colors].sort((a, b) => {
    const byRole = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
    if (byRole !== 0) return byRole;
    return (b.occurrences ?? 0) - (a.occurrences ?? 0);
  });
}

/** A one-click contrast fix, keyed by the custom property it rewrites. */
type ContrastOverrides = Record<string, { from: string; to: string }>;

const escapeForRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Point one custom property at its corrected colour.
 *
 * Keyed by token NAME, not by colour value: `--brand-background` and
 * `--on-primary` are both `#FFFFFF` in a great many palettes, so a global hex
 * replace would darken the page background while fixing the button.
 *
 * FIRST declaration only, deliberately. The audit reads the first value of a
 * token — a `.dark { --text: #EEE }` block is a variant, not the light set —
 * so a global replace would have rewritten a value that was never checked, and
 * fixing light text would have made dark-mode text dark too.
 *
 * Returns null when nothing matched, so a rewrite that silently failed cannot
 * leave the card showing a colour that was never written.
 */
function rewriteTokenValue(css: string, token: string, hex: string): string | null {
  const declaration = new RegExp(
    `(--${escapeForRegExp(token)}\\s*:\\s*)#(?:[0-9a-f]{6}|[0-9a-f]{3})\\b`,
    "i",
  );
  if (!declaration.test(css)) return null;
  return css.replace(declaration, `$1${hex}`);
}

/**
 * DESIGN.md is the standing instruction every later /design run is given, so a
 * fix that only reached tokens.css would be overridden by the prose. The hexes
 * there sit in sentences and cannot be rewritten safely one token at a time, so
 * the corrections are appended as a later, more specific section instead — and
 * stay visible to the reviewer in the instructions panel.
 */
function contrastCorrectionsNote(overrides: ContrastOverrides): string {
  const entries = Object.entries(overrides);
  if (entries.length === 0) return "";
  return [
    "",
    "## Contrast corrections",
    "",
    "These replace the values given above. Applied to clear WCAG 2.2 AA (4.5:1) for normal text:",
    "",
    ...entries.map(([token, { from, to }]) => `- \`--${token}\`: ${from} → ${to}`),
    "",
  ].join("\n");
}

function sourceLabel(summary: BrandSummary): string {
  if (summary.source === "url") return summary.sourceUrl ?? "URL";
  if (summary.source === "repo") return summary.sourceRepo ?? "Repository";
  return "Screenshot";
}

export function BrandReviewCard({
  attachments,
  userId,
}: {
  attachments: ChatAttachmentMeta[];
  userId: string;
}): React.JSX.Element | null {
  const files = useMemo(() => findBrandFiles(attachments), [attachments]);
  const summaryId = files.summary?.id;

  const [summary, setSummary] = useState<BrandSummary | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedName, setSavedName] = useState<string | null>(null);
  // Fetched on load, not at save: the user has to be able to read this before
  // they turn it into an org-visible instruction.
  const [designMd, setDesignMd] = useState<string>("");
  const [designMdOpen, setDesignMdOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Measured server-side and re-measured after every applied fix, rather than
  // computed here: the contrast maths has one implementation, and it is the
  // one under test. XYNE-66828.
  const [contrast, setContrast] = useState<ContrastAudit | null>(null);
  const [applyingPairId, setApplyingPairId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<ContrastOverrides>({});
  // The token CSS as it will be STORED — fetched on load, rewritten by Apply,
  // audited at every step, and saved verbatim. One artifact, so the card and
  // the saved system cannot reach different verdicts.
  const [tokensCss, setTokensCss] = useState<string>("");

  useEffect(() => {
    if (!summaryId) return;
    let cancelled = false;
    setLoadFailed(false);
    void (async () => {
      try {
        // Validated server-side against the canonical contract. brand.json is
        // model-written inside a sandbox and its hex values become inline
        // style values below, so the card never parses it itself.
        const result = await fetchBrandSummary(summaryId, userId);
        if (cancelled) return;
        if (!result) {
          setLoadFailed(true);
          return;
        }
        setSummary(result.summary);
        setName(result.summary.name.slice(0, MAX_NAME_CHARS));
        // Already saved in an earlier session: show that instead of a Save
        // button, which would mint a duplicate for the whole org.
        if (result.savedDesignSystemId) setSavedName(result.summary.name);
        // Fetched on load, not at save: this is the artifact the audit runs on
        // and the one that gets stored, so the card has to hold it from the
        // start rather than measuring something else and storing this.
        if (files.tokensCss) {
          const css = await fetchChatAttachmentText(files.tokensCss.id, userId).catch(() => "");
          if (!cancelled) {
            setTokensCss(css);
            const audit = await auditContrastTokens({ tokensCss: css }).catch(() => null);
            if (!cancelled) setContrast(audit);
          }
        } else {
          // No token CSS means a saved system would store none, and audit to
          // nothing. Saying so beats auditing brand.json and disagreeing later.
          const audit = await auditContrastTokens({ tokensCss: "" }).catch(() => null);
          if (!cancelled) setContrast(audit);
        }
        if (files.designMd) {
          const text = await fetchChatAttachmentText(files.designMd.id, userId).catch(() => "");
          if (!cancelled) setDesignMd(text.slice(0, MAX_DESIGN_MD_CHARS));
        }
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [summaryId, userId]);

  /**
   * Apply one suggested colour.
   *
   * The whole palette is re-measured rather than this row being marked fixed:
   * the token being changed is usually the foreground of more than one pair, so
   * a click can turn another pair from passing to failing. Nothing is committed
   * until the re-audit comes back, so a failed request leaves the palette as it
   * was instead of showing a fix that was never measured.
   */
  const applyFix = useCallback(
    async (fix: ContrastFix): Promise<void> => {
      const token = fix.token;
      if (!contrast || !token) return;
      setApplyingPairId(fix.pairId);
      setError(null);
      try {
        // Rewrite the CSS, then audit THAT — the same bytes that will be
        // stored. Nothing is committed until the re-audit returns, so a failed
        // request leaves the palette as it was rather than showing a fix that
        // was never measured.
        const rewritten = rewriteTokenValue(tokensCss, token, fix.to);
        if (rewritten === null) {
          setError(
            `Could not apply the fix: no \`--${token}\` declaration found in this system's tokens.css.`,
          );
          return;
        }
        const next = await auditContrastTokens({ tokensCss: rewritten });

        setTokensCss(rewritten);
        setContrast(next);
        setOverrides((current) => ({
          ...current,
          // Keep the ORIGINAL colour when a token is corrected twice, so the
          // note records where it started rather than an intermediate value.
          [token]: { from: current[token]?.from ?? fix.from, to: fix.to },
        }));
        setSummary((current) =>
          current
            ? {
                ...current,
                colors: current.colors.map((color) =>
                  color.token.toLowerCase() === token ? { ...color, hex: fix.to } : color,
                ),
              }
            : current,
        );
      } catch (err) {
        setError(
          err instanceof Error && err.message
            ? `Could not re-check contrast: ${err.message}`
            : "Could not re-check contrast.",
        );
      } finally {
        setApplyingPairId(null);
      }
    },
    [contrast, tokensCss],
  );

  const save = useCallback(async (): Promise<void> => {
    if (!summary) return;
    setSaving(true);
    setError(null);
    try {
      // Stored verbatim: this is the string the audit above ran on, already
      // carrying every applied fix. Re-fetching and re-rewriting here is what
      // let the card and the saved system diverge.
      const note = contrastCorrectionsNote(overrides);
      const created = await createDesignSystem({
        name: name.trim() || summary.name,
        // Already fetched, shown to the user, and capped on the way in. The
        // note is reserved room rather than appended and then truncated, which
        // would have cut the correction it exists to record.
        designMd: note ? `${designMd.slice(0, MAX_DESIGN_MD_CHARS - note.length)}${note}` : designMd,
        tokensCss,
        source: summary.source,
        sourceUrl: summary.sourceUrl ?? null,
        sourceRepo: summary.sourceRepo ?? null,
        sourceCommit: summary.sourceCommit ?? null,
        // Descriptors only, and marked unresolved on purpose: the bytes still
        // live on chat attachments, which cascade-delete with their message.
        // Copying them into durable storage is follow-up work — recording them
        // as if they were durable would strand a saved system's logo.
        assets: summary.assets?.length
          ? { extracted: summary.assets, storage: "unresolved" }
          : null,
      });
      // Record it against the attachment before showing success: that record
      // is what stops a reload offering to create the same system again.
      if (files.summary) {
        await recordBrandSaved(files.summary.id, created.id, userId).catch(() => undefined);
      }
      // The server audits what it stored. Showing that, rather than the audit
      // of the palette in hand, is the only way the badge reflects the system
      // every later run will actually be given.
      if (created.contrast && "pairs" in created.contrast) setContrast(created.contrast);
      setSavedName(created.name);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Save failed",
      );
    } finally {
      setSaving(false);
    }
  }, [summary, files.designMd, files.tokensCss, files.summary, name, userId, designMd, overrides]);

  // Not a brand run — render nothing rather than an empty shell.
  if (!files.summary) return null;

  if (loadFailed) {
    return (
      <div
        data-id="brand-review-card-invalid"
        className="flex items-start gap-2 rounded-lg border border-xyne-border-subtle px-3 py-2.5 text-[12px] text-xyne-fg-muted"
      >
        <WarningIcon size={14} className="mt-0.5 shrink-0" />
        <span>
          This run delivered a <code>{BRAND_SUMMARY_FILENAME}</code> that does not match the brand
          contract, so it cannot be reviewed here. The files are still attached below.
        </span>
      </div>
    );
  }

  if (!summary) return null;

  const colors = sortColors(summary.colors);
  const headingFont = summary.fonts.find((font) => font.role === "heading") ?? summary.fonts[0];
  const bodyFont = summary.fonts.find((font) => font.role === "body") ?? headingFont;
  const steps = [...summary.typeScale].sort((a, b) => b.sizePx - a.sizePx).slice(0, 5);

  return (
    <div
      data-id="brand-review-card"
      className="w-full max-w-[560px] overflow-hidden rounded-xl border border-xyne-border-subtle"
    >
      <header className="flex items-start justify-between gap-3 border-b border-xyne-border-subtle px-4 py-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-xyne-fg-primary">Brand extracted</div>
          <div className="truncate text-[11px] text-xyne-fg-muted" title={sourceLabel(summary)}>
            {sourceLabel(summary)}
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-xyne-border-subtle px-2 py-0.5 text-[10px] uppercase tracking-wide text-xyne-fg-muted">
          {summary.source}
        </span>
      </header>

      <section className="px-4 py-3">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-xyne-fg-muted">
          Palette
        </div>
        <div className="flex flex-wrap gap-2">
          {colors.map((color) => (
            <div key={`${color.token}-${color.hex}`} className="w-[72px]">
              {/* hex is validated to #RRGGBB before it reaches this style. */}
              <div
                className="h-10 w-full rounded-md border border-xyne-border-subtle"
                style={{ backgroundColor: color.hex }}
                title={`${color.token} — ${color.hex}`}
              />
              <div className="mt-1 truncate text-[10px] text-xyne-fg-secondary" title={color.role}>
                {color.role}
              </div>
              <div className="truncate text-[10px] uppercase text-xyne-fg-muted">{color.hex}</div>
            </div>
          ))}
        </div>
      </section>

      {contrast && (
        <div className="border-t border-xyne-border-subtle px-4 py-3">
          <ContrastAuditView
            audit={contrast}
            onApplySuggestion={savedName ? undefined : (fix) => { void applyFix(fix); }}
            applyingPairId={applyingPairId}
          />
        </div>
      )}

      {headingFont && (
        <section className="border-t border-xyne-border-subtle px-4 py-3">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-xyne-fg-muted">
            Typography
          </div>
          <div className="text-[12px] text-xyne-fg-secondary">
            {headingFont.family}
            {bodyFont && bodyFont.family !== headingFont.family ? ` · ${bodyFont.family}` : ""}
          </div>
          <div className="mt-2 space-y-1">
            {steps.map((step) => (
              <div key={step.name} className="flex items-baseline gap-3">
                <span className="w-10 shrink-0 text-[10px] text-xyne-fg-muted">{step.name}</span>
                <span
                  className="truncate text-xyne-fg-primary"
                  style={{
                    // Capped so a 96px display step cannot blow out the card.
                    fontSize: `${Math.min(step.sizePx, 28)}px`,
                    fontFamily: `${JSON.stringify(headingFont.family)}, ${(headingFont.fallbacks ?? ["sans-serif"]).join(", ")}`,
                    ...(step.weight ? { fontWeight: step.weight } : {}),
                  }}
                >
                  Ag
                </span>
                <span className="text-[10px] text-xyne-fg-muted">{step.sizePx}px</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {summary.gaps && summary.gaps.length > 0 && (
        <section className="border-t border-xyne-border-subtle px-4 py-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-xyne-fg-muted">
            <WarningIcon size={12} /> Could not determine
          </div>
          {/* Shown, not hidden: a gap the reviewer can see beats a token that
              was quietly invented and is then wrong in every later artifact. */}
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-xyne-fg-muted">
            {summary.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </section>
      )}

      {designMd && (
        <section className="border-t border-xyne-border-subtle px-4 py-3">
          <button
            type="button"
            onClick={() => setDesignMdOpen((open) => !open)}
            aria-expanded={designMdOpen}
            className="flex w-full items-center justify-between gap-2 text-left text-[12px] font-medium text-xyne-fg-secondary hover:text-xyne-fg-primary"
          >
            <span>Design instructions ({designMd.length.toLocaleString()} characters)</span>
            <span aria-hidden>{designMdOpen ? "Hide" : "Review"}</span>
          </button>
          <p className="mt-1 text-[11px] text-xyne-fg-muted">
            Written from the source you gave. Saving makes this a standing instruction for every
            design run that uses it, so read it first.
          </p>
          {designMdOpen && (
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-xyne-border-subtle bg-xyne-bg-subtle p-2 text-[11px] leading-relaxed text-xyne-fg-secondary">
              {designMd}
            </pre>
          )}
        </section>
      )}

      <footer className="flex items-center justify-between gap-3 border-t border-xyne-border-subtle px-4 py-3">
        {savedName ? (
          <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] text-xyne-fg-secondary">
            <CheckCircleIcon size={14} /> Saved as “{savedName}”
            {/* Saving a failing system is allowed, and then said out loud
                wherever it is used. */}
            {contrast?.hasIssues && <ContrastWarningBadge failing={contrast.failing} />}
          </span>
        ) : (
          <>
            <input
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, MAX_NAME_CHARS))}
              placeholder="Design system name"
              aria-label="Design system name"
              className="h-9 min-w-0 flex-1 rounded-md border border-xyne-border-subtle bg-transparent px-2.5 text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-muted focus:border-xyne-border-strong focus:outline-none"
            />
            <button
              type="button"
              disabled={saving || !name.trim()}
              onClick={() => {
                void save();
              }}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-xyne-fg-primary px-3 text-[12px] font-medium text-xyne-fg-inverse hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <FloppyDiskIcon size={14} /> {saving ? "Saving" : "Save as design system"}
            </button>
          </>
        )}
      </footer>

      {error && (
        <div className="border-t border-xyne-border-subtle px-4 py-2 text-[11px] text-xyne-fg-muted">
          {error}
        </div>
      )}
    </div>
  );
}
