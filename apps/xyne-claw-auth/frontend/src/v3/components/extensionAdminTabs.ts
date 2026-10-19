import type { ComponentType } from "react";

export interface AdminTabExtension {
  id: string;
  label: string;
  Component: ComponentType<{ userId: string }>;
}

const modules = import.meta.glob<{ default: AdminTabExtension }>("../extensions/admin-tabs/*.tsx", { eager: true });

export const extensionAdminTabs: AdminTabExtension[] = Object.values(modules)
  .map((module) => module.default)
  .filter((tab): tab is AdminTabExtension => Boolean(tab) && typeof tab.id === "string" && typeof tab.Component === "function");
