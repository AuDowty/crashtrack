import * as React from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

/** Stack-frame skeleton: header line + optional file/source block. */
export function FrameSkeleton({ withSource = false }: { withSource?: boolean }) {
  return (
    <div className="flex gap-3">
      <Skeleton className="size-4 mt-1" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="h-3 w-3/4" />
        {withSource && (
          <Skeleton className="h-32 w-full mt-2" />
        )}
      </div>
    </div>
  );
}

/** Card with header + content skeleton. */
export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="rounded-lg border bg-card p-6 space-y-3">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-3 w-48" />
      <div className="space-y-2 pt-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </div>
  );
}
