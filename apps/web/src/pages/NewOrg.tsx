import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createOrg, fetchMe } from "@/lib/api";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { useDocumentTitle } from "@/lib/title";
import { FullPageSkeleton } from "@/components/skeletons";

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

export function NewOrg() {
  useDocumentTitle("new org");
  const { data: user, isPending } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const qc = useQueryClient();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  const createMut = useMutation({
    mutationFn: () => createOrg({ slug, name }),
    onSuccess: ({ org }) => {
      qc.invalidateQueries({ queryKey: ["orgs"] });
      nav(`/app/orgs/${org.slug}`);
    },
  });

  if (isPending) return <FullPageSkeleton />;
  if (!user) return <Navigate to="/" replace />;

  const canSubmit = SLUG_RE.test(slug) && name.trim().length > 0 && !createMut.isPending;

  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <main className="max-w-xl mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>new org</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (canSubmit) createMut.mutate();
              }}
            >
              <div className="space-y-1.5">
                <label className="text-sm font-medium">name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Acme Corp"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">slug</label>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  placeholder="acme"
                />
                <p className="text-xs text-muted-foreground">
                  lowercase letters, numbers, dashes. used for URLs and project namespacing.
                </p>
              </div>

              {createMut.error && (
                <p className="text-sm text-destructive">{String(createMut.error.message)}</p>
              )}

              <div className="flex gap-2">
                <Button type="submit" disabled={!canSubmit}>
                  {createMut.isPending ? "creating..." : "create org"}
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
