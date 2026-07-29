import type { ReactNode } from "react";
import { Menu as BaseMenu } from "@base-ui-components/react/menu";
import { cn } from "../../../lib/utils";

/* ------------------------------------------------------------------ */
/*  Menu — token-styled wrapper around Base UI's Menu primitive         */
/*  The `trigger` prop receives Base UI's trigger props via render fn.  */
/* ------------------------------------------------------------------ */

type RenderProp = (
  props: React.HTMLAttributes<HTMLElement> & { ref?: React.Ref<HTMLElement> }
) => ReactNode;

interface MenuProps {
  /** Render-prop: receives Base UI's trigger props. Spread them on your trigger element. */
  trigger: RenderProp;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
}

export function Menu({
  trigger,
  children,
  side = "bottom",
  align = "end",
  sideOffset = 6,
}: MenuProps) {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger render={trigger as never} />

      <BaseMenu.Portal>
        <BaseMenu.Positioner side={side} align={align} sideOffset={sideOffset}>
          <BaseMenu.Popup
            data-id="menu-popup"
            className={cn(
              /* surface */
              // Cap height + scroll so a long options list (e.g. the admin
              // agent filter with hundreds of agents) scrolls inside the popup
              // instead of growing full-height and overflowing the viewport.
              "min-w-[160px] max-h-[min(70vh,24rem)] overflow-y-auto overflow-x-hidden",
              "rounded-[var(--comp-radius-lg)]",
              "bg-xyne-surface border border-xyne-border",
              "shadow-[var(--comp-shadow-lg)]",
              /* spacing */
              "p-1",
              /* animation */
              "origin-[var(--transform-origin)]",
              "transition-[transform,opacity]",
              "duration-[var(--comp-duration-normal)] ease-in",
              "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
              "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
              "outline-none",
            )}
          >
            {children}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

/* ------------------------------------------------------------------ */
/*  MenuItem                                                            */
/* ------------------------------------------------------------------ */

interface MenuItemProps {
  children: ReactNode;
  onSelect?: () => void;
  selected?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  disabled?: boolean;
}

export function MenuItem({
  children,
  onSelect,
  selected,
  leading,
  trailing,
  disabled,
}: MenuItemProps) {
  return (
    <BaseMenu.Item
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2",
        "rounded-[var(--comp-radius-md)] px-2.5 py-1.5",
        "text-[13px] leading-none",
        "text-xyne-fg-primary bg-transparent",
        "data-[highlighted]:bg-xyne-surface-subtle",
        selected && "font-medium",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        "transition-[background-color,color] duration-[var(--comp-duration-fast)] ease-in",
        "outline-none",
      )}
    >
      {leading && <span className="shrink-0">{leading}</span>}
      <span className="flex-1 truncate text-left">{children}</span>
      {trailing && <span className="shrink-0">{trailing}</span>}
    </BaseMenu.Item>
  );
}
