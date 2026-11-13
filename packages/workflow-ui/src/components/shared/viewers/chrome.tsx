import { Loader2 } from 'lucide-react';

// Shared centered loading state for the lazy document viewers.
export function ViewerLoading() {
  return (
    <div className="flex h-[40vh] items-center justify-center text-[var(--wui-fg-muted)]">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}
