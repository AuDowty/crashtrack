import { Link } from "react-router-dom";
import { useDocumentTitle } from "@/lib/title";

const API_HOST = import.meta.env.VITE_API_BASE || "http://localhost:8787";

export function Docs() {
  useDocumentTitle("docs");
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="text-lg font-semibold">crashtrack</Link>
          <span className="text-xs text-muted-foreground">api docs</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-6 space-y-10 prose-style">
        <section>
          <h1 className="text-3xl font-semibold mb-2">api</h1>
          <p className="text-muted-foreground">
            crashtrack accepts windows minidump uploads over a single HTTP endpoint.
            an api key authenticates uploads to a specific project. raw response bodies
            are JSON.
          </p>
        </section>

        <Section title="base url">
          <Code>{API_HOST}</Code>
          <p className="text-sm text-muted-foreground mt-2">
            self-hosted? point at your own worker — same routes, same shapes.
          </p>
        </Section>

        <Section title="upload a crash">
          <Code lang="http">{`POST /api/v1/crashes
Authorization: Bearer ct_pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: multipart/form-data; boundary=...

--...
Content-Disposition: form-data; name="dump"; filename="crash.dmp"
Content-Type: application/octet-stream

<raw minidump bytes>
--...
Content-Disposition: form-data; name="app"

myapp
--...
Content-Disposition: form-data; name="version"

1.2.4
--...--`}</Code>
          <p className="text-sm mt-3">fields:</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4">field</th>
                <th className="py-2 pr-4">type</th>
                <th className="py-2">required</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <Row name="dump" type="file (.dmp)" req />
              <Row name="app" type="string ≤ 60" req />
              <Row name="version" type="string ≤ 60" req={false} />
            </tbody>
          </table>
          <p className="text-sm mt-3">success response (201):</p>
          <Code lang="json">{`{
  "id": "42/1c2f4a90-...",
  "group_id": 17,
  "is_new_group": false
}`}</Code>
          <p className="text-sm mt-3">errors:</p>
          <ul className="text-sm space-y-1 list-disc pl-6">
            <li><code>401 invalid_key</code> — bearer token missing / wrong / revoked</li>
            <li><code>400 missing_dump</code> — no <code>dump</code> field in form</li>
            <li><code>400 empty_dump</code> — file uploaded but zero bytes</li>
            <li><code>413 dump_too_large</code> — single dump exceeds 5 MB</li>
          </ul>
        </Section>

        <Section title="limits">
          <ul className="text-sm space-y-1 list-disc pl-6">
            <li>max dump size: <strong>5 MB</strong></li>
            <li>retention: raw minidumps deleted after <strong>7 days</strong>; metadata kept forever</li>
            <li>rate limit (per api key): 100 uploads / hour soft</li>
          </ul>
        </Section>

        <Section title="grouping">
          <p className="text-sm">
            crashes are deduplicated by a signature derived from{" "}
            <code>exception_code + module + offset</code>. the same bug across runs (even
            with different ASLR load addresses) groups into the same crash group. group
            signature is stable, so resolved-status and counts carry across runs.
          </p>
        </Section>

        <Section title="clients">
          <p className="text-sm">
            the official rust uploader handles SEH + minidump writing + queued upload:
          </p>
          <Code lang="toml">{`[dependencies]
crashtrack = "0.1"`}</Code>
          <p className="text-sm mt-3">
            you can also write your own client — anything that POSTs the multipart form
            above works. examples below.
          </p>
          <p className="text-sm font-medium mt-4">curl</p>
          <Code lang="sh">{`curl -X POST ${API_HOST}/api/v1/crashes \\
  -H "Authorization: Bearer ct_pk_..." \\
  -F "app=myapp" -F "version=1.2.4" \\
  -F "dump=@crash.dmp"`}</Code>
          <p className="text-sm font-medium mt-4">python</p>
          <Code lang="python">{`import requests
with open("crash.dmp", "rb") as f:
    requests.post(
        "${API_HOST}/api/v1/crashes",
        headers={"Authorization": "Bearer ct_pk_..."},
        files={"dump": f},
        data={"app": "myapp", "version": "1.2.4"},
    )`}</Code>
        </Section>

        <Section title="public dashboards">
          <p className="text-sm">
            a project owner can toggle <strong>public</strong> in settings. public
            projects expose a read-only dashboard at <code>/p/&lt;slug&gt;</code> showing
            the crashes-over-time chart and open groups. raw minidumps are never public.
          </p>
        </Section>

        <Section title="symbols (PDB upload)">
          <p className="text-sm">
            upload your build's <code>.pdb</code> files via the dashboard. crashtrack
            parses them (in WASM) and turns raw stack offsets into function names on the
            group detail page. PDBs are matched to modules by filename stem
            (<code>myapp.exe</code> ↔ <code>myapp.pdb</code>). per-RVA resolutions are
            cached so repeat views are cheap.
          </p>
        </Section>

        <footer className="text-xs text-muted-foreground pt-8 border-t">
          source:{" "}
          <a className="underline" href="https://github.com/AuDowty/crashtrack">
            github.com/AuDowty/crashtrack
          </a>
        </footer>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold border-b pb-1">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Code({ children, lang }: { children: string; lang?: string }) {
  return (
    <pre className="rounded-md border bg-background p-3 text-sm font-mono overflow-x-auto whitespace-pre">
      {lang && <span className="text-xs text-muted-foreground block mb-2">{lang}</span>}
      <code>{children}</code>
    </pre>
  );
}

function Row({ name, type, req }: { name: string; type: string; req: boolean }) {
  return (
    <tr>
      <td className="py-2 pr-4 font-mono">{name}</td>
      <td className="py-2 pr-4 text-muted-foreground">{type}</td>
      <td className="py-2 text-muted-foreground">{req ? "yes" : "no"}</td>
    </tr>
  );
}
