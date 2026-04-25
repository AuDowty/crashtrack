import { lazy, Suspense, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMe, getProject, getStats, getTopModules, listGroups } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AppHeader } from "@/components/AppHeader";
import { timeAgo } from "@/lib/format";
import { Settings, AlertOctagon, Tags, Search } from "lucide-react";
import { useDocumentTitle } from "@/lib/title";
import { FullPageSkeleton, ProjectHomeSkeleton } from "@/components/skeletons";
import { ErrorPage } from "@/pages/ErrorPage";

// recharts is ~350KB — keep it out of the main bundle.
const CrashesChart = lazy(() =>
  import("@/components/CrashesChart").then((m) => ({ default: m.CrashesChart })),
);


export function ProjectHome() {
  const { slug = "" } = useParams();
  const { data: user, isPending: meLoading } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const [days, setDays] = useState<7 | 14 | 30 | 90>(14);
  const [status, setStatus] = useState<"open" | "resolved" | "ignored">("open");
  const [query, setQuery] = useState("");
  const projectQ = useQuery({
    queryKey: ["project", slug],
    queryFn: () => getProject(slug),
    enabled: !!user,
  });
  const statsQ = useQuery({
    queryKey: ["stats", slug, days],
    queryFn: () => getStats(slug, days),
    enabled: !!user,
  });
  const topModulesQ = useQuery({
    queryKey: ["top-modules", slug, days],
    queryFn: () => getTopModules(slug, days),
    enabled: !!user,
  });
  const groupsQ = useQuery({
    queryKey: ["groups", slug, status, query],
    queryFn: () => listGroups(slug, status, query || undefined),
    enabled: !!user,
  });

  // Hook calls MUST run on every render in the same order — keep them
  // above the conditional returns.
  useDocumentTitle(projectQ.data?.project.name ?? slug);

  if (meLoading) return <FullPageSkeleton />;
  if (!user) return <Navigate to="/" replace />;
  if (projectQ.isPending) return <ProjectHomeSkeleton user={user} />;
  if (projectQ.error) return <ErrorPage status={404} message={String(projectQ.error.message)} />;

  const p = projectQ.data!.project;
  const stats = statsQ.data?.stats ?? [];
  const total = statsQ.data?.total ?? 0;
  const topModules = topModulesQ.data?.modules ?? [];
  const groups = groupsQ.data?.groups ?? [];

  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <main className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{p.name}</h1>
            <p className="text-sm text-muted-foreground">{p.slug} · {p.platform}</p>
          </div>
          <div className="flex gap-2">
            <Link
              to={`/app/${p.slug}/releases`}
              className="inline-flex items-center gap-2 h-10 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <Tags className="size-4" /> releases
            </Link>
            <Link
              to={`/app/${p.slug}/settings`}
              className="inline-flex items-center gap-2 h-10 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <Settings className="size-4" /> settings
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="md:col-span-2">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">last {days} days</CardTitle>
                  <CardDescription>{total} crash{total === 1 ? "" : "es"} total</CardDescription>
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

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">top crashing modules</CardTitle>
              <CardDescription>by crash count</CardDescription>
            </CardHeader>
            <CardContent>
              {topModules.length === 0 ? (
                <p className="text-sm text-muted-foreground">no data yet</p>
              ) : (
                <ul className="space-y-2">
                  {topModules.map((m) => {
                    const max = topModules[0]!.count;
                    const pct = (m.count / max) * 100;
                    return (
                      <li key={m.module} className="text-xs space-y-1">
                        <div className="flex justify-between font-mono">
                          <span className="truncate">{m.module}</span>
                          <span className="text-muted-foreground">{m.count}</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded overflow-hidden">
                          <div
                            className="h-full bg-destructive/70"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <section>
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              groups
            </h2>
            <div className="flex items-center gap-2 flex-1 justify-end">
              <div className="relative max-w-xs flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="filter by code / module / function"
                  className="pl-8 h-9 text-sm"
                />
              </div>
              <div className="flex rounded-md border bg-background">
                {(["open", "resolved", "ignored"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatus(s)}
                    className={`px-3 py-1.5 text-xs ${
                      status === s
                        ? "bg-accent text-accent-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {groupsQ.isPending && <p className="text-sm text-muted-foreground">loading...</p>}
          {!groupsQ.isPending && groups.length === 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">no {status} groups</CardTitle>
                <CardDescription>
                  {status === "open"
                    ? "integrate the crashtrack client with this project's api key. crashes will appear here as they're reported."
                    : `no groups have been marked ${status} yet.`}
                </CardDescription>
              </CardHeader>
            </Card>
          )}
          {groups.length > 0 && (
            <ul className="space-y-2">
              {groups.map((g) => (
                <li key={g.id}>
                  <Link to={`/app/${p.slug}/groups/${g.id}`}>
                    <Card className="hover:bg-accent/40 transition-colors">
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
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
