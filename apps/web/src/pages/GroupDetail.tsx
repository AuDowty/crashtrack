import { Link, Navigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { crashDumpUrl, fetchMe, getGroup, getProject, setGroupStatus } from "@/lib/api";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { formatBytes, timeAgo } from "@/lib/format";
import { ArrowLeft, AlertOctagon, Check, EyeOff, Undo2, Download } from "lucide-react";
import { useDocumentTitle } from "@/lib/title";
import { FullPageSkeleton, GroupDetailSkeleton } from "@/components/skeletons";
import { ErrorPage } from "@/pages/ErrorPage";

export function GroupDetail() {
  const { slug = "", id = "" } = useParams();
  const groupId = Number(id);
  const qc = useQueryClient();
  const { data: user, isPending: meLoading } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const projectQ = useQuery({
    queryKey: ["project", slug],
    queryFn: () => getProject(slug),
    enabled: !!user,
  });
  const groupQ = useQuery({
    queryKey: ["group", slug, groupId],
    queryFn: () => getGroup(slug, groupId),
    enabled: !!user && Number.isInteger(groupId),
  });
  const statusMut = useMutation({
    mutationFn: (status: "open" | "resolved" | "ignored") =>
      setGroupStatus(slug, groupId, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["group", slug, groupId] });
      qc.invalidateQueries({ queryKey: ["groups", slug] });
    },
  });

  // Hooks always run, in the same order — keep above conditional returns.
  useDocumentTitle(
    groupQ.data && projectQ.data
      ? `${groupQ.data.group.exception_code ?? "crash"} · ${projectQ.data.project.name}`
      : slug,
  );

  if (meLoading) return <FullPageSkeleton />;
  if (!user) return <Navigate to="/" replace />;
  if (projectQ.isPending || groupQ.isPending) return <GroupDetailSkeleton user={user} />;
  if (groupQ.error)
    return <ErrorPage status={404} message={String(groupQ.error.message)} />;

  const p = projectQ.data!.project;
  const g = groupQ.data!.group;
  const samples = groupQ.data!.samples;
  const stack = groupQ.data!.canonical_stack;

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

        <div className="flex items-start gap-3">
          <AlertOctagon className="size-6 text-destructive mt-1 shrink-0" />
          <div className="space-y-1 min-w-0 flex-1">
            {samples[0]?.exception_name && (
              <p className="text-xs font-mono uppercase tracking-wide text-destructive">
                {samples[0].exception_name}
              </p>
            )}
            <h1 className="text-xl font-mono font-semibold break-all">
              {g.exception_code ?? "unknown"}
              {g.top_module && <span> · {g.top_module}</span>}
              {g.top_function && (
                <span className="text-muted-foreground">{g.top_function}</span>
              )}
            </h1>
            {samples[0]?.av_address && (
              <p className="text-sm">
                tried to <span className="font-medium">{samples[0].av_operation ?? "access"}</span>{" "}
                address <code className="font-mono">{samples[0].av_address}</code>
                {samples[0].av_address === "0x0" && (
                  <span className="text-muted-foreground"> · likely null-pointer deref</span>
                )}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1 mr-2">
                <span
                  className={`inline-block size-2 rounded-full ${
                    g.status === "open"
                      ? "bg-destructive"
                      : g.status === "resolved"
                        ? "bg-green-500"
                        : "bg-muted-foreground"
                  }`}
                />
                {g.status}
              </span>
              · {g.count} event{g.count === 1 ? "" : "s"} · first seen{" "}
              {timeAgo(g.first_seen_at)} · last seen {timeAgo(g.last_seen_at)}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            {g.status !== "resolved" && (
              <Button
                size="sm"
                variant="outline"
                disabled={statusMut.isPending}
                onClick={() => statusMut.mutate("resolved")}
              >
                <Check className="size-4" /> resolve
              </Button>
            )}
            {g.status === "open" && (
              <Button
                size="sm"
                variant="outline"
                disabled={statusMut.isPending}
                onClick={() => statusMut.mutate("ignored")}
              >
                <EyeOff className="size-4" /> ignore
              </Button>
            )}
            {g.status !== "open" && (
              <Button
                size="sm"
                variant="outline"
                disabled={statusMut.isPending}
                onClick={() => statusMut.mutate("open")}
              >
                <Undo2 className="size-4" /> reopen
              </Button>
            )}
          </div>
        </div>

        {stack && stack.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">stack</CardTitle>
              <CardDescription>
                top {stack.length} frame{stack.length === 1 ? "" : "s"} from the
                crashing thread{" "}
                {stack.some((f) => f.function)
                  ? "· SEH unwound · PDB symbolicated"
                  : "· upload PDBs in settings for function names"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3 font-mono text-xs">
                {stack.map((f, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="text-muted-foreground tabular-nums w-6 text-right pt-0.5">
                      {i}
                    </span>
                    <div className="flex-1 min-w-0 space-y-1">
                      {f.function ? (
                        <>
                          <div>
                            <span className="text-primary">{f.function}</span>
                            {f.module && (
                              <span className="text-muted-foreground"> · {f.module}</span>
                            )}
                          </div>
                          {f.file && (
                            <div className="text-muted-foreground truncate text-[11px]">
                              at {f.file}{f.line != null && <>:<span className="text-foreground">{f.line}</span></>}
                            </div>
                          )}
                          {f.source && f.source.length > 0 && (
                            <pre className="rounded-md border bg-background mt-1 overflow-x-auto">
                              {f.source.map((sl) => (
                                <div
                                  key={sl.line}
                                  className={`px-3 py-0.5 ${sl.is_focus ? "bg-destructive/10 border-l-2 border-destructive" : ""}`}
                                >
                                  <span className="text-muted-foreground select-none mr-3 inline-block w-8 text-right">
                                    {sl.line}
                                  </span>
                                  <span className={sl.is_focus ? "text-foreground" : ""}>{sl.text}</span>
                                </div>
                              ))}
                            </pre>
                          )}
                        </>
                      ) : f.module ? (
                        <span>
                          <span>{f.module}</span>
                          <span className="text-muted-foreground">{f.offset}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{f.address}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              {stack.some((f) => f.module && !f.function) && (
                <p className="text-xs text-muted-foreground mt-3">
                  upload PDBs in settings to get function names instead of offsets.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">recent samples</CardTitle>
            <CardDescription>
              last {samples.length} crash{samples.length === 1 ? "" : "es"} in this group
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left p-3">received</th>
                  <th className="text-left p-3">app version</th>
                  <th className="text-left p-3">os</th>
                  <th className="text-left p-3">arch</th>
                  <th className="text-right p-3">size</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {samples.map((s) => (
                  <tr key={s.id} className="hover:bg-accent/30">
                    <td className="p-3 text-muted-foreground">{timeAgo(s.uploaded_at)}</td>
                    <td className="p-3 font-mono text-xs">{s.app_version ?? "-"}</td>
                    <td className="p-3 font-mono text-xs">{s.os_version ?? "-"}</td>
                    <td className="p-3 font-mono text-xs">{s.cpu_arch ?? "-"}</td>
                    <td className="p-3 text-right text-muted-foreground">
                      {formatBytes(s.dump_size)}
                    </td>
                    <td className="p-3 text-right">
                      <a
                        href={crashDumpUrl(p.slug, s.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        title="download minidump (.dmp)"
                      >
                        <Download className="size-3.5" /> .dmp
                      </a>
                    </td>
                  </tr>
                ))}
                {samples.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-muted-foreground">
                      no samples
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
