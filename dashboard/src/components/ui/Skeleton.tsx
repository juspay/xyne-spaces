import * as React from 'react';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

function Skeleton({ className, ...props }: SkeletonProps): React.JSX.Element {
  return <div className={`animate-pulse rounded-md bg-gray-200 ${className}`} {...props} />;
}

export { Skeleton };
export type { SkeletonProps };
