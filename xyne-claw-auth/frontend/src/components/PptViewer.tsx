import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { SlidePptConfig } from "../lib/api";

// 16:9 slide is 10in × 5.625in. Render at 96dpi for readability.
const SLIDE_WIDTH_IN = 10;
const SLIDE_HEIGHT_IN = 5.625;
const DPI = 96;
const CANVAS_W = SLIDE_WIDTH_IN * DPI; // 960
const CANVAS_H = SLIDE_HEIGHT_IN * DPI; // 540

type Dict = Record<string, unknown>;

function num(v: unknown, fallback: number): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && !isNaN(Number(v))) return Number(v);
  return fallback;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function hex(v: unknown, fallback?: string): string | undefined {
  const s = str(v);
  if (!s) return fallback;
  return /^#/.test(s) ? s : `#${s}`;
}

function backgroundFor(slide: Dict): string | undefined {
  const bg = slide["background"];
  if (!bg) return undefined;
  if (typeof bg === "string") return hex(bg);
  if (typeof bg === "object") return hex((bg as Dict)["color"]);
  return undefined;
}

function textRuns(obj: Dict): Array<{ text: string; options: Dict }> {
  const raw = obj["text"];
  if (Array.isArray(raw)) {
    return raw.map((r) => ({
      text: String((r as Dict)["text"] ?? (r as Dict)["value"] ?? ""),
      options: ((r as Dict)["options"] as Dict) ?? {},
    }));
  }
  return [{ text: String(raw ?? obj["value"] ?? ""), options: {} }];
}

function flexAlign(align: unknown): "flex-start" | "center" | "flex-end" {
  const a = str(align);
  if (a === "center") return "center";
  if (a === "right") return "flex-end";
  return "flex-start";
}

function flexValign(valign: unknown): "flex-start" | "center" | "flex-end" {
  const v = str(valign);
  if (v === "middle") return "center";
  if (v === "bottom") return "flex-end";
  return "flex-start";
}

function SlideCanvas({ slide }: { slide: Dict }) {
  const bg = backgroundFor(slide);
  const items = (slide["objects"] ?? slide["elements"] ?? slide["content"] ?? []) as Dict[];

  return (
    <div
      className="relative overflow-hidden rounded-md shadow-xl"
      style={{
        width: CANVAS_W,
        height: CANVAS_H,
        backgroundColor: bg ?? "#ffffff",
      }}
    >
      {items.map((obj, i) => (
        <ObjectLayer key={i} obj={obj} />
      ))}
    </div>
  );
}

function ObjectLayer({ obj }: { obj: Dict }) {
  const type = String(obj["type"] ?? "").toLowerCase();
  const opts = (obj["options"] as Dict) ?? {};
  const x = num(opts["x"], 0) * DPI;
  const y = num(opts["y"], 0) * DPI;
  const w = num(opts["w"], 1) * DPI;
  const h = num(opts["h"], 0.5) * DPI;

  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: x,
    top: y,
    width: w,
    height: h,
  };

  switch (type) {
    case "text":
      return <TextLayer obj={obj} opts={opts} style={baseStyle} />;
    case "shape":
    case "rect":
    case "rectangle":
      return <ShapeLayer opts={opts} style={baseStyle} obj={obj} />;
    case "image":
      return <PlaceholderLayer style={baseStyle} label="Image" detail={str(opts["path"]) ?? str(obj["src"]) ?? str(obj["url"])} />;
    case "chart":
      return <PlaceholderLayer style={baseStyle} label={`${String(obj["chart_type"] ?? obj["chartType"] ?? "Chart").toUpperCase()} chart`} />;
    case "table":
      return <TableLayer obj={obj} opts={opts} style={baseStyle} />;
    case "notes":
      return null; // notes render below the canvas
    default:
      return null;
  }
}

function TextLayer({ obj, opts, style }: { obj: Dict; opts: Dict; style: React.CSSProperties }) {
  const runs = textRuns(obj);
  const color = hex(opts["color"], "#000000");
  const baseFontSize = num(opts["fontSize"], 14);
  const valign = flexValign(opts["valign"]);
  const align = flexAlign(opts["align"]);
  const fontFace = str(opts["fontFace"]) ?? str(opts["font"]);

  return (
    <div
      style={{
        ...style,
        display: "flex",
        flexDirection: "column",
        justifyContent: valign,
        alignItems: "stretch",
        color,
        fontFamily: fontFace,
        fontSize: baseFontSize,
        fontWeight: opts["bold"] ? 700 : 400,
        fontStyle: opts["italic"] ? "italic" : undefined,
        padding: 2,
        overflow: "hidden",
        lineHeight: 1.15,
      }}
    >
      {runs.map((run, i) => {
        const rOpts = run.options ?? {};
        const bullet = rOpts["bullet"];
        const bulletChar = bullet ? "• " : "";
        const paraAfter = num(rOpts["paraSpaceAfter"], 0);
        return (
          <div
            key={i}
            style={{
              textAlign: align === "center" ? "center" : align === "flex-end" ? "right" : "left",
              color: hex(rOpts["color"], color) ?? color,
              fontSize: num(rOpts["fontSize"], baseFontSize),
              fontWeight: rOpts["bold"] ? 700 : opts["bold"] ? 700 : 400,
              fontStyle: rOpts["italic"] ? "italic" : undefined,
              marginBottom: paraAfter,
              letterSpacing: num(rOpts["charSpacing"], 0) / 100,
            }}
          >
            {bulletChar}
            {run.text}
          </div>
        );
      })}
    </div>
  );
}

function ShapeLayer({ opts, style, obj }: { opts: Dict; style: React.CSSProperties; obj: Dict }) {
  const fill = (opts["fill"] as Dict | string | undefined);
  const fillColor = typeof fill === "string" ? hex(fill) : hex((fill as Dict)?.["color"]);
  const fillTransparency = typeof fill === "object" ? num((fill as Dict)?.["transparency"], 0) : 0;
  const line = opts["line"] as Dict | string | undefined;
  const lineColor = typeof line === "string" ? hex(line) : hex((line as Dict)?.["color"]);

  const shapeKey = String(obj["shape"] ?? obj["shape_type"] ?? "RECTANGLE").toUpperCase();
  const radius = shapeKey === "ROUNDED_RECTANGLE" ? Math.max(num(opts["rectRadius"], 0.1) * DPI, 6) : 0;
  const isOval = shapeKey === "OVAL";

  return (
    <div
      style={{
        ...style,
        backgroundColor: fillColor,
        opacity: fillTransparency ? 1 - fillTransparency / 100 : 1,
        border: lineColor ? `1px solid ${lineColor}` : undefined,
        borderRadius: isOval ? "50%" : radius,
      }}
    />
  );
}

function TableLayer({ obj, opts, style }: { obj: Dict; opts: Dict; style: React.CSSProperties }) {
  const rowsRaw = (obj["rows"] ?? obj["data"] ?? []) as unknown[];
  const fontFace = str(opts["fontFace"]) ?? str(opts["font"]);
  return (
    <div style={{ ...style, overflow: "hidden", fontFamily: fontFace }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11 }}>
        <tbody>
          {rowsRaw.map((row, ri) => {
            if (!Array.isArray(row)) return null;
            return (
              <tr key={ri}>
                {row.map((cell, ci) => {
                  const c = (typeof cell === "object" && cell ? (cell as Dict) : { text: String(cell) });
                  const cOpts = (c["options"] as Dict) ?? {};
                  const fill = cOpts["fill"] as Dict | string | undefined;
                  const bg = typeof fill === "string" ? hex(fill) : hex((fill as Dict)?.["color"]);
                  return (
                    <td
                      key={ci}
                      style={{
                        border: "1px solid #e0e0e0",
                        backgroundColor: bg,
                        color: hex(cOpts["color"], "#000000"),
                        fontWeight: cOpts["bold"] ? 700 : 400,
                        fontSize: num(cOpts["fontSize"], 11),
                        textAlign: (str(cOpts["align"]) as "left" | "center" | "right" | undefined) ?? "left",
                        padding: "4px 8px",
                      }}
                    >
                      {String(c["text"] ?? c["value"] ?? "")}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PlaceholderLayer({ style, label, detail }: { style: React.CSSProperties; label: string; detail?: string }) {
  return (
    <div
      style={{
        ...style,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        backgroundColor: "#f3f4f6",
        border: "1px dashed #9ca3af",
        color: "#6b7280",
        fontSize: 12,
        padding: 6,
        textAlign: "center",
        overflow: "hidden",
      }}
    >
      <div style={{ fontWeight: 600 }}>{label}</div>
      {detail && <div style={{ fontSize: 10, opacity: 0.8, marginTop: 2, wordBreak: "break-all" }}>{detail}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

interface Props {
  config: SlidePptConfig;
  fileName: string;
  onClose: () => void;
}

export function PptViewer({ config, fileName, onClose }: Props) {
  const [idx, setIdx] = useState(0);
  const slides = useMemo(() => config.slides ?? [], [config]);
  const count = slides.length;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIdx((i) => Math.min(i + 1, count - 1));
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [count, onClose]);

  if (count === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
        <div className="rounded-lg bg-zinc-900 p-6 text-sm text-zinc-300">
          No slides to display.
          <button onClick={onClose} className="ml-4 rounded bg-zinc-700 px-3 py-1 text-xs hover:bg-zinc-600">Close</button>
        </div>
      </div>
    );
  }

  const slide = slides[idx] as Dict;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4 py-2 text-sm text-zinc-200">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{config.title ?? fileName}</span>
          <span className="shrink-0 text-[11px] text-zinc-500">·</span>
          <span className="shrink-0 text-[11px] text-zinc-500">{fileName}</span>
        </div>
        <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100" title="Close (Esc)">
          <X size={16} />
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-auto p-6">
        <div style={{ transform: "scale(1)", transformOrigin: "center" }}>
          <SlideCanvas slide={slide} />
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-950 px-4 py-2 text-sm text-zinc-300">
        <button
          onClick={() => setIdx((i) => Math.max(i - 1, 0))}
          disabled={idx === 0}
          className="flex items-center gap-1 rounded px-2 py-1 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={16} /> Prev
        </button>
        <div className="font-mono text-xs text-zinc-400">
          Slide {idx + 1} of {count}
        </div>
        <button
          onClick={() => setIdx((i) => Math.min(i + 1, count - 1))}
          disabled={idx === count - 1}
          className="flex items-center gap-1 rounded px-2 py-1 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
