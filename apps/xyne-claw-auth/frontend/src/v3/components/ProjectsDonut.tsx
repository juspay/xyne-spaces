/**
 * ProjectsDonut — aggregate distribution across all projects.
 *
 * Pure SVG, no chart library. Each slice is sized by the chosen `metric`
 * (runs / tokens / users / failures) and annotated with an outside,
 * two-line label connected by a leader line:
 *   slice edge → elbow → horizontal stub → "Name" / "X.X% · 32 runs"
 *
 * The component is geometry-only. Size is controlled by the parent via
 * the wrapping container — the SVG uses viewBox and scales to fit.
 * Clicking a slice (or its label) calls `onSelect`, so the donut can
 * double as a navigation aid.
 */
import { useMemo } from "react";
import type { ProjectSummary } from "../../lib/api";

export type DonutMetric = "runs" | "tokens" | "users" | "failures";

interface Props {
  projects: ProjectSummary[];
  /** Which field of ProjectSummary drives slice size + label values. */
  metric?: DonutMetric;
  selectedProjectId?: string;
  onSelect?: (projectId: string) => void;
  /**
   * Visual variant. "hero" gives a thicker ring + larger labels meant
   * for full-page display; "compact" tightens everything for an inline
   * dashboard card.
   */
  variant?: "hero" | "compact";
}

/** Per-metric copy and value-extractor — single source of truth so the
 *  center label, leader-line label, and slice value all stay aligned.
 *
 *  ⚠️ `centerLabel` MUST fit inside the donut's inner ring (currently
 *  2 × R_INNER = 168 viewBox units wide at fontSize 12 uppercase
 *  tracking-wide → roughly 14 characters max). Longer strings spill
 *  past the ring and look broken. The "Users" metric used to read
 *  "Users · summed per project" and overflowed; the nuance now lives
 *  in the metric-toggle tooltip on the page instead. */
const METRIC_META: Record<
  DonutMetric,
  {
    /** Pull the metric's value out of a ProjectSummary row. */
    getValue: (p: ProjectSummary) => number;
    /** Headline under the big number in the donut center. */
    centerLabel: string;
    /** Lower-case singular noun used in leader-line labels, e.g. "run". */
    unitSingular: string;
    /** Lower-case plural noun used in leader-line labels, e.g. "runs". */
    unitPlural: string;
  }
> = {
  runs: {
    getValue: (p) => p.runCount,
    centerLabel: "Total runs",
    unitSingular: "run",
    unitPlural: "runs",
  },
  tokens: {
    getValue: (p) => p.totalTokens,
    centerLabel: "Total tokens",
    unitSingular: "token",
    unitPlural: "tokens",
  },
  users: {
    getValue: (p) => p.uniqueUsers,
    centerLabel: "Users",
    unitSingular: "user",
    unitPlural: "users",
  },
  failures: {
    getValue: (p) => p.failedRuns,
    centerLabel: "Failed runs",
    unitSingular: "failure",
    unitPlural: "failures",
  },
};

/** Compact human-readable formatter for big counts, e.g. 12345 → "12.3K". */
function fmtCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

// Categorical palette — readable on both light and dark backgrounds.
const PALETTE = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
];

// Geometry: viewBox is fixed; the SVG scales to whatever container size
// the parent provides. Width is generous so outside labels never clip.
// Height is sized to fit ring + leader lines + one label row above and
// below — anything more is wasted padding that makes the donut feel
// smaller and visually low in the card.
//
// Vertical content extent given R_OUTER=130, ELBOW_OFFSET=22, two-line
// labels (~26 tall): roughly CY ± 165. With CY = H/2 = 200 that gives
// content from y=35 to y=365 — symmetric, ~35px breathing room each
// side, total H = 400.
const W = 820;
const H = 400;
const CX = W / 2;
const CY = H / 2;
const R_OUTER = 130;
const R_INNER = 84;
const ELBOW_OFFSET = 22; // distance from outer edge to leader-line elbow
const HORIZ_LEN = 38;    // horizontal segment of the leader line

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

/** SVG path for one donut slice between startAngle and endAngle (radians, 0 = right). */
function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startAngle: number,
  endAngle: number,
): string {
  const startOuter = polarToCartesian(cx, cy, rOuter, startAngle);
  const endOuter = polarToCartesian(cx, cy, rOuter, endAngle);
  const startInner = polarToCartesian(cx, cy, rInner, endAngle);
  const endInner = polarToCartesian(cx, cy, rInner, startAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${endInner.x} ${endInner.y}`,
    "Z",
  ].join(" ");
}

/** Full-ring path for the single-project edge case (avoids 0-length arc). */
function ringPath(cx: number, cy: number, rOuter: number, rInner: number): string {
  return [
    `M ${cx - rOuter} ${cy}`,
    `A ${rOuter} ${rOuter} 0 1 0 ${cx + rOuter} ${cy}`,
    `A ${rOuter} ${rOuter} 0 1 0 ${cx - rOuter} ${cy}`,
    `M ${cx - rInner} ${cy}`,
    `A ${rInner} ${rInner} 0 1 1 ${cx + rInner} ${cy}`,
    `A ${rInner} ${rInner} 0 1 1 ${cx - rInner} ${cy}`,
    "Z",
  ].join(" ");
}

/** Truncate text so SVG labels don't blow past the card edge. */
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function ProjectsDonut({
  projects,
  metric = "runs",
  selectedProjectId,
  onSelect,
  variant = "compact",
}: Props) {
  const meta = METRIC_META[metric];

  /** Colors are keyed by the project's position in the source `projects`
   *  array (which is sorted by runCount DESC server-side). We deliberately
   *  do NOT re-sort here when the metric changes — keeping a stable
   *  position-to-color mapping means the same project keeps the same
   *  slice color across metric toggles, so users can track "blue =
   *  project X" as they switch lenses.
   *
   *  Label positions are dodged per side: any two adjacent labels on the
   *  same side (left or right of the donut) closer than `MIN_LABEL_SPACING`
   *  in viewBox units are pushed apart vertically. This prevents
   *  collisions for slices whose midpoint angles cluster together
   *  (e.g. two tiny slices stacked near 12 o'clock). The elbow Y of the
   *  leader line shifts to the dodged Y so the line stays connected. */
  const { slices, total } = useMemo(() => {
    // Skip projects whose value for the current metric is zero — a
    // zero-width slice would just be a degenerate path. (Common case:
    // a project with no failures when metric === "failures".)
    const sliceable = projects
      .map((project, sourceIdx) => ({
        project,
        value: meta.getValue(project),
        color: PALETTE[sourceIdx % PALETTE.length]!,
      }))
      .filter((s) => s.value > 0);

    const total = sliceable.reduce((sum, s) => sum + s.value, 0);
    if (total === 0) return { slices: [], total: 0 };

    // Pass 1: angles + natural label position for every slice
    let cumulative = -Math.PI / 2; // start at 12 o'clock
    const slices = sliceable.map((s) => {
      const share = s.value / total;
      const startAngle = cumulative;
      const endAngle = startAngle + share * 2 * Math.PI;
      cumulative = endAngle;
      const midAngle = (startAngle + endAngle) / 2;
      const cos = Math.cos(midAngle);
      const sin = Math.sin(midAngle);
      // Natural Y is where the leader-line elbow would sit if there were
      // no collisions — straight out radially from the slice midpoint.
      const naturalLabelY = CY + (R_OUTER + ELBOW_OFFSET) * sin;
      return {
        ...s,
        startAngle,
        endAngle,
        share,
        midAngle,
        cos,
        sin,
        // `labelY` is mutated in the dodge pass below.
        labelY: naturalLabelY,
      };
    });

    // Pass 2: per-side label dodging. Two-line labels need ~30 viewBox
    // units to not overlap (hero) / ~26 (compact).
    const minLabelSpacing = variant === "hero" ? 32 : 26;
    const rightGroup = slices
      .filter((s) => s.cos >= 0)
      .sort((a, b) => a.labelY - b.labelY);
    const leftGroup = slices
      .filter((s) => s.cos < 0)
      .sort((a, b) => a.labelY - b.labelY);

    const dodgeDown = (group: typeof slices) => {
      for (let i = 1; i < group.length; i++) {
        const minY = group[i - 1]!.labelY + minLabelSpacing;
        if (group[i]!.labelY < minY) group[i]!.labelY = minY;
      }
    };
    dodgeDown(rightGroup);
    dodgeDown(leftGroup);

    return { slices, total };
  }, [projects, meta, variant]);

  if (total === 0) return null;

  const isSingleSlice = slices.length === 1;
  // Hero uses larger label text; compact stays tight.
  const labelMaxChars = variant === "hero" ? 24 : 20;
  const nameSize = variant === "hero" ? 15 : 13;
  const subSize = variant === "hero" ? 12 : 11;
  const totalSize = variant === "hero" ? 44 : 30;
  const totalLabelSize = variant === "hero" ? 12 : 10;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${meta.centerLabel} distribution across projects`}
    >
      {/* Slices */}
      {slices.map(({ project, value, share, startAngle, endAngle, color }) => {
        const isSelected = selectedProjectId === project.projectId;
        const isDimmed = !!selectedProjectId && !isSelected;
        const d = isSingleSlice
          ? ringPath(CX, CY, R_OUTER, R_INNER)
          : arcPath(CX, CY, R_OUTER, R_INNER, startAngle, endAngle);
        const unit = value === 1 ? meta.unitSingular : meta.unitPlural;
        return (
          <path
            key={`slice-${project.projectId}`}
            d={d}
            fill={color}
            fillRule="evenodd"
            opacity={isDimmed ? 0.3 : 1}
            className="cursor-pointer transition-opacity hover:opacity-90"
            onClick={() => onSelect?.(project.projectId)}
          >
            <title>
              {(project.projectName ?? project.projectId) +
                " · " + fmtCompact(value) + " " + unit + " · " +
                (share * 100).toFixed(1) + "%"}
            </title>
          </path>
        );
      })}

      {/* Leader lines + outside labels.
          We use the dodged `labelY` for the elbow + label, NOT the natural
          radial y — that's what prevents the two-near-12-o'clock-slices
          overlap. Start point stays anchored at the actual slice edge so
          the line still reads as "this slice → this label". */}
      {slices.map(({ project, value, share, cos, sin, color, labelY }) => {
        // slice edge → elbow (at dodged Y) → end of horizontal stub
        const startX = CX + R_OUTER * cos;
        const startY = CY + R_OUTER * sin;
        const elbowX = CX + (R_OUTER + ELBOW_OFFSET) * cos;
        const elbowY = labelY;
        const isRight = cos >= 0;
        const endX = isRight ? elbowX + HORIZ_LEN : elbowX - HORIZ_LEN;
        const endY = labelY;

        const labelX = isRight ? endX + 6 : endX - 6;
        const anchor = isRight ? "start" : "end";

        const name = truncate(project.projectName ?? project.projectId, labelMaxChars);
        const pct = (share * 100).toFixed(1);
        const isSelected = selectedProjectId === project.projectId;
        const isDimmed = !!selectedProjectId && !isSelected;

        return (
          <g
            key={`label-${project.projectId}`}
            className="cursor-pointer"
            opacity={isDimmed ? 0.4 : 1}
            onClick={() => onSelect?.(project.projectId)}
          >
            <polyline
              points={`${startX},${startY} ${elbowX},${elbowY} ${endX},${endY}`}
              fill="none"
              stroke={color}
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx={endX} cy={endY} r={2.5} fill={color} />
            {/* Line 1 — project name, bold */}
            <text
              x={labelX}
              y={endY - 6}
              textAnchor={anchor}
              dominantBaseline="middle"
              className="fill-current font-semibold text-xyne-fg-primary"
              style={{ fontSize: nameSize }}
            >
              {name}
            </text>
            {/* Line 2 — share + raw count, muted */}
            <text
              x={labelX}
              y={endY + 10}
              textAnchor={anchor}
              dominantBaseline="middle"
              className="fill-current text-xyne-fg-tertiary"
              style={{ fontSize: subSize }}
            >
              {pct}% · {fmtCompact(value)} {value === 1 ? meta.unitSingular : meta.unitPlural}
            </text>
          </g>
        );
      })}

      {/* Center label */}
      <text
        x={CX}
        y={CY - 10}
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-current font-bold text-xyne-fg-primary"
        style={{ fontSize: totalSize }}
      >
        {fmtCompact(total)}
      </text>
      <text
        x={CX}
        y={CY + (variant === "hero" ? 20 : 14)}
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-current font-medium uppercase tracking-wide text-xyne-fg-muted"
        style={{ fontSize: totalLabelSize }}
      >
        {meta.centerLabel}
      </text>
      <text
        x={CX}
        y={CY + (variant === "hero" ? 38 : 30)}
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-current text-xyne-fg-tertiary"
        style={{ fontSize: totalLabelSize }}
      >
        {/* Show "X of Y projects" when some are filtered out (zero value
            for the current metric, e.g. projects with no failures). */}
        {slices.length === projects.length
          ? `${projects.length} ${projects.length === 1 ? "project" : "projects"}`
          : `${slices.length} of ${projects.length} projects`}
      </text>
    </svg>
  );
}
