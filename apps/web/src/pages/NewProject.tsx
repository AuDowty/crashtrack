import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createProject, fetchMe, listOrgs } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { AppHeader } from "@/components/AppHeader";
import { useDocumentTitle } from "@/lib/title";
import { FullPageSkeleton } from "@/components/skeletons";

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

export function NewProject() {
  useDocumentTitle("new project");
  const { data: user, isPending } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const orgsQ = useQuery({ queryKey: ["orgs"], queryFn: listOrgs, enabled: !!user });
  const qc = useQueryClient();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [ownerSlug, setOwnerSlug] = useState("");  // "" = personal, else org slug

  const createMut = useMutation({
    mutationFn: () =>
      createProject({ slug, name, ...(ownerSlug ? { org_slug: ownerSlug } : {}) }),
    onSuccess: ({ project }) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      nav(`/app/${project.slug}/setup`);
    },
  });

  if (isPending) return <FullPageSkeleton />;
  if (!user) return <Navigate to="/" replace />;

  const slugValid = SLUG_RE.test(slug);
  const nameValid = name.trim().length > 0 && name.trim().length <= 80;
  const canSubmit = slugValid && nameValid && !createMut.isPending;

  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <main className="max-w-xl mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>new project</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (canSubmit) createMut.mutate();
              }}
            >
              <div className="space-y-1.5">
                <label className="text-sm font-medium">owner</label>
                <select
                  value={ownerSlug}
                  onChange={(e) => setOwnerSlug(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">{user.github_login} (personal)</option>
                  {(orgsQ.data?.orgs ?? []).map((o) => (
                    <option key={o.id} value={o.slug}>
                      {o.name} (org)
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="MyApp" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">slug</label>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  placeholder="myapp"
                />
                <p className="text-xs text-muted-foreground">
                  lowercase letters, numbers, dashes. 2–32 chars. used in URLs.
                </p>
              </div>

              {createMut.error && (
                <p className="text-sm text-destructive">{String(createMut.error.message)}</p>
              )}

              <div className="flex gap-2">
                <Button type="submit" disabled={!canSubmit}>
                  {createMut.isPending ? "creating..." : "create"}
                </Button>
                <Button type="button" variant="outline" onClick={() => nav("/app")}>
                  cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
