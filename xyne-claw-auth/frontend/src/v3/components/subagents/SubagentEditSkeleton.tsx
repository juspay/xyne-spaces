import { Skeleton } from "../ui/Skeleton";

export function SubagentEditSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-xyne-surface">
      {/* Header bar skeleton */}
      <div className="flex shrink-0 items-center gap-3 border-b border-xyne-border-subtle px-5 py-3">
        <Skeleton className="h-7 w-7 rounded-lg" />
        <Skeleton className="h-4 w-32" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-8 w-20 rounded-lg" />
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        {/* Left column skeleton */}
        <div className="flex w-[300px] shrink-0 flex-col gap-4 border-r border-xyne-border p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-full rounded-lg" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-full rounded-lg" />
          <div className="mt-auto">
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        </div>
        {/* Right column skeleton */}
        <div className="flex flex-1 flex-col gap-3 p-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
