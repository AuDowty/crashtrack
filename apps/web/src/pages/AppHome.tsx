import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMe, listOrgs, listProjects, type Project } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AppHeader } from "@/components/AppHeader";
import { Plus, Users } from "lucide-react";
import { useDocumentTitle } from "@/lib/title";
import { AppHomeSkeleton, FullPageSkeleton } from "@/components/skeletons";

export function AppHome() {
  useDocumentTitle("projects");
  const { data: user, isPending: meLoading } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const projectsQ = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    enabled: !!user,
  });
  const orgsQ = useQuery({ queryKey: ["orgs"], queryFn: listOrgs, enabled: !!user });

  if (meLoading) return <FullPageSkeleton />;
  if (!user) return <Navigate to="/" replace />;
  if (projectsQ.isPending) return <AppHomeSkeleton user={user} />;

  const projects = projectsQ.data?.projects ?? [];
  const orgs = orgsQ.data?.orgs ?? [];

  // Group projects by owner.
  const personal = projects.filter((p) => !p.org_id);
  const byOrg = new Map<string, Project[]>();
  for (const p of projects) {
    if (p.org_id && p.owner?.kind === "org") {
      const list = byOrg.get(p.owner.slug) ?? [];
      list.push(p);
      byOrg.set(p.owner.slug, list);
    }
  }

  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <main className="max-w-5xl mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">projects</h1>
          <div className="flex gap-2">
            <Link
              to="/app/orgs/new"
              className="inline-flex items-center gap-2 h-10 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <Users className="size-4" /> new org
            </Link>
            <Button onClick={() => (window.location.href = "/app/new")}>
              <Plus className="size-4" /> new project
            </Button>
          </div>
        </div>

        <Section title={user.github_login} subtitle="personal">
          <ProjectList items={personal} />
        </Section>

        {orgs.map((o) => (
          <Section
            key={o.id}
            title={o.name}
            subtitle={`org · you are ${o.role}`}
            href={`/app/orgs/${o.slug}`}
          >
            <ProjectList items={byOrg.get(o.slug) ?? []} />
          </Section>
        ))}
      </main>
    </div>
  );
}

function Section({
  title,
  subtitle,
  href,
  children,
}: {
  title: string;
  subtitle: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          {href ? (
            <Link to={href} className="text-sm font-medium hover:underline">
              {title}
            </Link>
          ) : (
            <span className="text-sm font-medium">{title}</span>
          )}
          <span className="text-xs text-muted-foreground ml-2">{subtitle}</span>
        </div>
      </div>
      {children}
    </section>
  );
}

function ProjectList({ items }: { items: Project[] }) {
  if (items.length === 0) {
    return (
      <Card>
        <CardHeader className="py-6">
          <CardDescription>no projects here yet.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((p) => (
        <li key={p.id}>
          <Link to={`/app/${p.slug}`}>
            <Card className="hover:bg-accent/40 transition-colors">
              <CardHeader>
                <CardTitle>{p.name}</CardTitle>
                <CardDescription>{p.slug} · {p.platform}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}
