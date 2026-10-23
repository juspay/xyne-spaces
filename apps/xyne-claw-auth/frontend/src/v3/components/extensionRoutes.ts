import type { ComponentType } from "react";
import type { Icon } from "@phosphor-icons/react";

/** A page the private extension adds: its route under /v3, and a sidebar entry in the Admin group when adminOnly. */
export interface RouteExtension {
  path: string;
  label: string;
  icon: Icon;
  adminOnly?: boolean;
  Component: ComponentType<{ userId: string }>;
}

const modules = import.meta.glob<{ default: RouteExtension }>("../extensions/routes/*.tsx", { eager: true });

export const extensionRoutes: RouteExtension[] = Object.values(modules)
  .map((module) => module.default)
  .filter((route): route is RouteExtension => Boolean(route) && typeof route.path === "string" && typeof route.Component === "function");
