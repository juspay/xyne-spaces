import { useEffect, useState } from "react";

// Source URLs are served by Vite from `public/assets/mcp/` at runtime — never
// `import` them as modules; Vite doesn't resolve files inside `public/`
// through the module graph.

// Per-type ext override — the extension tried FIRST. Otherwise we prefer the
// logo.dev PNG, then fall back to a legacy SVG.
const MCP_ICON_EXT: Record<string, string> = {
  microsoft: "png",
};

const MCP_ICON_BG: Record<string, string> = {
  "xyne-spaces": "bg-transparent",
};

const SIZE_CLASS = {
  sm: { wrapper: "h-6 w-6", img: 16 },
  md: { wrapper: "h-8 w-8", img: 20 },
  lg: { wrapper: "h-12 w-12", img: 32 },
} as const;

export function ServerIcon({ type, size = "md" }: { type: string; size?: "sm" | "md" | "lg" }) {
  // Try png → svg → initials, matching the connector cards' McpIconBox so the
  // dialog and detail sidebar show the same logo.dev assets.
  const preferred = MCP_ICON_EXT[type];
  const exts = preferred
    ? [preferred, ...["png", "svg"].filter((e) => e !== preferred)]
    : ["png", "svg"];

  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [type]);

  const bg = MCP_ICON_BG[type] ?? "bg-xyne-surface-subtle";
  const { wrapper, img } = SIZE_CLASS[size];
  const src = idx < exts.length ? `/claw/assets/mcp/${type}.${exts[idx]}` : null;

  return (
    <div
      data-id="server-icon"
      className={`flex shrink-0 items-center justify-center rounded-md ${wrapper} ${bg}`}
    >
      {src ? (
        <img
          key={src}
          src={src}
          alt={type}
          className="object-contain"
          style={{ width: img, height: img, display: "block" }}
          onError={() => setIdx((i) => i + 1)}
        />
      ) : (
        <span className="text-[10px] font-bold text-xyne-fg-secondary">
          {type.slice(0, 2).toUpperCase()}
        </span>
      )}
    </div>
  );
}
