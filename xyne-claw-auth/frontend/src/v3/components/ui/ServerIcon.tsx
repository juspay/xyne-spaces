import { useState } from "react";

// Per-type overrides. Source URLs are served by Vite from `public/assets/mcp/`
// at runtime — never `import` them as modules; Vite doesn't resolve files
// inside `public/` through the module graph.

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
  const [failed, setFailed] = useState(false);
  const ext = MCP_ICON_EXT[type] ?? "svg";
  const bg = MCP_ICON_BG[type] ?? "bg-xyne-surface-subtle";
  const src = `/claw/assets/mcp/${type}.${ext}`;
  const { wrapper, img } = SIZE_CLASS[size];

  return (
    <div
      data-id="server-icon"
      className={`flex shrink-0 items-center justify-center rounded-md ${wrapper} ${bg}`}
    >
      {failed ? (
        <span className="text-[10px] font-bold text-xyne-fg-secondary">
          {type.slice(0, 2).toUpperCase()}
        </span>
      ) : (
        <img
          src={src}
          alt={type}
          style={{ width: img, height: img, display: "block" }}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
