import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircleIcon,
  XCircleIcon,
  WarningCircleIcon,
  InfoIcon,
  XIcon,
} from "@phosphor-icons/react";

// ── Types ─────────────────────────────────────────────────────────────

export type SnackbarVariant = "success" | "error" | "warning" | "info";

interface SnackbarItem {
  id: string;
  variant: SnackbarVariant;
  title: string;
  description?: string;
  duration?: number;
  /** Whether the item is in exit animation */
  exiting?: boolean;
}

interface SnackbarContextValue {
  show: (options: Omit<SnackbarItem, "id" | "exiting">) => string;
  dismiss: (id: string) => void;
}

// ── Context ───────────────────────────────────────────────────────────

const SnackbarContext = createContext<SnackbarContextValue | null>(null);

// ── Variant config ────────────────────────────────────────────────────

const VARIANT_CONFIG: Record<
  SnackbarVariant,
  { icon: ReactNode; wrapperClass: string; iconClass: string }
> = {
  success: {
    icon: <CheckCircleIcon size={16} weight="fill" />,
    wrapperClass:
      "border-xyne-success-border bg-xyne-success-bg text-xyne-success-fg",
    iconClass: "text-xyne-success",
  },
  error: {
    icon: <XCircleIcon size={16} weight="fill" />,
    wrapperClass:
      "border-xyne-error-border bg-xyne-error-bg text-xyne-error-fg",
    iconClass: "text-xyne-error",
  },
  warning: {
    icon: <WarningCircleIcon size={16} weight="fill" />,
    wrapperClass:
      "border-xyne-warning-border bg-xyne-warning-bg text-xyne-warning-fg",
    iconClass: "text-xyne-warning",
  },
  info: {
    icon: <InfoIcon size={16} weight="fill" />,
    wrapperClass:
      "border-xyne-info-border bg-xyne-info-bg text-xyne-info-fg",
    iconClass: "text-xyne-info",
  },
};

// ── Individual toast ──────────────────────────────────────────────────

function SnackbarToast({
  item,
  onDismiss,
}: {
  item: SnackbarItem;
  onDismiss: (id: string) => void;
}) {
  const { icon, wrapperClass, iconClass } = VARIANT_CONFIG[item.variant];
  const [visible, setVisible] = useState(false);

  // Trigger enter animation on mount
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      data-id="snackbar-toast"
      data-variant={item.variant}
      role={item.variant === "error" ? "alert" : "status"}
      aria-live={item.variant === "error" ? "assertive" : "polite"}
      className={[
        "flex w-[360px] max-w-[calc(100vw-32px)] items-start gap-3 rounded-xl border px-4 py-3 shadow-lg",
        "transition-all duration-300 ease-out",
        wrapperClass,
        visible && !item.exiting
          ? "translate-x-0 opacity-100"
          : "translate-x-4 opacity-0",
      ].join(" ")}
    >
      <span className={`mt-px shrink-0 ${iconClass}`}>{icon}</span>

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold leading-snug">{item.title}</p>
        {item.description && (
          <p className="mt-0.5 text-[12px] leading-relaxed opacity-80">
            {item.description}
          </p>
        )}
      </div>

      <button
        data-id="snackbar-dismiss"
        onClick={() => onDismiss(item.id)}
        className="mt-px shrink-0 rounded opacity-60 transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2"
        aria-label="Dismiss"
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}

// ── Provider ──────────────────────────────────────────────────────────

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<SnackbarItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    // Start exit animation
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, exiting: true } : item))
    );
    // Remove after animation completes
    const t = setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id));
      timers.current.delete(id);
    }, 300);
    timers.current.set(`exit-${id}`, t);
  }, []);

  const show = useCallback(
    (options: Omit<SnackbarItem, "id" | "exiting">) => {
      const id = Math.random().toString(36).slice(2);
      setItems((prev) => [...prev, { ...options, id }]);

      const duration = options.duration ?? 4000;
      if (duration > 0) {
        const t = setTimeout(() => dismiss(id), duration);
        timers.current.set(id, t);
      }
      return id;
    },
    [dismiss]
  );

  // Clean up all timers on unmount
  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((timer) => clearTimeout(timer));
  }, []);

  return (
    <SnackbarContext.Provider value={{ show, dismiss }}>
      {children}
      {createPortal(
        <div
          data-id="snackbar-stack"
          aria-label="Notifications"
          className="fixed bottom-4 right-4 z-[9999] flex flex-col-reverse gap-2"
        >
          {items.map((item) => (
            <SnackbarToast key={item.id} item={item} onDismiss={dismiss} />
          ))}
        </div>,
        document.body
      )}
    </SnackbarContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────

export function useSnackbar(): SnackbarContextValue {
  const ctx = useContext(SnackbarContext);
  if (!ctx) throw new Error("useSnackbar must be used inside SnackbarProvider");
  return ctx;
}
