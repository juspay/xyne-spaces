import type { VoiceCasing, VoiceRules } from "../../lib/api";

/**
 * The voice rules a design system states, as read by the parser (XYNE-66830).
 *
 * Presentational only — `parseVoiceSection` runs server-side, because it bounds
 * what this card and the QA check act on for a file drafted from an untrusted
 * page. It does not bound what reaches a /design prompt; that fence is
 * XYNE-66821's.
 *
 * Its real job is the empty state. A `## Voice` section written as prose parses
 * to nothing, and without this the reviewer saves a system that looks like it
 * has a voice while every later run and every QA check sees no rules at all.
 * Showing what was understood, before the thing is saved for the whole org, is
 * the point.
 */

const CASING_LABELS: Record<VoiceCasing, string> = {
  "sentence-case": "Sentence case",
  "title-case": "Title case",
  uppercase: "UPPERCASE",
  preserve: "Preserved",
};

export function voiceRulesAreEmpty(rules: VoiceRules): boolean {
  return (
    rules.toneWords.length === 0 &&
    rules.preferredWording.length === 0 &&
    rules.bannedPhrases.length === 0 &&
    rules.casing.headings === undefined &&
    rules.casing.buttons === undefined &&
    rules.ctaStyle === undefined &&
    rules.numberDateFormats === undefined
  );
}

function Pill({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="inline-flex items-center rounded-full border border-xyne-border-subtle px-2 py-0.5 text-[11px] text-xyne-fg-secondary">
      {children}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex gap-2 text-[11px]">
      <span className="w-[72px] shrink-0 text-xyne-fg-muted">{label}</span>
      <span className="min-w-0 flex-1 text-xyne-fg-secondary">{children}</span>
    </div>
  );
}

export function VoiceTonePreview({
  rules,
  className = "",
}: {
  rules: VoiceRules;
  className?: string;
}): React.JSX.Element {
  const { headings, buttons } = rules.casing;

  if (voiceRulesAreEmpty(rules)) {
    return (
      <section data-id="voice-tone-preview-empty" className={className}>
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-xyne-fg-muted">
          Voice &amp; tone
        </div>
        <p className="text-[11px] leading-5 text-xyne-fg-muted">
          No voice rules detected in <code>DESIGN.md</code>. Design runs will still follow the
          palette and type, but nothing checks the copy they write. Add a <code>## Voice</code>{" "}
          section with <code>Tone</code>, <code>Avoid</code> and <code>Headings</code> bullets to
          turn that on.
        </p>
      </section>
    );
  }

  return (
    <section data-id="voice-tone-preview" className={className}>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-xyne-fg-muted">
        Voice &amp; tone
      </div>

      {rules.toneWords.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {rules.toneWords.map((word) => (
            <Pill key={word}>{word}</Pill>
          ))}
        </div>
      )}

      <div className="space-y-1">
        {(headings || buttons) && (
          <Row label="Casing">
            {[
              headings ? `Headings: ${CASING_LABELS[headings]}` : null,
              buttons ? `Buttons: ${CASING_LABELS[buttons]}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Row>
        )}

        {rules.bannedPhrases.length > 0 && (
          <Row label={`Avoid (${rules.bannedPhrases.length})`}>
            {rules.bannedPhrases.join(", ")}
          </Row>
        )}

        {rules.preferredWording.length > 0 && (
          <Row label="Prefer">
            {rules.preferredWording
              .map((pair) => `${pair.prefer} (not ${pair.avoid})`)
              .join("; ")}
          </Row>
        )}

        {rules.ctaStyle && <Row label="CTAs">{rules.ctaStyle}</Row>}
        {rules.numberDateFormats?.numbers && (
          <Row label="Numbers">{rules.numberDateFormats.numbers}</Row>
        )}
        {rules.numberDateFormats?.dates && (
          <Row label="Dates">{rules.numberDateFormats.dates}</Row>
        )}
      </div>
    </section>
  );
}
