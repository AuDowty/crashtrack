import { lazy, Suspense, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getPublicGroups, getPublicProject, getPublicStats } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { timeAgo } from "@/lib/format";
import { AlertOctagon, Eye } from "lucide-react";
import { useDocumentTitle } from "@/lib/title";
import { Skeleton } from "@/components/ui/skeleton";

const CrashesChart = lazy(() =>
  import("@/components/CrashesChart").then((m) => ({ default: m.CrashesChart })),
);

export function PublicDashboard() {
  const { slug = "" } = useParams();
  useDocumentTitle(slug);
  const [days, setDays] = useState<7 | 14 | 30 | 90>(14);

  const projectQ = useQuery({
    queryKey: ["public-project", slug],
    queryFn: () => getPublicProject(slug),
  });
  const statsQ = useQuery({
    queryKey: ["public-stats", slug, days],
    queryFn: () => getPublicStats(slug, days),
    enabled: !!projectQ.data,
  });
  const groupsQ = useQuery({
    queryKey: ["public-groups", slug],
    queryFn: () => getPublicGroups(slug),
    enabled: !!projectQ.data,
  });

  if (projectQ.isPending) {
    return (
      <div className="min-h-screen">
        <header className="border-b">
          <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-4 w-32" />
          </div>
        </header>
        <main className="max-w-5xl mx-auto p-6 space-y-6">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </main>
      </div>
    );
  }
  if (!projectQ.data) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-lg font-medium">no public dashboard for this project</p>
          <p className="text-sm text-muted-foreground">
            either the slug doesn't exist or its owner hasn't made it public.
          </p>
        </div>
      </main>
    );
  }

  const p = projectQ.data.project;
  const stats = statsQ.data?.stats ?? [];
  const total = statsQ.data?.total ?? 0;
  const groups = groupsQ.data?.groups ?? [];

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="text-lg font-semibold">crashtrack</a>
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <Eye className="size-3.5" /> public dashboard
          </span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">{p.name}</h1>
          <p className="text-sm text-muted-foreground">{p.slug} · {p.platform}</p>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">last {days} days</CardTitle>
                <CardDescription>{total} crash{total === 1 ? "" : "es"}</CardDescription>
              </div>
              <div className="flex rounded-md border bg-background">
                {([7, 14, 30, 90] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    className={`px-3 py-1.5 text-xs ${
                      days === d
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<div className="h-48" />}>
              <CrashesChart data={stats} />
            </Suspense>
          </CardContent>
        </Card>

        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">
            open groups
          </h2>
          {groups.length === 0 ? (
            <Card>
              <CardHeader>
                <CardDescription>no open crash groups.</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <ul className="space-y-2">
              {groups.map((g) => (
                <li key={g.id}>
                  <Card>
                    <CardContent className="p-4 flex items-center gap-4">
                      <AlertOctagon className="size-5 text-destructive shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-sm truncate">
                          {g.exception_code ?? "unknown"} {g.top_module && `· ${g.top_module}`}
                          {g.top_function && (
                            <span className="text-muted-foreground">{g.top_function}</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {g.count} event{g.count === 1 ? "" : "s"} · last seen {timeAgo(g.last_seen_at)}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="text-xs text-muted-foreground text-center pt-4">
          dashboard powered by <a href="/" className="underline">crashtrack</a>
        </footer>
      </main>
    </div>
  );
}
