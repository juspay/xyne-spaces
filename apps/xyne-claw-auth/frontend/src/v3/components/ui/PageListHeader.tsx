import type { ReactNode } from "react";
import {
  PlusIcon,
  MagnifyingGlassIcon,
  XIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";

/* ── Types ─────────────────────────────────────────────────────────── */

export interface StatBlock {
  value: number | string | undefined;
  label: string;
  highlight?: "success" | "warning" | "error" | null;
}

export interface FilterTab {
  key: string;
  label: string;
}

export interface PageListHeaderProps {
  title: string;
  /**
   * One-line, plain-English description rendered directly under the title.
   * Tells a first-time visitor what the page is for in words the rest of
   * the navigation doesn't (e.g. "Subagents" alone is jargon). Optional
   * — pages that opted out keep their old single-line header.
   */
  subtitle?: ReactNode;
  icon?: ReactNode;
  stats: StatBlock[];
  createLabel: string;
  onCreateClick: () => void;
  searchValue: string;
  onSearchChange: (val: string) => void;
  searchPlaceholder: string;
  tabs?: FilterTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  /**
   * Optional slot rendered to the right of the scope tabs in the filter bar.
   * Use for secondary filter chips (e.g. category filters) that should sit
   * "beside" the tabs rather than on a new row.
   */
  trailingFilters?: ReactNode;
  loading?: boolean;
  /** When true, the search bar is absolutely centered in the filter bar regardless of tab/chip widths. */
  centerSearch?: boolean;
}

/* ── Component ─────────────────────────────────────────────────────── */

export function PageListHeader({
  title,
  subtitle,
  icon = <SquaresFourIcon size={18} />,
  stats,
  createLabel,
  onCreateClick,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  tabs = [],
  activeTab,
  onTabChange,
  trailingFilters,
  loading = false,
  centerSearch = false,
}: PageListHeaderProps) {
  /* Stat block — used in two flavors:
       wide: stacked number-over-label, vertical dividers between
       narrow: compact inline pill in a meta-strip
     Extracted so the two layouts stay byte-for-byte consistent on token
     choice (highlight color, loading skeleton, label casing).            */
  const renderStatBlock = (stat: StatBlock, i: number) => (
    <div key={stat.label} className="flex items-center">
      {i > 0 && (
        <div className="w-[0.5px] h-[32px] bg-xyne-border mx-[20px] flex-shrink-0" />
      )}
      <div className="flex flex-col items-center gap-[3px] min-h-[32px] justify-center">
        {loading || stat.value === undefined ? (
          <span className="inline-block w-[28px] h-[18px] rounded-[4px] bg-xyne-surface-sunken animate-pulse" />
        ) : (
          <span
            className={`text-[20px] font-medium leading-none ${
              stat.highlight === "success"
                ? "text-xyne-success-fg"
                : stat.highlight === "warning"
                  ? "text-xyne-warning-fg"
                  : stat.highlight === "error"
                    ? "text-xyne-error-fg"
                    : "text-xyne-fg-primary"
            }`}
          >
            {stat.value}
          </span>
        )}
        <span className="text-[10px] font-medium uppercase tracking-[0.07em] text-xyne-fg-tertiary whitespace-nowrap">
          {stat.label}
        </span>
      </div>
    </div>
  );

  const renderStatInline = (stat: StatBlock, i: number) => (
    <span key={stat.label} className="inline-flex items-baseline gap-[5px] whitespace-nowrap">
      {i > 0 && <span className="text-xyne-fg-tertiary/50">·</span>}
      {loading || stat.value === undefined ? (
        <span className="inline-block w-[14px] h-[11px] rounded-[3px] bg-xyne-surface-sunken animate-pulse" />
      ) : (
        <span
          className={`font-medium tabular-nums ${
            stat.highlight === "success"
              ? "text-xyne-success-fg"
              : stat.highlight === "warning"
                ? "text-xyne-warning-fg"
                : stat.highlight === "error"
                  ? "text-xyne-error-fg"
                  : "text-xyne-fg-primary"
          }`}
        >
          {stat.value}
        </span>
      )}
      <span className="text-xyne-fg-tertiary lowercase">{stat.label}</span>
    </span>
  );

  return (
    /* `@container` makes this element the container-query root so we can
        switch layouts based on the *panel's* width, not the viewport.
        Pages with a slide-over (MCP, Channels, Skills, …) shrink the main
        panel to ~620px when their slide-over opens; below 720px we drop
        the large stat blocks in favor of a compact inline meta-strip so
        the primary CTA stays beside the title and the row reads as one
        clean unit instead of three chunky stacked rows. */
    <div className="flex flex-col flex-shrink-0 @container">
      <div className="px-[24px] py-[18px] bg-xyne-surface border-b border-xyne-border">
        {/* Row 1 — title cluster + right cluster.
            At wide widths the right cluster carries stats *and* button so
            everything sits on one line. At narrow widths only the button
            stays here (stats move to row 2) so the CTA reads as a primary
            affordance next to the title rather than getting buried below
            three stat blocks. */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-[8px] min-w-0">
            <span className="text-xyne-fg-secondary shrink-0 mt-[2px]">
              {icon}
            </span>
            <div className="flex min-w-0 flex-col gap-[3px]">
              <h1 className="text-[18px] font-medium text-xyne-fg-primary leading-none">
                {title}
              </h1>
              {subtitle && (
                <p className="text-[12px] leading-[1.4] text-xyne-fg-tertiary max-w-[640px]">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-shrink-0 items-start gap-[20px]">
            {/* Wide-only stat blocks */}
            <div className="hidden @min-[720px]:flex items-center">
              {stats.map((stat, i) => renderStatBlock(stat, i))}
            </div>

            <button
              onClick={onCreateClick}
              className="flex items-center gap-[6px] bg-xyne-fg-primary text-xyne-fg-inverse px-[16px] py-[9px] rounded-[8px] text-[13px] font-medium hover:opacity-90 transition-opacity flex-shrink-0 border-0 cursor-pointer font-sans"
            >
              <PlusIcon size={14} weight="bold" />
              {createLabel}
            </button>
          </div>
        </div>

        {/* Row 2 — compact stats strip, narrow only.
            Sits indented under the title (matches icon offset of 8+18 =
            ~26px) so it reads as a continuation of the title's metadata,
            not as a separate section. Inline mini-pills with bullets
            between them instead of stacked stat blocks. */}
        <div className="@min-[720px]:hidden mt-[10px] pl-[26px] flex flex-wrap items-baseline gap-x-[10px] gap-y-1 text-[12px]">
          {stats.map((stat, i) => renderStatInline(stat, i))}
        </div>
      </div>

      {/* Filter bar: [tabs] [search] [trailing filters]
          centerSearch=true → search is absolutely centered in the bar;
          tabs and trailing filters sit at edges without affecting center. */}
      <div className={`${centerSearch ? "relative" : "flex"} flex items-center gap-[10px] px-[24px] py-[10px] bg-xyne-surface border-b border-xyne-border`}>

        {/* Tabs — scope selector on the left */}
        {tabs.length > 0 && onTabChange && (
          <div className="flex items-center gap-[4px] flex-shrink-0 z-10">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => onTabChange(tab.key)}
                className={`px-[12px] py-[5px] rounded-[20px] text-[12px] cursor-pointer border transition-colors font-medium font-sans whitespace-nowrap ${
                  activeTab === tab.key
                    ? "bg-xyne-fg-primary text-xyne-fg-inverse border-xyne-fg-primary"
                    : "bg-transparent text-xyne-fg-secondary border-xyne-border hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Search */}
        <div className={`flex items-center gap-[8px] border rounded-[10px] px-[14px] transition-[border-color,box-shadow] ${
          centerSearch
            ? "absolute left-1/2 -translate-x-1/2 w-[380px] bg-white dark:bg-xyne-surface py-[9px] border-xyne-border-strong shadow-[0_2px_8px_rgba(0,0,0,0.08)] focus-within:border-xyne-brand focus-within:shadow-[0_2px_12px_rgba(0,0,0,0.12)]"
            : "flex-1 min-w-0 bg-xyne-surface py-[7px] border-xyne-border focus-within:border-xyne-brand"
        }`}>
          <MagnifyingGlassIcon
            size={15}
            className={`flex-shrink-0 ${centerSearch ? "text-xyne-fg-secondary" : "text-xyne-fg-tertiary"}`}
          />
          <input
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="flex-1 bg-transparent text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-tertiary focus:outline-none border-0 min-w-0 appearance-none focus:ring-0 ring-0 shadow-none"
          />
          {searchValue && (
            <button
              onClick={() => onSearchChange("")}
              className="text-xyne-fg-tertiary hover:text-xyne-fg-primary flex-shrink-0 cursor-pointer"
            >
              <XIcon size={12} />
            </button>
          )}
        </div>

        {/* Trailing filters on the right */}
        {trailingFilters && (
          <>
            {!centerSearch && tabs.length > 0 && onTabChange && (
              <div className="w-px h-[20px] bg-xyne-border mx-[2px] flex-shrink-0" />
            )}
            <div className={`flex items-center gap-[4px] flex-wrap flex-shrink-0 z-10 ${centerSearch ? "ml-auto" : ""}`}>
              {trailingFilters}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
