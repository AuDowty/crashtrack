import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createApiKey, fetchMe, getProject, listApiKeys } from "@/lib/api";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Copy, ArrowRight } from "lucide-react";
import { useDocumentTitle } from "@/lib/title";
import { FullPageSkeleton } from "@/components/skeletons";
import { ErrorPage } from "@/pages/ErrorPage";

const API_HOST = import.meta.env.VITE_API_BASE || "http://localhost:8787";

export function ProjectSetup() {
  const { slug = "" } = useParams();
  useDocumentTitle(`${slug} · setup`);
  const qc = useQueryClient();
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
  const [revealed, setRevealed] = useState<string | null>(null);

  const createKeyMut = useMutation({
    mutationFn: () => createApiKey(slug, "default"),
    onSuccess: ({ key }) => {
      setRevealed(key.secret);
      qc.invalidateQueries({ queryKey: ["keys", slug] });
    },
  });

  if (meLoading) return <FullPageSkeleton />;
  if (!user) return <Navigate to="/" replace />;
  if (projectQ.isPending) return <FullPageSkeleton />;
  if (projectQ.error) return <ErrorPage status={404} message={String(projectQ.error.message)} />;

  const p = projectQ.data!.project;
  const hasKey = (keysQ.data?.keys.length ?? 0) > 0;
  const placeholderKey = revealed ?? "ct_pk_REPLACE_WITH_YOUR_KEY";

  const cargoSnippet = `[dependencies]\ncrashtrack = "0.1"`;
  const codeSnippet = `use crashtrack::Config;

fn main() {
    crashtrack::install(Config {
        api_key:  "${placeholderKey}",
        app:      "${p.slug}",
        version:  env!("CARGO_PKG_VERSION"),
        endpoint: "${API_HOST}",
    }).expect("crashtrack install");

    // ... your app runs normally. on crash, a minidump is
    // written and uploaded on the next launch.
}`;

  return (
    <div className="min-h-screen">
      <AppHeader user={user} />
      <main className="max-w-3xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">set up {p.name}</h1>
          <p className="text-sm text-muted-foreground">
            three steps to start collecting crashes.
          </p>
        </div>

        <Step number={1} title="create an api key">
          {!hasKey && !revealed && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                we'll create a key named <code className="font-mono">default</code> for you.
                manage more keys in settings later.
              </p>
              <Button onClick={() => createKeyMut.mutate()} disabled={createKeyMut.isPending}>
                {createKeyMut.isPending ? "creating..." : "create key"}
              </Button>
            </div>
          )}
          {revealed && (
            <div className="rounded-md border border-primary bg-primary/5 p-3 space-y-2">
              <p className="text-sm font-medium">copy this key now — you won't see it again</p>
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
              </div>
            </div>
          )}
          {hasKey && !revealed && (
            <p className="text-sm text-muted-foreground">
              you have at least one key. find or rotate yours in{" "}
              <Link to={`/app/${p.slug}/settings`} className="underline">settings</Link>.
            </p>
          )}
        </Step>

        <Step number={2} title="add the rust crate">
          <CodeBlock code={cargoSnippet} />
        </Step>

        <Step number={3} title="install it in main()">
          <CodeBlock code={codeSnippet} />
          <p className="text-xs text-muted-foreground">
            on crash, a minidump is written to{" "}
            <code className="font-mono">%LOCALAPPDATA%/{p.slug}/crashtrack/pending</code>{" "}
            and uploaded the next time the app starts.
          </p>
        </Step>

        <Step number={4} title="(optional) send a test crash without writing code">
          <p className="text-sm text-muted-foreground">
            paste this in a terminal (with your key) to verify the round-trip works.
            a fake minidump is sent and should appear under "groups" within a few seconds.
          </p>
          <CodeBlock
            code={`curl -X POST ${API_HOST}/api/v1/crashes \\
  -H "Authorization: Bearer ${placeholderKey}" \\
  -F "app=${p.slug}" \\
  -F "version=0.0.1-test" \\
  -F "dump=@-;filename=test.dmp;type=application/octet-stream" \\
  --data-binary "MDMP$(printf '%.0s\\0' $(seq 1 5000))"`}
          />
          <p className="text-xs text-muted-foreground">
            the dump won't parse cleanly (it's just a header + zeros), but the group will
            still appear so you can confirm the pipeline.
          </p>
        </Step>

        <div className="flex gap-2 pt-2">
          <Button onClick={() => (window.location.href = `/app/${p.slug}`)}>
            done <ArrowRight className="size-4" />
          </Button>
          <Link
            to={`/app/${p.slug}/settings`}
            className="inline-flex items-center justify-center gap-2 h-10 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            settings
          </Link>
        </div>
      </main>
    </div>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-base">
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">
            {number}
          </span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="rounded-md border bg-background p-3 text-sm font-mono overflow-x-auto whitespace-pre">
        {code}
      </pre>
      <Button
        size="icon"
        variant="ghost"
        className="absolute top-2 right-2 size-7"
        onClick={() => navigator.clipboard.writeText(code)}
        aria-label="copy"
      >
        <Copy className="size-3.5" />
      </Button>
    </div>
  );
}
