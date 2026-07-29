import {
  BrainIcon,
  ArrowsClockwiseIcon,
  CheckIcon,
  PencilSimpleIcon,
  SparkleIcon,
  QuotesIcon,
} from "@phosphor-icons/react";

/** Editorial serif applied inline so it never depends on a Tailwind font util. */
const SERIF: React.CSSProperties = { fontFamily: "var(--comp-font-serif)" };

interface DigitalTwinLandingProps {
  onEnable: () => void;
}

const STEPS: Array<{ icon: React.ReactNode; title: string; body: string }> = [
  { icon: <PencilSimpleIcon size={15} weight="duotone" />, title: "Your work", body: "Messages, hosted calls and canvases you authored across Spaces." },
  { icon: <SparkleIcon size={15} weight="duotone" />, title: "Curator distils", body: "An LLM extracts durable, grounded facts — your voice, expertise, decisions." },
  { icon: <CheckIcon size={15} weight="bold" />, title: "You approve", body: "Every candidate passes your review before it becomes a memory." },
  { icon: <QuotesIcon size={15} weight="duotone" />, title: "Twin replies", body: "Drafts responses in your voice, citing only what you approved." },
];

/**
 * Full-width first-run hero shown when the Twin is OFF. Makes the feature and
 * its backfill capability obvious instead of hiding them behind an empty split
 * view. Neutral palette, hairline rules, editorial serif headline.
 */
export function DigitalTwinLanding({ onEnable }: DigitalTwinLandingProps) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[900px] px-[40px] py-[44px]">
        {/* Hero */}
        <div className="relative">
          <div className="flex items-center gap-[8px] font-mono text-[11px] uppercase tracking-[0.16em] text-xyne-fg-tertiary">
            <span className="h-[6px] w-[6px] rounded-full bg-xyne-success-fg" />
            Digital Twin
          </div>
          <h1 className="mt-[16px] max-w-[620px] text-[38px] leading-[1.08] tracking-[-0.02em] text-xyne-fg-primary" style={SERIF}>
            An AI that answers <em className="italic">in your voice</em>, grounded in memories you approve.
          </h1>
          <p className="mt-[14px] max-w-[540px] text-[15px] leading-[1.6] text-xyne-fg-secondary">
            Your Twin reads what you've written across Spaces, distils durable facts about how you work and
            communicate, and drafts replies as you — nothing is remembered until you approve it.
          </p>
          <div className="mt-[24px] flex flex-wrap items-center gap-[14px]">
            <button
              onClick={onEnable}
              className="inline-flex items-center gap-[8px] rounded-[10px] bg-xyne-brand px-[16px] py-[10px] text-[13px] font-semibold text-xyne-fg-inverse transition hover:bg-xyne-brand-hover active:bg-xyne-brand-active"
            >
              <BrainIcon size={15} weight="duotone" />
              Enable Digital Twin
            </button>
            <span className="flex items-center gap-[6px] text-[12px] text-xyne-fg-tertiary">
              <ArrowsClockwiseIcon size={13} />
              You'll be able to backfill the last few months of your history in one click.
            </span>
          </div>
        </div>

        {/* How it works — 4-step flow, hairline separators, no cards */}
        <div className="mt-[40px] grid grid-cols-1 gap-x-[26px] gap-y-[20px] border-t border-xyne-border-subtle pt-[26px] sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <div key={s.title} className="relative pr-[22px] lg:border-r lg:border-xyne-border-subtle lg:last:border-r-0">
              <div className="flex h-[26px] w-[26px] items-center justify-center rounded-[8px] border border-xyne-border text-xyne-fg-secondary">
                {s.icon}
              </div>
              <div className="mt-[12px] font-mono text-[10.5px] text-xyne-fg-tertiary">0{i + 1}</div>
              <h4 className="mt-[6px] text-[13.5px] font-semibold text-xyne-fg-primary">{s.title}</h4>
              <p className="mt-[4px] text-[12px] leading-[1.5] text-xyne-fg-tertiary">{s.body}</p>
            </div>
          ))}
        </div>

        {/* Capability strip */}
        <div className="mt-[30px] flex flex-wrap gap-[8px]">
          {[
            ["SOURCES", "Messages · Calls · Canvases"],
            ["REVIEW", "Every memory approved by you"],
            ["VOICE", "Replies drafted as you"],
            ["PIPELINE", "Fully inspectable"],
          ].map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-[7px] rounded-full border border-xyne-border bg-xyne-surface-subtle px-[12px] py-[5px] text-[11.5px] text-xyne-fg-secondary">
              <span className="font-mono text-[10px] text-xyne-fg-tertiary">{k}</span>
              {v}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
