import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createApiKey,
  createWebhook,
  deleteApiKey,
  deleteProject,
  deleteSymbol,
  deleteWebhook,
  fetchMe,
  getProject,
  listApiKeys,
  listSymbols,
  listWebhooks,
  updateProject,
  uploadSymbol,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { AppHeader } from "@/components/AppHeader";
import { Copy, Trash } from "lucide-react";
import { useDocumentTitle } from "@/lib/title";
import { FullPageSkeleton, ProjectSettingsSkeleton } from "@/components/skeletons";
import { ErrorPage } from "@/pages/ErrorPage";

export function ProjectSettings() {
  const { slug = "" } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data: user, isPending: meLoading } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const projectQ = useQuery({
    queryKey: ["project", slug],
    queryFn: () => getProject(slug),
    enabled: !!user,
  });
  const keysQ = useQuery({
    queryKey: ["keys", slug],
    queryFn: () => listApiKeys(slug),
    enabled: !!user,
  });

  const [keyName, setKeyName] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookKind, setWebhookKind] = useState<"slack" | "discord">("slack");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");

  const webhooksQ = useQuery({
    queryKey: ["webhooks", slug],
    queryFn: () => listWebhooks(slug),
    enabled: !!user,
  });

  const createWebhookMut = useMutation({
    mutationFn: () => createWebhook(slug, webhookKind, webhookUrl.trim()),
    onSuccess: () => {
      setWebhookUrl("");
      qc.invalidateQueries({ queryKey: ["webhooks", slug] });
    },
  });

  const deleteWebhookMut = useMutation({
    mutationFn: (id: number) => deleteWebhook(slug, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks", slug] }),
  });

  const createKeyMut = useMutation({
    mutationFn: () => createApiKey(slug, keyName.trim()),
    onSuccess: ({ key }) => {
      setRevealed(key.secret);
      setKeyName("");
      qc.invalidateQueries({ queryKey: ["keys", slug] });
    },
  });

  const deleteKeyMut = useMutation({
    mutationFn: (id: number) => deleteApiKey(slug, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["keys", slug] }),
  });

  const deleteProjMut = useMutation({
    mutationFn: () => deleteProject(slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      nav("/app");
    },
  });

  const togglePublicMut = useMutation({
    mutationFn: (pub: boolean) => updateProject(slug, { public: pub }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", slug] }),
  });

  const updateGithubMut = useMutation({
    mutationFn: (input: { github_repo?: string; source_root?: string; github_ref?: string }) =>
      updateProject(slug, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", slug] }),
  });

  const [ghRepo, setGhRepo] = useState<string | null>(null);
  const [ghRef, setGhRef] = useState<string | null>(null);
  const [srcRoot, setSrcRoot] = useState<string | null>(null);

  const symbolsQ = useQuery({
    queryKey: ["symbols", slug],
    queryFn: () => listSymbols(slug),
    enabled: !!user,
  });
  const uploadSymbolMut = useMutation({
    mutationFn: (file: File) => uploadSymbol(slug, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["symbols", slug] }),
  });
  const deleteSymbolMut = useMutation({
    mutationFn: (id: number) => deleteSymbol(slug, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["symbols", slug] }),
  });

  useDocumentTitle(`${slug} · settings`);

  if (meLoading) return <FullPageSkeleton />;
  if (!user) return <Navigate to="/" replace />;
  if (projectQ.isPending) return <ProjectSettingsSkeleton user={user} />;
  if (projectQ.error) return <ErrorPage status={404} message={String(projectQ.error.message)} />;

  const p = projectQ.data!.project;
  const keys = keysQ.data?.keys ?? [];
  const webhooks = webhooksQ.data?.webhooks ?? [];
  const symbolFiles = symbolsQ.data?.symbols ?? [];
  const canCreateKey = keyName.trim().length > 0 && !createKeyMut.isPending;
  const canCreateWebhook =
    webhookUrl.trim().startsWith("https://") && !createWebhookMut.isPending;

  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <main className="max-w-3xl mx-auto p-6 space-y-6">
        <h1 className="text-2xl font-semibold">{p.name} · settings</h1>

        <Card>
          <CardHeader>
            <CardTitle>api keys</CardTitle>
            <CardDescription>
              keys authenticate the crashtrack client when it uploads crashes. revoke any time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (canCreateKey) createKeyMut.mutate();
              }}
            >
              <Input
                placeholder="key name (e.g. production, CI)"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
              />
              <Button type="submit" disabled={!canCreateKey}>
                {createKeyMut.isPending ? "creating..." : "new key"}
              </Button>
            </form>

            {revealed && (
              <div className="rounded-md border border-primary bg-primary/5 p-4 space-y-2">
                <p className="text-sm font-medium">
                  copy this key now — you won't see it again
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-background px-2 py-1.5 text-sm font-mono break-all">
                    {revealed}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigator.clipboard.writeText(revealed)}
                  >
                    <Copy className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRevealed(null)}>
                    dismiss
                  </Button>
                </div>
              </div>
            )}

            <ul className="divide-y border rounded-md">
              {keys.length === 0 && (
                <li className="p-4 text-sm text-muted-foreground">no keys yet.</li>
              )}
              {keys.map((k) => (
                <li key={k.id} className="p-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{k.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      ct_pk_...{k.last_4}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => deleteKeyMut.mutate(k.id)}
                    aria-label="revoke key"
                  >
                    <Trash className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>public dashboard</CardTitle>
            <CardDescription>
              when on, anyone can view this project's crash chart + open groups at{" "}
              <code className="font-mono">/p/{p.slug}</code>. raw minidumps are never public.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => togglePublicMut.mutate(!p.public)}
                disabled={togglePublicMut.isPending}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  p.public ? "bg-primary" : "bg-input"
                } disabled:opacity-50`}
                aria-label="toggle public dashboard"
              >
                <span
                  className={`inline-block size-4 transform rounded-full bg-background transition-transform ${
                    p.public ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
              <span className="text-sm">
                {p.public ? (
                  <>
                    public —{" "}
                    <a
                      href={`/p/${p.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      view
                    </a>
                  </>
                ) : (
                  "private"
                )}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>source context (GitHub)</CardTitle>
            <CardDescription>
              point at a public GitHub repo so symbolicated stack frames render with ±3 lines
              of actual source code. file paths from your PDB are mapped to repo paths via the
              "source root" marker.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-medium">repo (owner/name)</label>
                <Input
                  placeholder="AuDowty/crashtrack-test"
                  value={ghRepo ?? p.github_repo ?? ""}
                  onChange={(e) => setGhRepo(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">ref (branch / tag / sha)</label>
                <Input
                  placeholder="main"
                  value={ghRef ?? p.github_ref ?? ""}
                  onChange={(e) => setGhRef(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">source root marker</label>
              <Input
                placeholder="src"
                value={srcRoot ?? p.source_root ?? "src"}
                onChange={(e) => setSrcRoot(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                a PDB path <code>C:/.../myapp/src/main.rs</code> with root <code>src</code> maps
                to repo path <code>src/main.rs</code>.
              </p>
            </div>
            <Button
              onClick={() => updateGithubMut.mutate({
                github_repo: ghRepo ?? p.github_repo ?? "",
                github_ref:  ghRef  ?? p.github_ref  ?? "",
                source_root: srcRoot ?? p.source_root ?? "src",
              })}
              disabled={updateGithubMut.isPending}
            >
              {updateGithubMut.isPending ? "saving..." : "save"}
            </Button>
            {updateGithubMut.error && (
              <p className="text-sm text-destructive">{String(updateGithubMut.error.message)}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>symbols (PDBs)</CardTitle>
            <CardDescription>
              upload your build's PDB files. crashtrack uses them to turn{" "}
              <code className="font-mono">myapp.exe +0x12345</code> into{" "}
              <code className="font-mono">MyClass::Render</code> on the group detail page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="inline-flex items-center gap-2 h-10 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent cursor-pointer">
              <input
                type="file"
                accept=".pdb"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadSymbolMut.mutate(f);
                  e.target.value = "";
                }}
              />
              {uploadSymbolMut.isPending ? "uploading..." : "upload .pdb"}
            </label>
            {uploadSymbolMut.error && (
              <p className="text-sm text-destructive">{String(uploadSymbolMut.error.message)}</p>
            )}

            <ul className="divide-y border rounded-md">
              {symbolFiles.length === 0 && (
                <li className="p-4 text-sm text-muted-foreground">no symbols uploaded yet.</li>
              )}
              {symbolFiles.map((s) => (
                <li key={s.id} className="p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium font-mono truncate">{s.module_name}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {s.signature.slice(0, 8)}… · age {s.age} · {(s.size / 1024 / 1024).toFixed(1)} MB
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => deleteSymbolMut.mutate(s.id)}
                    aria-label="remove symbol"
                  >
                    <Trash className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>

            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">upload from CI via curl</summary>
              <pre className="mt-2 rounded-md border bg-background p-3 font-mono overflow-x-auto whitespace-pre">
{`curl -X POST https://api.crashtrack.dev/api/projects/${slug}/symbols \\
  -H "Cookie: ct_sess=<your-session-cookie>" \\
  -F "pdb=@myapp.pdb"`}
              </pre>
              <p className="mt-2">
                session-cookie auth means CI needs a logged-in session — for a more robust path,
                wait for the upcoming dedicated symbol-upload api key feature.
              </p>
            </details>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>webhooks</CardTitle>
            <CardDescription>
              get pinged on slack or discord when a new crash group appears.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (canCreateWebhook) createWebhookMut.mutate();
              }}
            >
              <select
                value={webhookKind}
                onChange={(e) => setWebhookKind(e.target.value as "slack" | "discord")}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="slack">slack</option>
                <option value="discord">discord</option>
              </select>
              <Input
                placeholder="https://hooks.slack.com/... or https://discord.com/api/webhooks/..."
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
              <Button type="submit" disabled={!canCreateWebhook}>
                {createWebhookMut.isPending ? "adding..." : "add"}
              </Button>
            </form>

            <ul className="divide-y border rounded-md">
              {webhooks.length === 0 && (
                <li className="p-4 text-sm text-muted-foreground">no webhooks yet.</li>
              )}
              {webhooks.map((w) => (
                <li key={w.id} className="p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium capitalize">{w.kind}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate">
                      {w.url}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => deleteWebhookMut.mutate(w.id)}
                    aria-label="remove webhook"
                  >
                    <Trash className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">danger zone</CardTitle>
            <CardDescription>
              deleting this project removes all crashes, keys, releases and symbols.
              cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!deleteOpen && (
              <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                delete this project
              </Button>
            )}

            {deleteOpen && (
              <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
                <p className="text-sm">
                  to confirm, type <code className="font-mono font-semibold">{p.slug}</code>{" "}
                  in the box below.
                </p>
                <Input
                  autoFocus
                  value={deleteInput}
                  onChange={(e) => setDeleteInput(e.target.value)}
                  placeholder={p.slug}
                />
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    disabled={deleteInput !== p.slug || deleteProjMut.isPending}
                    onClick={() => deleteProjMut.mutate()}
                  >
                    {deleteProjMut.isPending ? "deleting..." : `I understand, delete ${p.slug}`}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDeleteOpen(false);
                      setDeleteInput("");
                    }}
                  >
                    cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
