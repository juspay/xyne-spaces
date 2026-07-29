import type { ReactNode } from "react";
import { HealthStrip } from "./HealthStrip";
import { useSystemHealth } from "../../hooks/useSystemHealth";

interface PageLayoutProps {
  header: ReactNode;
  filterTab?: ReactNode;
  body: ReactNode;
  footer?: ReactNode;
  showHealthStrip?: boolean;
}

export function PageLayout({
  header,
  filterTab,
  body,
  footer,
  showHealthStrip = false,
}: PageLayoutProps) {
  const { health } = useSystemHealth();

  return (
    <div data-id="page-layout" className="flex h-full flex-col overflow-hidden">
      <div data-id="page-layout-header" className="shrink-0">
        {header}
      </div>

      {showHealthStrip && (
        <HealthStrip status={health.status} message={health.message} />
      )}

      {filterTab && (
        <div data-id="page-layout-filter-tab" className="shrink-0 px-xyne-4 pt-xyne-4 pb-xyne-2">
          {filterTab}
        </div>
      )}

      <div data-id="page-layout-body" className="flex-1 overflow-x-hidden overflow-y-auto p-xyne-2">
        {body}
      </div>

      {footer && (
        <div data-id="page-layout-footer" className="shrink-0 border-t border-xyne-border-subtle">
          {footer}
        </div>
      )}
    </div>
  );
}
