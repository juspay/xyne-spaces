import { Skeleton } from "../ui/Skeleton";

export function DigitalTwinSkeleton() {
  return (
    <div className="flex flex-col gap-[16px] px-[20px] py-[12px]">
      <Skeleton className="h-[80px] rounded-xl" />
      <Skeleton className="h-[40px] rounded-lg" />
      <div className="grid grid-cols-2 gap-[8px] sm:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-[72px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-[200px] rounded-lg" />
    </div>
  );
}
