import { describe, expect, it } from "vitest";
import { buildHtmlDocument, extractThemeStyles, sanitizeHtmlBody, sanitizeThemeCss } from "./template.js";
import { createHtmlReportTool } from "./tools.js";

function decodeReport(result: string): string {
  const [, base64] = result.split("\n");
  return Buffer.from(base64 ?? "", "base64").toString("utf8");
}

describe("extractThemeStyles", () => {
  it("pulls style blocks out of the markdown and leaves code fences alone", () => {
    const md = '<style>.hero { color: red; }</style>\n# Report\n\n```html\n<style>.doc { x: 1 }</style>\n```\n<STYLE media="print">.p { a: b }</STYLE>';
    const out = extractThemeStyles(md);
    expect(out.css).toBe(".hero { color: red; }\n.p { a: b }");
    expect(out.markdown).toContain("```html\n<style>.doc { x: 1 }</style>\n```");
    expect(out.markdown).not.toContain(".hero");
  });
});

describe("sanitizeThemeCss", () => {
  it("keeps selectors and rules, including child combinators and safe inline images", () => {
    const css = ".doc > h2 { color: #123; background: url(data:image/png;base64,iVBORw0KGgo=); }";
    expect(sanitizeThemeCss(css)).toBe(css);
  });

  it("drops anything that could leave the style element or reach the network", () => {
    const out = sanitizeThemeCss(
      '@import url("https://evil.example/x.css"); .a { background: url(https://evil.example/p.png); } </style><script>alert(1)</script> .b { width: expression(alert(1)); behavior: url(x.htc); } .c { background: url("data:image/svg+xml;base64,PHN2Zz4="); }',
    );
    expect(out).not.toMatch(/@import|evil\.example|<|expression\(|behavior|svg\+xml/i);
    expect(out).toContain(".a { background: none; }");
  });
});

describe("buildHtmlDocument", () => {
  it("emits the theme after the default stylesheet so it overrides it", () => {
    const html = buildHtmlDocument({ title: "t", body: "<p>x</p>", themeCss: ".doc { color: red; }" });
    const defaultAt = html.indexOf("<style>");
    const themeAt = html.indexOf("<style>.doc { color: red; }</style>");
    expect(themeAt).toBeGreaterThan(defaultAt);
    expect(buildHtmlDocument({ title: "t", body: "" }).match(/<style>/g)).toHaveLength(1);
  });
});

describe("create-html-report with a theme", () => {
  it("keeps the theme and its class names while the body stays sanitized", async () => {
    const result = await createHtmlReportTool.execute({
      title: "RCA",
      summary: "IAM denied CreatePolicy.",
      detailsMarkdown:
        '<style>.editorial h2 { font-family: Georgia; } .callout > p { margin: 0; }</style>\n\n<section class="editorial"><h2>Cause</h2><div class="callout" style="color:red" onclick="x()"><p>Denied</p></div></section>\n\n<script>alert(1)</script>',
    }, {} as never);
    const html = decodeReport(String(result));
    expect(html).toContain("<style>.editorial h2 { font-family: Georgia; } .callout > p { margin: 0; }</style>");
    expect(html).toContain('<section class="editorial">');
    expect(html).toContain('<div class="callout">');
    expect(html).not.toMatch(/onclick|<script|style="color/);
  });

  it("is unchanged for reports without a style block", async () => {
    const result = await createHtmlReportTool.execute({ title: "Plain", summary: "s", detailsMarkdown: "# Hi\n\ntext" }, {} as never);
    expect(decodeReport(String(result)).match(/<style>/g)).toHaveLength(1);
    expect(sanitizeHtmlBody("<style>.x{}</style><p>a</p>")).toBe("<p>a</p>");
  });
});
