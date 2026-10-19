import type { ComponentType } from "react";

export interface PrivateAdminTab {
  id: string;
  label: string;
  Component: ComponentType<{ userId: string }>;
}

const modules = import.meta.glob<{ default: PrivateAdminTab }>("../private/admin-tabs/*.tsx", { eager: true });

export const privateAdminTabs: PrivateAdminTab[] = Object.values(modules)
  .map((module) => module.default)
  .filter((tab): tab is PrivateAdminTab => Boolean(tab) && typeof tab.id === "string" && typeof tab.Component === "function");
