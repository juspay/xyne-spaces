import DOMPurify from 'dompurify';

/**
 * Only http(s) links, in-document fragments (`#id`) and scheme-less relative URLs
 * survive. Every other scheme — `javascript:`, `data:`, `vbscript:`, `mailto:`, … —
 * is rejected. DOMPurify strips whitespace/control characters from the value before
 * testing it, so obfuscations such as `java\tscript:` or leading spaces are covered.
 *
 * Per RFC 3986 a URI has a scheme iff a `:` appears before the first `/`, `?` or `#`,
 * so the second branch accepts only values with no colon in that leading segment.
 */
export const D2_SAFE_URI_REGEXP = /^(?:https?:|[^:/?#]*(?:[/?#]|$))/i;

/**
 * Sanitize a D2-compiled SVG before it is cached or injected via dangerouslySetInnerHTML.
 *
 * D2 source arrives from chat/markdown (any member, any app with chat:write, or agent
 * output), and the compiler copies `link:` values verbatim into `<a href>` in the SVG.
 * rehype-sanitize runs on the markdown AST before the SVG exists, so it cannot see these
 * anchors. Without this pass a `link: "javascript:..."` shape executes on click in the
 * dashboard origin (XYNE-65425).
 *
 * Config mirrors sanitizeMermaidSvg (foreignObject kept as an HTML integration point so
 * D2 markdown labels render) and additionally restricts link schemes to http(s).
 * <script>, on* handlers, <animate>/<set> href rewrites and unsafe URIs are removed.
 */
export const sanitizeD2Svg = (svg: string): string =>
  DOMPurify.sanitize(svg, {
    ADD_TAGS: ['foreignobject'],
    ADD_ATTR: ['dominant-baseline'],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    ALLOWED_URI_REGEXP: D2_SAFE_URI_REGEXP,
  });
