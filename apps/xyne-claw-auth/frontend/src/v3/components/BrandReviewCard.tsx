import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircleIcon,
  FloppyDiskIcon,
  MoonIcon,
  SunIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import {
  ApiError,
  BRAND_DESIGN_MD_FILENAME,
  BRAND_SUMMARY_FILENAME,
  BRAND_TOKENS_CSS_FILENAME,
  BRAND_TOKENS_DARK_CSS_FILENAME,
  createDesignSystem,
  fetchBrandSummary,
  fetchChatAttachmentText,
  recordBrandSaved,
  type BrandColor,
  type BrandSummary,
  type ChatAttachmentMeta,
} from "../../lib/api";
import { SpecimenPreview, resolveSpecimenPalette } from "./SpecimenPreview";

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
  /** Absent for a single-theme source, which is the common case. */
  tokensCssDark: ChatAttachmentMeta | undefined;
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
    tokensCssDark: byName(BRAND_TOKENS_DARK_CSS_FILENAME),
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
  // Starts light regardless of the host app's theme: the reviewer is judging
  // this brand's light set, not their own editor preference.
  const [dark, setDark] = useState(false);

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

  const save = useCallback(async (): Promise<void> => {
    if (!summary) return;
    setSaving(true);
    setError(null);
    try {
      const tokensCss = files.tokensCss
        ? await fetchChatAttachmentText(files.tokensCss.id, userId)
        : "";
      // Stored on the same row as a sibling column (XYNE-66829). A system saved
      // without it is single-theme, which later runs treat as "no dark theme"
      // rather than deriving one.
      const tokensCssDark = files.tokensCssDark
        ? await fetchChatAttachmentText(files.tokensCssDark.id, userId)
        : "";
      const created = await createDesignSystem({
        name: name.trim() || summary.name,
        // Already fetched, shown to the user, and capped on the way in.
        designMd,
        tokensCss,
        tokensCssDark,
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
      setSavedName(created.name);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Save failed",
      );
    } finally {
      setSaving(false);
    }
  }, [
    summary,
    files.designMd,
    files.tokensCss,
    files.tokensCssDark,
    files.summary,
    designMd,
    name,
    userId,
  ]);

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

  // A dark set and its provenance travel together: the contract allows one
  // without the other, and a palette that cannot say where it came from is not
  // worth a toggle the reviewer would have to trust blindly.
  const darkColors = summary.colorsDark ?? [];
  const hasDarkSet = darkColors.length > 0 && Boolean(summary.darkThemeSource);
  const showingDark = hasDarkSet && dark;

  const colors = sortColors(showingDark ? darkColors : summary.colors);
  const headingFont = summary.fonts.find((font) => font.role === "heading") ?? summary.fonts[0];
  const bodyFont = summary.fonts.find((font) => font.role === "body") ?? headingFont;
  const steps = [...summary.typeScale].sort((a, b) => b.sizePx - a.sizePx).slice(0, 5);
  // Drives the typography sample's own surface, so type is judged against the
  // theme it will actually be read on rather than the host app's background.
  const typeSurface = resolveSpecimenPalette(colors, showingDark).resolved;

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
        <div className="flex shrink-0 items-center gap-2">
          {/* Only rendered for a system that HAS both sets. A toggle that
              switches to an empty palette would be a control that lies. */}
          {hasDarkSet && (
            <div
              role="group"
              aria-label="Preview theme"
              className="flex items-center rounded-md border border-xyne-border-subtle p-0.5"
            >
              <button
                type="button"
                onClick={() => setDark(false)}
                aria-pressed={!dark}
                title="Light"
                className={`inline-flex h-6 w-7 items-center justify-center rounded ${
                  dark ? "text-xyne-fg-muted hover:text-xyne-fg-primary" : "bg-xyne-surface-subtle text-xyne-fg-primary"
                }`}
              >
                <SunIcon size={13} />
                <span className="sr-only">Light</span>
              </button>
              <button
                type="button"
                onClick={() => setDark(true)}
                aria-pressed={dark}
                title={`Dark — from ${summary.darkThemeSource}`}
                className={`inline-flex h-6 w-7 items-center justify-center rounded ${
                  dark ? "bg-xyne-surface-subtle text-xyne-fg-primary" : "text-xyne-fg-muted hover:text-xyne-fg-primary"
                }`}
              >
                <MoonIcon size={13} />
                <span className="sr-only">Dark</span>
              </button>
            </div>
          )}
          <span className="shrink-0 rounded-full border border-xyne-border-subtle px-2 py-0.5 text-[10px] uppercase tracking-wide text-xyne-fg-muted">
            {summary.source}
          </span>
        </div>
      </header>

      <section className="px-4 py-3">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-xyne-fg-muted">
            Palette{hasDarkSet ? (showingDark ? " — dark" : " — light") : ""}
          </div>
          {/* Where the dark set came from, shown rather than implied: a reviewer
              who can see it was measured from prefers-color-scheme trusts it
              differently than one shown a palette with no origin. */}
          {showingDark && (
            <div className="shrink-0 text-[10px] text-xyne-fg-muted">
              from {summary.darkThemeSource}
            </div>
          )}
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

      {headingFont && (
        <section className="border-t border-xyne-border-subtle px-4 py-3">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-xyne-fg-muted">
            Typography
          </div>
          <div className="text-[12px] text-xyne-fg-secondary">
            {headingFont.family}
            {bodyFont && bodyFont.family !== headingFont.family ? ` · ${bodyFont.family}` : ""}
          </div>
          <div
            className="mt-2 space-y-1 rounded-md px-2 py-1.5"
            style={
              // Only themed once there is a dark set to compare against;
              // otherwise the card keeps the host app's own surface.
              hasDarkSet
                ? { backgroundColor: typeSurface.background, border: `1px solid ${typeSurface.border}` }
                : undefined
            }
          >
            {steps.map((step) => (
              <div key={step.name} className="flex items-baseline gap-3">
                <span
                  className="w-10 shrink-0 text-[10px] text-xyne-fg-muted"
                  style={hasDarkSet ? { color: typeSurface.muted } : undefined}
                >
                  {step.name}
                </span>
                <span
                  className="truncate text-xyne-fg-primary"
                  style={{
                    ...(hasDarkSet ? { color: typeSurface.text } : {}),
                    // Capped so a 96px display step cannot blow out the card.
                    fontSize: `${Math.min(step.sizePx, 28)}px`,
                    fontFamily: `${JSON.stringify(headingFont.family)}, ${(headingFont.fallbacks ?? ["sans-serif"]).join(", ")}`,
                    ...(step.weight ? { fontWeight: step.weight } : {}),
                  }}
                >
                  Ag
                </span>
                <span
                  className="text-[10px] text-xyne-fg-muted"
                  style={hasDarkSet ? { color: typeSurface.muted } : undefined}
                >
                  {step.sizePx}px
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="border-t border-xyne-border-subtle px-4 py-3">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-xyne-fg-muted">
          Specimen{hasDarkSet ? (showingDark ? " — dark" : " — light") : ""}
        </div>
        <SpecimenPreview
          colors={colors}
          fonts={summary.fonts}
          typeScale={summary.typeScale}
          dark={showingDark}
        />
      </section>

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
          <span className="flex items-center gap-1.5 text-[12px] text-xyne-fg-secondary">
            <CheckCircleIcon size={14} /> Saved as “{savedName}”
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
