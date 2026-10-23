/**
 * Apply the resolved design system to the visual surfaces that are not design
 * runs (XYNE-66827): PDFs, HTML reports and email drafts.
 *
 * Two things this module exists to fix.
 *
 * One: every surface used to brand itself, or not, independently. A single
 * `resolveVisualBranding` means a PDF and an email drafted in the same run
 * cannot disagree about the brand's primary colour.
 *
 * Two: each surface can only act on the subset it understands, and the subsets
 * really are different. A PDF renderer takes CSS but no cascade from a
 * stylesheet it never loads; an email client drops `<style>` outright, so the
 * values have to land on `style=` attributes; an HTML report can take the whole
 * thing, DESIGN.md included. Handing all three the same blob would mean two of
 * them silently ignoring most of it.
 *
 * Token extraction is NOT reimplemented here — `designTokensFromTokensCss`
 * (XYNE-66832) already does it, and a second CSS parser would drift from the
 * one under test.
 */

import { designTokensFromTokensCss, type DesignTokenSet } from "./design-export.js";

/**
 * The resolved system as it travels on the run payload.
 *
 * Carried as structured data rather than prose because `agentConfig.designSystem`
 * only ever held the markdown, and a PDF cannot act on prose — it needs the
 * tokens. `origin` says which rule won: a conversation's own pin, the agent
 * default, or the pre-migration free text.
 */
export interface DesignSystemRef {
  id: string | null;
  name: string;
  designMd: string;
  tokensCss: string;
  origin: "conversation" | "agent" | "legacy";
}

const DESIGN_SYSTEM_ORIGINS = ["conversation", "agent", "legacy"] as const;

/** The ref arrives inside the dispatch payload, so it is validated before use
 *  rather than trusted. */
export function isDesignSystemRef(value: unknown): value is DesignSystemRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const ref = value as Record<string, unknown>;
  return (
    (ref["id"] === null || typeof ref["id"] === "string") &&
    typeof ref["name"] === "string" &&
    typeof ref["designMd"] === "string" &&
    typeof ref["tokensCss"] === "string" &&
    (DESIGN_SYSTEM_ORIGINS as readonly unknown[]).includes(ref["origin"])
  );
}

/**
 * The branding subset a non-design surface can act on.
 *
 * Flat, literal values — not `var()` references. A PDF renderer and an email
 * client both see this CSS without the document that declared the variables,
 * so a `var(--brand-primary)` would resolve to nothing.
 */
export interface VisualBranding {
  name?: string;
  primary?: string;
  /** Text drawn ON the primary fill — button labels. */
  onPrimary?: string;
  background?: string;
  surface?: string;
  text?: string;
  muted?: string;
  border?: string;
  /** Ready-to-use CSS stacks, already joined and safe inside a double-quoted
   *  `style=` attribute. */
  headingFont?: string;
  bodyFont?: string;
  monoFont?: string;
  radius?: string;
  /** The full prose contract. HTML reports only: a PDF or an email cannot act
   *  on "buttons use the primary colour for the main action". */
  designMd?: string;
}

export const EMPTY_VISUAL_BRANDING: VisualBranding = Object.freeze({});

/** Whether anything is actually brandable. An absent or empty system makes
 *  every injector below a no-op rather than a reformat. */
export function hasVisualBranding(branding: VisualBranding): boolean {
  return Boolean(
    branding.primary ??
      branding.background ??
      branding.surface ??
      branding.text ??
      branding.muted ??
      branding.border ??
      branding.headingFont ??
      branding.bodyFont ??
      branding.radius,
  );
}

/** Token-name aliases per slot. Names arrive already namespace-stripped by
 *  `designTokensFromTokensCss`, so `--brand-primary` is `primary` here. */
const SLOT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  onPrimary: ["on-primary", "primary-foreground", "primary-fg", "primary-contrast", "text-on-primary"],
  primary: ["primary", "brand", "accent", "cta", "secondary"],
  background: ["background", "bg", "page", "canvas", "backdrop", "base"],
  surface: ["surface", "surface-raised", "surface-default", "card", "panel"],
  text: ["text", "text-primary", "text-base", "text-default", "foreground", "fg", "ink", "body"],
  muted: ["muted", "text-muted", "muted-foreground", "text-secondary", "neutral", "fg-muted"],
  border: ["border", "line", "divider", "rule"],
};

/** First alias that matches wins, in alias order, so `primary` beats `accent`. */
function colorFor(tokens: DesignTokenSet, slot: keyof typeof SLOT_ALIASES): string | undefined {
  for (const alias of SLOT_ALIASES[slot] ?? []) {
    const hit = tokens.colors.find((color) => color.key === alias);
    if (hit) return hit.hex;
  }
  return undefined;
}

/**
 * A font stack that is safe inside `style="…"` and still valid CSS.
 *
 * `designTokensFromTokensCss` hands back families with their quotes stripped,
 * so a multi-word family arrives bare — `JetBrains Mono, monospace`. Browsers
 * accept that, but it is fragile, so multi-word families are re-quoted with
 * SINGLE quotes: a double quote would close the attribute on its first
 * character.
 */
const attributeSafeFont = (stack: readonly string[]): string =>
  stack
    .map((family) => family.replace(/["']/g, "").trim())
    .filter(Boolean)
    .map((family) => (/\s/.test(family) ? `'${family}'` : family))
    .join(", ");

/** The base radius: whichever of these is declared, else the first stated. */
const BASE_RADIUS_KEYS = ["base", "md", "default", "DEFAULT", "sm"];

function radiusFor(tokens: DesignTokenSet): string | undefined {
  for (const key of BASE_RADIUS_KEYS) {
    const hit = tokens.radii.find((item) => item.key === key);
    if (hit) return hit.value;
  }
  return tokens.radii[0]?.value;
}

/**
 * The one resolver every surface shares.
 *
 * Returns empty branding for an absent system, for a `legacy` system (which has
 * prose but no token CSS, so there is nothing a PDF can use), and for token CSS
 * that names nothing recognisable. `designMd` still comes through in all of
 * those, because the HTML surface can use prose even when there are no tokens.
 */
export function resolveVisualBranding(
  system: DesignSystemRef | null | undefined,
): VisualBranding {
  if (!system) return {};
  const tokens = designTokensFromTokensCss(system.tokensCss);
  const headingStack = tokens.fonts.find((font) => font.key === "heading")?.stack;
  const bodyStack = tokens.fonts.find((font) => font.key === "body")?.stack;
  const monoStack = tokens.fonts.find((font) => font.key === "mono")?.stack;

  const branding: VisualBranding = {};
  if (system.name.trim()) branding.name = system.name.trim();

  const primary = colorFor(tokens, "primary");
  const onPrimary = colorFor(tokens, "onPrimary");
  const background = colorFor(tokens, "background");
  const surface = colorFor(tokens, "surface");
  const text = colorFor(tokens, "text");
  const muted = colorFor(tokens, "muted");
  const border = colorFor(tokens, "border");
  const radius = radiusFor(tokens);

  if (primary) branding.primary = primary;
  // Falls back to the page background: white-on-primary is the overwhelmingly
  // common pairing, and a button with no label colour inherits body text, which
  // on a saturated fill is the unreadable case.
  const resolvedOnPrimary = onPrimary ?? background;
  if (resolvedOnPrimary) branding.onPrimary = resolvedOnPrimary;
  if (background) branding.background = background;
  if (surface) branding.surface = surface;
  if (text) branding.text = text;
  if (muted) branding.muted = muted;
  if (border) branding.border = border;
  if (headingStack?.length) branding.headingFont = attributeSafeFont(headingStack);
  if (bodyStack?.length) branding.bodyFont = attributeSafeFont(bodyStack);
  if (monoStack?.length) branding.monoFont = attributeSafeFont(monoStack);
  if (radius) branding.radius = radius;
  if (system.designMd.trim()) branding.designMd = system.designMd.trim();

  return branding;
}

/**
 * A value that cannot leave the place it is written.
 *
 * Checked HERE, at every emission site, not only where the tokens were parsed.
 * These values are written into a `<style>` block and into `style="…"`
 * attributes, and a value carrying `</style>` or a double quote escapes both: a
 * delivered HTML report gained a live `<script>`, and an email draft's link
 * gained an `onload` attribute. XYNE-66832 now refuses these characters when it
 * parses, which is the root fix — this is the guard that holds even for a
 * DesignSystemRef that did not come through that parser, and the ref arrives on
 * the run payload.
 *
 * A SINGLE quote is allowed, unlike in design-export's parser-side check:
 * attributeSafeFont deliberately adds them around a multi-word family, and a
 * `'` can neither close a double-quoted attribute nor open a tag. Everything
 * that can — `<>"` — and everything that can end a declaration or block —
 * `;{}` and a backslash — is refused rather than escaped, because no
 * legitimate colour, font stack or radius contains one.
 */
const isEmittableValue = (value: string): boolean => !/[;{}<>"\\]/.test(value);

const declarations = (pairs: ReadonlyArray<readonly [string, string | undefined]>): string =>
  pairs
    .filter((pair): pair is readonly [string, string] => Boolean(pair[1]))
    .filter(([, value]) => isEmittableValue(value))
    .map(([property, value]) => `${property}: ${value};`)
    .join(" ");

const rule = (selector: string, body: string): string => (body ? `${selector} { ${body} }` : "");

/**
 * Brand CSS as literal values.
 *
 * Shared by the PDF and report injectors. Variables are declared too, so a
 * report author can reference them, but every rule also carries the literal —
 * a PDF renderer that resolves no cascade still gets the colour.
 */
export function brandThemeCss(branding: VisualBranding): string {
  if (!hasVisualBranding(branding)) return "";
  const vars = declarations([
    ["--brand-primary", branding.primary],
    ["--brand-on-primary", branding.onPrimary],
    ["--brand-background", branding.background],
    ["--brand-surface", branding.surface],
    ["--brand-text", branding.text],
    ["--brand-muted", branding.muted],
    ["--brand-border", branding.border],
    ["--brand-radius", branding.radius],
    ["--brand-font-heading", branding.headingFont],
    ["--brand-font-body", branding.bodyFont],
  ]);

  return [
    rule(":root", vars),
    rule(
      "body",
      declarations([
        ["background-color", branding.background],
        ["color", branding.text],
        ["font-family", branding.bodyFont],
      ]),
    ),
    rule(
      "h1, h2, h3, h4, h5, h6",
      declarations([
        ["color", branding.text],
        ["font-family", branding.headingFont ?? branding.bodyFont],
      ]),
    ),
    rule("a", declarations([["color", branding.primary]])),
    rule("code, pre", declarations([["font-family", branding.monoFont]])),
    rule(
      "th",
      declarations([
        ["background-color", branding.surface],
        ["color", branding.text],
      ]),
    ),
    rule(
      "td, th",
      declarations([["border-color", branding.border]]),
    ),
    rule("hr", declarations([["border-color", branding.border]])),
    rule(
      "blockquote",
      declarations([
        ["border-left-color", branding.primary],
        ["color", branding.muted],
      ]),
    ),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * A system name reduced to characters that cannot do anything inside an HTML
 * comment.
 *
 * An allowlist, not an escape: the name reaches here from a model-written
 * `brand.json`, so `-->` is not the only thing worth keeping out — neutralising
 * the comment terminator alone still parked `<script>` tags in the delivered
 * file, which a reader would reasonably not expect to find there.
 */
const commentSafeName = (name: string): string =>
  name
    .replace(/[^\w .&()/-]+/g, " ")
    .replace(/-{2,}/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

const CLASS_ATTR = /class\s*=\s*"([^"]*)"/i;
const BUTTON_CLASS = /\b(?:btn|button|cta)\b/i;
const ROLE_BUTTON = /role\s*=\s*"button"/i;

const BRAND_STYLE_MARKER = "xyne-brand";
const brandStyleBlock = (css: string): string =>
  `<style data-${BRAND_STYLE_MARKER}="1">\n${css}\n</style>`;

/** Already branded — so a second pass is a no-op rather than a second block. */
const alreadyBranded = (html: string): boolean => html.includes(`data-${BRAND_STYLE_MARKER}=`);

/**
 * Put a style block where it wins over the document's own defaults but LOSES to
 * anything the author wrote afterwards.
 *
 * Immediately after the first `</style>`, which in a built report is the
 * template's base CSS — so the brand overrides the template and an
 * agent-supplied theme still overrides the brand. With no style block at all it
 * goes before `</head>`, and failing that it is prepended, so a fragment is
 * still branded rather than silently skipped.
 */
function insertAfterBaseStyles(html: string, block: string): string {
  const firstClose = html.toLowerCase().indexOf("</style>");
  if (firstClose >= 0) {
    const at = firstClose + "</style>".length;
    return `${html.slice(0, at)}\n  ${block}${html.slice(at)}`;
  }
  const headClose = html.toLowerCase().indexOf("</head>");
  if (headClose >= 0) return `${html.slice(0, headClose)}  ${block}\n${html.slice(headClose)}`;
  return `${block}\n${html}`;
}

/**
 * Brand a PDF's HTML.
 *
 * Appended as CSS rather than rewriting the template's own declarations: the
 * create-pdf template hardcodes `font-family: Arial`, `color: #333` and a
 * handful of greys, and matching those strings would break the moment someone
 * edits the template. A later rule with the same specificity wins, which is all
 * this needs.
 *
 * Tokens only — `designMd` is deliberately not used. A renderer cannot act on
 * "keep tables scannable".
 */
export function injectPdfBrandTokens(html: string, branding: VisualBranding): string {
  if (!html || !hasVisualBranding(branding) || alreadyBranded(html)) return html;
  const css = brandThemeCss(branding);
  if (!css) return html;
  return insertAfterBaseStyles(html, brandStyleBlock(css));
}

/**
 * Brand an HTML report.
 *
 * Same placement, and the same reason it matters more here: `create-report`
 * lets an agent supply its own `themeCss`, which the template emits after the
 * base block. Sitting between the two means the brand is the default and the
 * agent's own CSS still wins — which is the behaviour an agent that bothered to
 * write a theme expects.
 *
 * `designMd` rides along as an HTML comment so a human reading the delivered
 * file can see which system it was built against. It is not rendered.
 */
export function injectHtmlReportTheme(html: string, branding: VisualBranding): string {
  if (!html || alreadyBranded(html)) return html;
  const css = brandThemeCss(branding);
  if (!css) return html;
  const attribution = branding.name
    ? `\n  <!-- Built against the "${commentSafeName(branding.name)}" design system. -->`
    : "";
  return insertAfterBaseStyles(html, `${brandStyleBlock(css)}${attribution}`);
}

/** Per-tag declarations for the email pass. */
interface InlineRule {
  /** Opening-tag matcher. */
  pattern: RegExp;
  decls: ReadonlyArray<readonly [string, string | undefined]>;
}

/** Merge declarations into a tag's `style` attribute.
 *
 *  An author's own declaration for the same property WINS: this is branding a
 *  draft someone may already have styled, not restyling it. */
function mergeStyle(openTag: string, decls: string): string {
  if (!decls) return openTag;
  const existing = /(\sstyle\s*=\s*")([^"]*)(")/i.exec(openTag);
  if (!existing) {
    // Self-closing tags keep their slash.
    return openTag.replace(/\s*\/?>$/, (end) => ` style="${decls}"${end.trim()}`);
  }
  const authored = existing[2] ?? "";
  const authoredProperties = new Set(
    authored
      .split(";")
      .map((part) => part.split(":")[0]?.trim().toLowerCase())
      .filter(Boolean),
  );
  const additions = decls
    .split(/;\s*/)
    .filter(Boolean)
    .filter((decl) => {
      const property = decl.split(":")[0]?.trim().toLowerCase();
      return property ? !authoredProperties.has(property) : false;
    })
    .map((decl) => (decl.endsWith(";") ? decl : `${decl};`))
    .join(" ");
  if (!additions) return openTag;
  const merged = `${authored.trim()}${authored.trim() && !authored.trim().endsWith(";") ? ";" : ""} ${additions}`.trim();
  return openTag.replace(existing[0], `${existing[1]}${merged}${existing[3]}`);
}

/**
 * Brand an email draft by setting `style` attributes.
 *
 * Gmail and Outlook strip `<style>` blocks, so a stylesheet is not an option
 * here — the values have to be on the elements. Hand-rolled rather than pulling
 * in an inliner: this needs a dozen properties on eight tags, not a CSS engine.
 *
 * Buttons are matched before plain links, so a `.btn` anchor gets the fill
 * treatment rather than just a coloured label.
 */
export function injectEmailBrandStyles(html: string, branding: VisualBranding): string {
  if (!html || !hasVisualBranding(branding)) return html;

  const buttonDecls = declarations([
    ["background-color", branding.primary],
    ["color", branding.onPrimary],
    ["border-radius", branding.radius],
    ["font-family", branding.bodyFont],
    ["text-decoration", branding.primary ? "none" : undefined],
  ]);
  const bodyDecls = declarations([
    ["background-color", branding.background],
    ["color", branding.text],
    ["font-family", branding.bodyFont],
  ]);
  const textDecls = declarations([
    ["color", branding.text],
    ["font-family", branding.bodyFont],
  ]);
  const headingDecls = declarations([
    ["color", branding.text],
    ["font-family", branding.headingFont ?? branding.bodyFont],
  ]);
  const linkDecls = declarations([["color", branding.primary]]);
  const mutedDecls = declarations([["color", branding.muted]]);

  // A button is an <a> or <button> carrying a btn-ish class or role. Checked
  // first so the plain-link rule below cannot claim it.
  //
  // The class value is pulled out before being tested, rather than matched in
  // one pattern. `[^"]*\b(btn|…)\b[^"]*"` has two unbounded classes competing
  // either side of the keyword, which backtracks on a long class list that
  // does not contain one — the same polynomial shape CodeQL flagged elsewhere
  // in this series.
  const buttonish = (tag: string): boolean =>
    ROLE_BUTTON.test(tag) || BUTTON_CLASS.test(CLASS_ATTR.exec(tag)?.[1] ?? "");

  let out = html;
  const apply = (pattern: RegExp, decide: (tag: string) => string) => {
    out = out.replace(pattern, (tag) => mergeStyle(tag, decide(tag)));
  };

  apply(/<body\b[^>]*>/gi, () => bodyDecls);
  apply(/<(?:h[1-6])\b[^>]*>/gi, () => headingDecls);
  apply(/<button\b[^>]*>/gi, () => buttonDecls);
  apply(/<a\b[^>]*>/gi, (tag) => (buttonish(tag) ? buttonDecls : linkDecls));
  apply(/<(?:table|td|th|p|li|div|span)\b[^>]*>/gi, (tag) =>
    buttonish(tag) ? buttonDecls : textDecls,
  );
  apply(/<(?:small|footer)\b[^>]*>/gi, () => mutedDecls);

  return out;
}
