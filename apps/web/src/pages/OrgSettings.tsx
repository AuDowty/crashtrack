import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addMember,
  deleteOrg,
  fetchMe,
  getOrg,
  listMembers,
  removeMember,
} from "@/lib/api";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { ArrowLeft, Trash } from "lucide-react";
import { useDocumentTitle } from "@/lib/title";
import { FullPageSkeleton, ProjectSettingsSkeleton } from "@/components/skeletons";
import { ErrorPage } from "@/pages/ErrorPage";

export function OrgSettings() {
  const { slug = "" } = useParams();
  useDocumentTitle(`${slug} · org`);
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data: user, isPending: meLoading } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const orgQ = useQuery({
    queryKey: ["org", slug],
    queryFn: () => getOrg(slug),
    enabled: !!user,
  });
  const membersQ = useQuery({
    queryKey: ["members", slug],
    queryFn: () => listMembers(slug),
    enabled: !!user,
  });

  const [invite, setInvite] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "owner">("member");
  const [deleteInput, setDeleteInput] = useState("");

  const addMut = useMutation({
    mutationFn: () => addMember(slug, { github_login: invite.trim(), role: inviteRole }),
    onSuccess: () => {
      setInvite("");
      qc.invalidateQueries({ queryKey: ["members", slug] });
    },
  });

  const removeMut = useMutation({
    mutationFn: (userId: number) => removeMember(slug, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", slug] }),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteOrg(slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orgs"] });
      nav("/app");
    },
  });

  if (meLoading) return <FullPageSkeleton />;
  if (!user) return <Navigate to="/" replace />;
  if (orgQ.isPending) return <ProjectSettingsSkeleton user={user} />;
  if (orgQ.error) return <ErrorPage status={404} message={String(orgQ.error.message)} />;

  const org = orgQ.data!.org;
  const role = orgQ.data!.role;
  const members = membersQ.data?.members ?? [];
  const isOwner = role === "owner";
  const canAdd = invite.trim().length > 0 && isOwner && !addMut.isPending;

  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <main className="max-w-3xl mx-auto p-6 space-y-6">
        <Link
          to="/app"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> back to projects
        </Link>

        <div>
          <h1 className="text-2xl font-semibold">{org.name}</h1>
          <p className="text-sm text-muted-foreground">
            org · {org.slug} · you are {role}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>members</CardTitle>
            <CardDescription>
              {isOwner
                ? "members can view + create projects. owners can also manage members."
                : "only owners can add or remove members."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isOwner && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canAdd) addMut.mutate();
                }}
              >
                <Input
                  placeholder="github username"
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "owner" | "member")}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="member">member</option>
                  <option value="owner">owner</option>
                </select>
                <Button type="submit" disabled={!canAdd}>
                  {addMut.isPending ? "adding..." : "add"}
                </Button>
              </form>
            )}

            {addMut.error && (
              <p className="text-sm text-destructive">
                {String(addMut.error.message) === "user_not_signed_up"
                  ? "that github user hasn't signed in to crashtrack yet — ask them to sign in first."
                  : String(addMut.error.message)}
              </p>
            )}

            <ul className="divide-y border rounded-md">
              {members.length === 0 && (
                <li className="p-4 text-sm text-muted-foreground">no members yet.</li>
              )}
              {members.map((m) => (
                <li key={m.user_id} className="p-3 flex items-center gap-3">
                  {m.avatar_url && (
                    <img src={m.avatar_url} alt="" className="size-8 rounded-full" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{m.github_login}</div>
                    <div className="text-xs text-muted-foreground capitalize">{m.role}</div>
                  </div>
                  {(isOwner || m.user_id === user.id) && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeMut.mutate(m.user_id)}
                      aria-label={m.user_id === user.id ? "leave org" : "remove member"}
                    >
                      <Trash className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {removeMut.error && (
              <p className="text-sm text-destructive">{String(removeMut.error.message)}</p>
            )}
          </CardContent>
        </Card>

        {isOwner && (
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="text-destructive">danger zone</CardTitle>
              <CardDescription>
                deleting this org removes all projects, crashes, keys and members. cannot be undone.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">
                to confirm, type <code className="font-mono font-semibold">{org.slug}</code> below.
              </p>
              <Input
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder={org.slug}
              />
              <Button
                variant="destructive"
                disabled={deleteInput !== org.slug || deleteMut.isPending}
                onClick={() => deleteMut.mutate()}
              >
                {deleteMut.isPending ? "deleting..." : `delete ${org.slug}`}
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
