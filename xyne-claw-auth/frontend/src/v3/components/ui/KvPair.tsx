import type { ReactNode } from "react";

interface KvPairProps {
  label: string;
  children: ReactNode;
}

export function KvPair({ label, children }: KvPairProps) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[14px] text-xyne-fg-tertiary">{label}</dt>
      <dd className="text-[14px] text-xyne-fg-primary">{children}</dd>
    </div>
  );
}
