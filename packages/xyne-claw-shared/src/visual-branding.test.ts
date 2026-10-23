import { describe, expect, it } from "vitest";
import {
  brandThemeCss,
  hasVisualBranding,
  injectEmailBrandStyles,
  injectHtmlReportTheme,
  injectPdfBrandTokens,
  isDesignSystemRef,
  resolveVisualBranding,
  type DesignSystemRef,
  type VisualBranding,
} from "./visual-branding.js";

/**
 * Each surface takes a different subset, so the assertions differ by surface:
 * a PDF gets CSS, an email gets `style` attributes because its client drops
 * `<style>`, and a report gets CSS positioned so the agent's own theme still
 * wins. The empty-system case is tested on all three, because "no system" has
 * to mean "leave the document alone", not "reformat it with defaults".
 */

const TOKENS_CSS = `:root {
  --brand-primary: #0B5FFF;
  --on-primary: #FFFFFF;
  --brand-background: #FFFFFF;
  --brand-surface: #F7F7F7;
  --brand-text: #0A2540;
  --text-muted: #6B7280;
  --brand-border: #E5E7EB;
  --font-heading: Inter, system-ui, sans-serif;
  --font-body: Inter, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", monospace;
  --radius-md: 8px;
}`;

const SYSTEM: DesignSystemRef = {
  id: "ds-1",
  name: "Northwind",
  designMd: "# Northwind\n\n## Palette\n- Primary: #0B5FFF",
  tokensCss: TOKENS_CSS,
  origin: "conversation",
};

const BRANDING = resolveVisualBranding(SYSTEM);
const EMPTY = resolveVisualBranding(null);

/** `style="…"` of the first matching opening tag. */
const styleOf = (html: string, tag: string): string =>
  new RegExp(`<${tag}\\b[^>]*\\sstyle="([^"]*)"`, "i").exec(html)?.[1] ?? "";

describe("isDesignSystemRef", () => {
  it("accepts the shape the dispatch payload carries", () => {
    expect(isDesignSystemRef(SYSTEM)).toBe(true);
    expect(isDesignSystemRef({ ...SYSTEM, id: null })).toBe(true);
  });

  it("refuses anything else, because it arrives over the wire", () => {
    for (const value of [
      null,
      undefined,
      "ds-1",
      [],
      { ...SYSTEM, origin: "whatever" },
      { ...SYSTEM, tokensCss: 42 },
      { id: "ds-1" },
    ]) {
      expect(isDesignSystemRef(value)).toBe(false);
    }
  });
});

describe("resolveVisualBranding", () => {
  it("extracts the subset every surface shares", () => {
    expect(BRANDING).toEqual<VisualBranding>({
      name: "Northwind",
      primary: "#0B5FFF",
      onPrimary: "#FFFFFF",
      background: "#FFFFFF",
      surface: "#F7F7F7",
      text: "#0A2540",
      muted: "#6B7280",
      border: "#E5E7EB",
      headingFont: "Inter, system-ui, sans-serif",
      bodyFont: "Inter, system-ui, sans-serif",
      monoFont: "'JetBrains Mono', monospace",
      radius: "8px",
      designMd: SYSTEM.designMd,
    });
  });

  it("makes a quoted font stack safe to put in a style attribute", () => {
    // `"JetBrains Mono", monospace` would close a double-quoted attribute on
    // its first character.
    expect(BRANDING.monoFont).not.toContain('"');
    expect(BRANDING.monoFont).toBe("'JetBrains Mono', monospace");
  });

  it("falls back to the page background for text on the primary fill", () => {
    const noOnPrimary = resolveVisualBranding({
      ...SYSTEM,
      tokensCss: ":root { --brand-primary: #0B5FFF; --brand-background: #FFFFFF; }",
    });
    expect(noOnPrimary.onPrimary).toBe("#FFFFFF");
  });

  it("returns empty branding for no system at all", () => {
    expect(EMPTY).toEqual({});
    expect(hasVisualBranding(EMPTY)).toBe(false);
  });

  it("keeps DESIGN.md but reports no branding for a legacy system", () => {
    // A pre-migration system is prose with no token CSS. The HTML surface can
    // still use the prose; a PDF has nothing to apply.
    const legacy = resolveVisualBranding({
      id: null,
      name: "Design system",
      designMd: "Keep it plain.",
      tokensCss: "",
      origin: "legacy",
    });
    expect(legacy.designMd).toBe("Keep it plain.");
    expect(hasVisualBranding(legacy)).toBe(false);
  });

  it("reports no branding for token CSS that names nothing it recognises", () => {
    const unknown = resolveVisualBranding({
      ...SYSTEM,
      tokensCss: ":root { --transition-fast: 120ms ease; --z-modal: 400; }",
    });
    expect(hasVisualBranding(unknown)).toBe(false);
  });
});

describe("injectPdfBrandTokens", () => {
  const PDF_HTML = `<!DOCTYPE html>
<html><head><style>
  @page { size: A4; margin: 2cm; }
  body { font-family: Arial, sans-serif; color: #333; }
  h1 { font-size: 24pt; color: #1a1a1a; }
</style></head><body><h1>Report</h1><p>Body.</p></body></html>`;

  it("adds literal brand values after the template's own CSS", () => {
    const out = injectPdfBrandTokens(PDF_HTML, BRANDING);
    expect(out).toContain("#0B5FFF");
    expect(out).toContain("Inter, system-ui, sans-serif");
    // After the template block, so the later rule wins without having to match
    // and rewrite the template's hardcoded Arial and #333.
    expect(out.indexOf("Arial")).toBeLessThan(out.indexOf("#0B5FFF"));
    expect(out).toContain("Arial");
  });

  it("emits literal values, not var() references", () => {
    // A PDF renderer sees this CSS without the document that declared the
    // variables, so a var() would resolve to nothing.
    const out = injectPdfBrandTokens(PDF_HTML, BRANDING);
    const brandBlock = /<style data-xyne-brand="1">([\s\S]*?)<\/style>/.exec(out)?.[1] ?? "";
    expect(brandBlock).toContain("color: #0A2540;");
    expect(brandBlock).not.toMatch(/color:\s*var\(/);
  });

  it("leaves the body content untouched", () => {
    const out = injectPdfBrandTokens(PDF_HTML, BRANDING);
    expect(out).toContain("<h1>Report</h1><p>Body.</p>");
  });

  it("is a no-op with no branding, and on an empty document", () => {
    expect(injectPdfBrandTokens(PDF_HTML, EMPTY)).toBe(PDF_HTML);
    expect(injectPdfBrandTokens("", BRANDING)).toBe("");
  });

  it("is idempotent", () => {
    const once = injectPdfBrandTokens(PDF_HTML, BRANDING);
    expect(injectPdfBrandTokens(once, BRANDING)).toBe(once);
  });

  it("still brands a fragment with no head or style block", () => {
    const out = injectPdfBrandTokens("<h1>Bare</h1>", BRANDING);
    expect(out).toContain("data-xyne-brand");
    expect(out).toContain("<h1>Bare</h1>");
  });
});

describe("injectHtmlReportTheme", () => {
  /** What create-report's template emits: base CSS, then the agent's theme. */
  const REPORT_HTML = `<!DOCTYPE html>
<html><head>
  <style>body { font-family: system-ui; color: #111; }</style>
  <style>body { color: #FF00FF; }</style>
</head><body><h1>Q3</h1></body></html>`;

  it("sits between the base CSS and the agent's own theme", () => {
    const out = injectHtmlReportTheme(REPORT_HTML, BRANDING);
    const base = out.indexOf("system-ui");
    const brand = out.indexOf("data-xyne-brand");
    const agent = out.indexOf("#FF00FF");
    expect(base).toBeLessThan(brand);
    // The agent wrote a theme on purpose, so it still wins the cascade.
    expect(brand).toBeLessThan(agent);
  });

  it("does not remove or alter the agent's CSS", () => {
    const out = injectHtmlReportTheme(REPORT_HTML, BRANDING);
    expect(out).toContain("<style>body { color: #FF00FF; }</style>");
  });

  it("declares variables as well as literals, so a report author can use them", () => {
    const out = injectHtmlReportTheme(REPORT_HTML, BRANDING);
    expect(out).toContain("--brand-primary: #0B5FFF;");
  });

  it("records which system it was built against, without rendering it", () => {
    const out = injectHtmlReportTheme(REPORT_HTML, BRANDING);
    expect(out).toContain("<!-- Built against the \"Northwind\" design system. -->");
  });

  it("cannot be broken out of by a system name containing comment syntax", () => {
    const hostile = resolveVisualBranding({
      ...SYSTEM,
      name: "Evil --> <script>alert(1)</script> <!--",
    });
    const out = injectHtmlReportTheme(REPORT_HTML, hostile);
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("-->  <");
  });

  it("is a no-op with no branding, and idempotent", () => {
    expect(injectHtmlReportTheme(REPORT_HTML, EMPTY)).toBe(REPORT_HTML);
    const once = injectHtmlReportTheme(REPORT_HTML, BRANDING);
    expect(injectHtmlReportTheme(once, BRANDING)).toBe(once);
  });
});

describe("injectEmailBrandStyles", () => {
  const EMAIL_HTML = `<body>
  <table><tr><td><h1>Welcome</h1><p>Thanks for joining.</p></td></tr></table>
  <a class="btn" href="https://x.test/start">Start now</a>
  <a href="https://x.test/docs">Read the docs</a>
  <small>You are receiving this because you signed up.</small>
</body>`;

  it("puts every value on a style attribute, not in a style block", () => {
    // Gmail and Outlook strip <style>, so anything left in a block is lost.
    const out = injectEmailBrandStyles(EMAIL_HTML, BRANDING);
    expect(out).not.toContain("<style");
    expect(styleOf(out, "body")).toContain("background-color: #FFFFFF;");
    expect(styleOf(out, "body")).toContain("color: #0A2540;");
    expect(styleOf(out, "table")).toContain("font-family: Inter, system-ui, sans-serif;");
    expect(styleOf(out, "h1")).toContain("color: #0A2540;");
    expect(styleOf(out, "small")).toContain("color: #6B7280;");
  });

  it("gives a button the fill treatment and a plain link only a colour", () => {
    const out = injectEmailBrandStyles(EMAIL_HTML, BRANDING);
    const button = /<a class="btn"[^>]*style="([^"]*)"/.exec(out)?.[1] ?? "";
    expect(button).toContain("background-color: #0B5FFF;");
    expect(button).toContain("color: #FFFFFF;");
    expect(button).toContain("border-radius: 8px;");

    const link = /<a href="https:\/\/x.test\/docs"[^>]*style="([^"]*)"/.exec(out)?.[1] ?? "";
    expect(link).toBe("color: #0B5FFF;");
    expect(link).not.toContain("background-color");
  });

  it("leaves an author's own declaration alone and adds only what is missing", () => {
    // Branding a draft someone already styled, not restyling it.
    const authored = `<body><p style="color: #FF0000">Red on purpose.</p></body>`;
    const out = injectEmailBrandStyles(authored, BRANDING);
    const paragraph = styleOf(out, "p");
    expect(paragraph).toContain("color: #FF0000");
    expect(paragraph).not.toContain("#0A2540");
    expect(paragraph).toContain("font-family: Inter, system-ui, sans-serif;");
  });

  it("does not produce an attribute that closes early on a quoted font stack", () => {
    const monoOnly = resolveVisualBranding({
      ...SYSTEM,
      tokensCss: ':root { --brand-text: #111111; --font-body: "JetBrains Mono", monospace; }',
    });
    const out = injectEmailBrandStyles("<body><p>Hi</p></body>", monoOnly);
    expect(out).toContain("font-family: 'JetBrains Mono', monospace;");
    expect(out).not.toContain('font-family: "JetBrains');
  });

  it("keeps a self-closing tag self-closing", () => {
    const out = injectEmailBrandStyles('<body><hr /><img src="x.png" /></body>', BRANDING);
    expect(out).toContain("<hr />");
    expect(out).toContain('<img src="x.png" />');
  });

  it("is a no-op with no branding, and idempotent", () => {
    expect(injectEmailBrandStyles(EMAIL_HTML, EMPTY)).toBe(EMAIL_HTML);
    const once = injectEmailBrandStyles(EMAIL_HTML, BRANDING);
    expect(injectEmailBrandStyles(once, BRANDING)).toBe(once);
  });

  it("does not use DESIGN.md, which an email client cannot act on", () => {
    const out = injectEmailBrandStyles(EMAIL_HTML, BRANDING);
    expect(out).not.toContain("Northwind");
    expect(out).not.toContain("## Palette");
  });
});

describe("a value cannot leave where it is written", () => {
  /** What a model-written tokens.css could carry before XYNE-66832 refused
   *  these characters. Constructed as a ref directly, which is how one arrives
   *  on the run payload — so this guard has to hold on its own. */
  const hostile = resolveVisualBranding({
    id: "x",
    name: "Acme",
    designMd: "",
    origin: "agent",
    tokensCss:
      ':root{--brand-primary:#2563EB;--radius-md:8px" onload="alert(1);' +
      "--font-body:Inter</style><script>alert(2)</script>}",
  });

  it("does not let a font value close the brand style block", () => {
    // This put a live <script> in a delivered HTML report.
    const report = injectHtmlReportTheme(
      "<html><head><style>body{}</style></head><body><h1>Q3</h1></body></html>",
      hostile,
    );
    expect(report).not.toContain("<script>");
    expect(report).not.toContain("</style><script");
    const pdf = injectPdfBrandTokens(
      "<html><head><style>body{}</style></head><body>x</body></html>",
      hostile,
    );
    expect(pdf).not.toContain("<script>");
  });

  it("does not let a radius value close a style attribute", () => {
    // This added an onload attribute to a link in an email draft sent from the
    // user's own mailbox.
    const email = injectEmailBrandStyles('<body><a class="btn" href="/x">Go</a></body>', hostile);
    expect(email).not.toContain("onload");
    expect(email).not.toContain('style="background-color: #2563EB; border-radius: 8px"');
  });

  it("still emits the safe declarations around a refused one", () => {
    const email = injectEmailBrandStyles('<body><a class="btn" href="/x">Go</a></body>', hostile);
    expect(email).toContain("background-color: #2563EB;");
  });
});

describe("brandThemeCss", () => {
  it("is empty when there is nothing to apply", () => {
    expect(brandThemeCss(EMPTY)).toBe("");
    expect(brandThemeCss({ designMd: "prose only" })).toBe("");
  });

  it("omits a rule whose every value is absent", () => {
    const linkOnly = brandThemeCss({ primary: "#0B5FFF" });
    expect(linkOnly).toContain("a { color: #0B5FFF; }");
    expect(linkOnly).not.toContain("body {");
    expect(linkOnly).not.toContain("code, pre {");
  });
});
