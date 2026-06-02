import { useEffect, useRef, useState } from "react";

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
}

interface TabsProps<T extends string = string> {
  items: TabItem<T>[];
  selected: T;
  onSelect: (id: T) => void;
  className?: string;
}

export function Tabs<T extends string = string>({
  items,
  selected,
  onSelect,
  className,
}: TabsProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const btn = buttonRefs.current.get(selected);
    const container = containerRef.current;
    if (!btn || !container) return;

    const containerRect = container.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();

    setIndicator({
      left: btnRect.left - containerRect.left,
      width: btnRect.width,
    });
    setReady(true);
  }, [selected]);

  return (
    <div
      ref={containerRef}
      data-id="tabs"
      className={[
        "relative flex shrink-0 items-center gap-1 border-b border-xyne-border-subtle",
        className ?? "",
      ].join(" ")}
    >
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          ref={(el) => {
            if (el) buttonRefs.current.set(id, el);
            else buttonRefs.current.delete(id);
          }}
          data-id={`tab-${id}`}
          onClick={() => onSelect(id)}
          className={[
            "relative flex items-center gap-1.5 px-3 pb-3 pt-3 text-[14px] font-medium transition-colors",
            selected === id
              ? "text-xyne-fg-primary"
              : "text-xyne-fg-tertiary hover:text-xyne-fg-secondary",
          ].join(" ")}
        >
          {Icon && <Icon size={14} />}
          {label}
        </button>
      ))}

      {indicator && (
        <span
          data-id="tabs-indicator"
          className={[
            "absolute bottom-0 h-0.5 rounded-full bg-xyne-brand",
            ready ? "transition-[left,width] duration-200 ease-out" : "",
          ].join(" ")}
          style={{ left: indicator.left, width: indicator.width }}
        />
      )}
    </div>
  );
}
