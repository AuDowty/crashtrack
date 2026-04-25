import { Link, Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMe, getProject, listReleases } from "@/lib/api";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { timeAgo } from "@/lib/format";
import { ArrowLeft } from "lucide-react";
import { useDocumentTitle } from "@/lib/title";
import { FullPageSkeleton } from "@/components/skeletons";
import { ErrorPage } from "@/pages/ErrorPage";

export function ProjectReleases() {
  const { slug = "" } = useParams();
  useDocumentTitle(`${slug} · releases`);
  const { data: user, isPending: meLoading } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const projectQ = useQuery({
    queryKey: ["project", slug],
    queryFn: () => getProject(slug),
    enabled: !!user,
  });
  const releasesQ = useQuery({
    queryKey: ["releases", slug],
    queryFn: () => listReleases(slug),
    enabled: !!user,
  });

  if (meLoading) return <FullPageSkeleton />;
  if (!user) return <Navigate to="/" replace />;
  if (projectQ.isPending || releasesQ.isPending) return <FullPageSkeleton />;
  if (releasesQ.error) return <ErrorPage status={404} message={String(releasesQ.error.message)} />;

  const p = projectQ.data!.project;
  const releases = releasesQ.data!.releases;

  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <main className="max-w-4xl mx-auto p-6 space-y-6">
        <Link
          to={`/app/${p.slug}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> back to {p.name}
        </Link>

        <h1 className="text-2xl font-semibold">releases</h1>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">all versions seen</CardTitle>
            <CardDescription>
              releases are created automatically as crashes come in with new app_version values.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left p-3">version</th>
                  <th className="text-left p-3">first seen</th>
                  <th className="text-right p-3">crashes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {releases.map((r) => (
                  <tr key={r.id} className="hover:bg-accent/30">
                    <td className="p-3 font-mono">{r.version}</td>
                    <td className="p-3 text-muted-foreground">{timeAgo(r.first_seen_at)}</td>
                    <td className="p-3 text-right">{r.crash_count}</td>
                  </tr>
                ))}
                {releases.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-6 text-center text-muted-foreground">
                      no releases yet — they appear once your app reports crashes with a version.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
