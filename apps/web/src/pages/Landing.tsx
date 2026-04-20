import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Github, AlertOctagon, Users, Eye, Bell, ArrowRight } from "lucide-react";
import { useDocumentTitle } from "@/lib/title";
import { fetchMe, getSiteStats } from "@/lib/api";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export function Landing() {
  useDocumentTitle();
  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 60_000,
  });
  const { data: stats } = useQuery({
    queryKey: ["site-stats"],
    queryFn: getSiteStats,
    staleTime: 5 * 60_000,
  });

  const signedIn = !!user;

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="text-lg font-semibold">crashtrack</span>
          <div className="flex items-center gap-4 text-sm">
            <Link to="/docs" className="text-muted-foreground hover:text-foreground">
              docs
            </Link>
            <a
              href="https://github.com/AuDowty/crashtrack"
              className="text-muted-foreground hover:text-foreground"
            >
              github
            </a>
            {signedIn ? (
              <Link
                to="/app"
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                open app <ArrowRight className="size-4" />
              </Link>
            ) : (
              <a
                href={`${API_BASE}/api/auth/github`}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Github className="size-4" /> sign in
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-16 space-y-20">
        <section className="text-center space-y-6 max-w-2xl mx-auto">
          <h1 className="text-5xl font-bold tracking-tight">
            crash reporting for native windows apps
          </h1>
          <p className="text-lg text-muted-foreground">
            open source. self-hostable. free. a sentry alternative built for indie game devs,
            tauri/electron native shells, and oss windows maintainers.
          </p>
          <div className="flex justify-center gap-3 pt-2">
            {signedIn ? (
              <Link
                to="/app"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                go to your dashboard <ArrowRight className="size-4" />
              </Link>
            ) : (
              <a
                href={`${API_BASE}/api/auth/github`}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Github className="size-4" /> sign in with github
              </a>
            )}
            <Link
              to="/docs"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-input bg-background px-6 text-sm font-medium hover:bg-accent"
            >
              read the docs
            </Link>
          </div>
        </section>

        <section className="grid grid-cols-3 gap-6 max-w-3xl mx-auto">
          <Stat label="developers" value={stats?.users} />
          <Stat label="active projects" value={stats?.active_projects} sub="last 30d" />
          <Stat label="crashes processed" value={stats?.crashes_processed} />
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground text-center mb-8">
            features
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <Feature
              icon={<AlertOctagon className="size-5" />}
              title="dedup grouping"
              body="crashes are grouped by exception + module + offset — ASLR-stable, same bug across runs collapses into one issue."
            />
            <Feature
              icon={<Users className="size-5" />}
              title="teams + orgs"
              body="invite by github username. members share projects, owners manage everything."
            />
            <Feature
              icon={<Eye className="size-5" />}
              title="public dashboards"
              body="toggle a project public and anyone can view its crash trends — no signups, no api keys."
            />
            <Feature
              icon={<Bell className="size-5" />}
              title="slack + discord webhooks"
              body="get pinged on the first sighting of a new crash group. configure per-project."
            />
          </div>
        </section>

        <section className="border rounded-lg p-6 bg-card">
          <h2 className="text-sm font-medium mb-3">three lines of rust to start</h2>
          <pre className="text-sm font-mono overflow-x-auto whitespace-pre">{`crashtrack::install(Config {
  api_key:  "ct_pk_...",
  app:      "myapp",
  version:  env!("CARGO_PKG_VERSION"),
  endpoint: "https://api.crashtrack.dev",
})?;`}</pre>
          <p className="text-xs text-muted-foreground mt-3">
            published on{" "}
            <a className="underline" href="https://crates.io/crates/crashtrack">
              crates.io
            </a>{" "}
            · windows-only · MIT
          </p>
        </section>

        <footer className="text-xs text-muted-foreground text-center border-t pt-6">
          MIT licensed ·{" "}
          <a className="underline" href="https://github.com/AuDowty/crashtrack">
            github.com/AuDowty/crashtrack
          </a>
        </footer>
      </main>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | undefined; sub?: string }) {
  return (
    <div className="text-center space-y-1">
      <div className="text-3xl font-semibold tabular-nums">
        {value === undefined ? (
          <span className="inline-block h-9 w-20 bg-muted animate-pulse rounded" />
        ) : (
          value.toLocaleString()
        )}
      </div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label} {sub && <span className="normal-case lowercase">· {sub}</span>}
      </div>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="space-y-2">
      <div className="text-foreground">{icon}</div>
      <h3 className="font-medium text-sm">{title}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}
