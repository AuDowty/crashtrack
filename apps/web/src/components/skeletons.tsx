import { AppHeader } from "@/components/AppHeader";
import { Skeleton, CardSkeleton, FrameSkeleton } from "@/components/ui/skeleton";
import type { User } from "@/lib/api";

/** Header-less page skeleton (used before user auth resolves). */
export function FullPageSkeleton() {
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-9 w-24" />
        </div>
      </header>
      <main className="max-w-5xl mx-auto p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <CardSkeleton rows={4} />
      </main>
    </div>
  );
}

export function AppHomeSkeleton({ user }: { user: User }) {
  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <main className="max-w-5xl mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-32" />
          <div className="flex gap-2">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-4 w-40" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      </main>
    </div>
  );
}

export function ProjectHomeSkeleton({ user }: { user: User }) {
  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <main className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-28" />
            <Skeleton className="h-10 w-28" />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2 rounded-lg border bg-card p-6 space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-48 w-full" />
          </div>
          <CardSkeleton rows={5} />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </main>
    </div>
  );
}

export function GroupDetailSkeleton({ user }: { user: User }) {
  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <main className="max-w-4xl mx-auto p-6 space-y-6">
        <Skeleton className="h-4 w-32" />
        <div className="flex items-start gap-3">
          <Skeleton className="size-6 rounded mt-1" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-3 w-80" />
          </div>
          <Skeleton className="h-9 w-24" />
        </div>

        <div className="rounded-lg border bg-card p-6 space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-3 w-72" />
          </div>
          <div className="space-y-3 pt-2">
            <FrameSkeleton withSource />
            <FrameSkeleton withSource />
            <FrameSkeleton />
            <FrameSkeleton />
            <FrameSkeleton />
          </div>
        </div>

        <CardSkeleton rows={3} />
      </main>
    </div>
  );
}

export function ProjectSettingsSkeleton({ user }: { user: User }) {
  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <main className="max-w-3xl mx-auto p-6 space-y-6">
        <Skeleton className="h-7 w-64" />
        <CardSkeleton rows={3} />
        <CardSkeleton rows={4} />
        <CardSkeleton rows={3} />
        <CardSkeleton rows={2} />
      </main>
    </div>
  );
}

export function FormPageSkeleton({ user }: { user: User }) {
  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <main className="max-w-xl mx-auto p-6">
        <CardSkeleton rows={5} />
      </main>
    </div>
  );
}
