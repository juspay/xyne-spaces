import { useState, type ReactElement } from "react";
import {
  HashIcon,
  TicketIcon,
  FileTextIcon,
  PhoneIcon,
  BookOpenIcon,
  FolderIcon,
  PulseIcon,
  PaperclipIcon,
  CaretLeftIcon,
} from "@phosphor-icons/react";
import { cn } from "../../lib/utils";

/** A read-only attached-context item. Kept loose (`type: string`) because the
 *  persisted list can carry backend-only kinds (collection/folder/file) beyond
 *  the composer's channel/ticket/canvas/call. */
export interface ReadonlyContextItem {
  type: string;
  id: string;
  title: string;
}

/** Icon per attached-context type — mirrors the composer's pill row so a chip
 *  reads the same in the transcript as it did when the user attached it. */
function iconForType(type: string): ReactElement {
  const props = { size: 13, weight: "regular" as const, className: "shrink-0 text-xyne-fg-muted" };
  switch (type) {
    case "channel":
      return <HashIcon {...props} />;
    case "ticket":
      return <TicketIcon {...props} />;
    case "canvas":
      return <FileTextIcon {...props} />;
    case "call":
      return <PhoneIcon {...props} />;
    case "collection":
      return <BookOpenIcon {...props} />;
    case "folder":
      return <FolderIcon {...props} />;
    case "file":
      return <FileTextIcon {...props} />;
    case "activity":
    default:
      return <PulseIcon {...props} />;
  }
}

/** One read-only pill in the horizontal strip. */
function Pill({ item }: { item: ReadonlyContextItem }): ReactElement {
  return (
    <div
      className="flex h-6 max-w-[150px] flex-shrink-0 items-center gap-1 rounded-md border border-xyne-border-subtle bg-xyne-surface-subtle px-1.5"
      title={item.title}
    >
      {iconForType(item.type)}
      <span className="truncate text-[11.5px] font-medium text-xyne-fg-primary">{item.title}</span>
    </div>
  );
}

/**
 * Collapsed, read-only summary of the context a user attached to a turn.
 * Rendered BELOW the user message so the attached context survives a reload
 * (persisted per message in claw-auth).
 *
 * Shows a compact chip — paperclip + item count + caret. Clicking it expands, to
 * the LEFT of the chip, into a single-line horizontally-scrollable strip of
 * read-only pills (right-aligned, so it grows left and scrolls horizontally
 * rather than wrapping). Mirrors the Ask AI (Spaces dashboard) design.
 */
export function ReadonlyContextPills({
  items,
  className,
  expandedWidthClass = "max-w-[28rem]",
}: {
  items: ReadonlyContextItem[];
  className?: string;
  /** Tailwind max-width for the expanded scrollable strip (surface-specific). */
  expandedWidthClass?: string;
}): ReactElement | null {
  const [open, setOpen] = useState(false);

  if (!items || items.length === 0) return null;

  return (
    <div className={cn("flex items-center justify-end gap-1", className)}>
      {open && (
        <div
          className={cn(
            "flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            expandedWidthClass,
          )}
        >
          {items.map((item, index) => (
            <Pill key={`${item.type}-${item.id}-${index}`} item={item} />
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={`${items.length} attached context ${items.length === 1 ? "item" : "items"}`}
        className="flex h-6 flex-shrink-0 items-center gap-1 rounded-md border border-xyne-border-subtle bg-xyne-surface-subtle px-1.5 text-[11.5px] font-medium text-xyne-fg-muted transition-colors hover:border-xyne-border-strong hover:bg-xyne-surface hover:text-xyne-fg-primary"
      >
        <PaperclipIcon size={12} className="shrink-0" />
        <span>{items.length}</span>
        <CaretLeftIcon
          size={12}
          className={cn("shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>
    </div>
  );
}
