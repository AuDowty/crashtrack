const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export type User = {
  id: number;
  github_id: number;
  github_login: string;
  email: string | null;
  avatar_url: string | null;
};

export type ProjectOwner =
  | { kind: "user"; slug: string; name: string }
  | { kind: "org"; slug: string; name: string };

export type Project = {
  id: number;
  slug: string;
  name: string;
  platform: string;
  public: boolean;
  created_at: number;
  org_id: number | null;
  owner?: ProjectOwner;
  github_repo: string | null;
  source_root: string | null;
  github_ref: string | null;
};

export type SourceLine = { line: number; text: string; is_focus: boolean };

export type ApiKey = {
  id: number;
  name: string;
  last_4: string;
  last_used_at: number | null;
  created_at: number;
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include", ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${path} ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function fetchMe(): Promise<User | null> {
  const res = await fetch(`${API_BASE}/api/me`, { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`me: ${res.status}`);
  const body = (await res.json()) as { user: User };
  return body.user;
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/api/auth/logout`, { method: "POST", credentials: "include" });
}

export const listProjects = () => req<{ projects: Project[] }>("/api/projects");

export const createProject = (input: { slug: string; name: string; org_slug?: string }) =>
  req<{ project: Project }>("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const getProject = (slug: string) =>
  req<{ project: Project }>(`/api/projects/${encodeURIComponent(slug)}`);

export const updateProject = (
  slug: string,
  input: {
    name?: string;
    public?: boolean;
    github_repo?: string;
    github_ref?: string;
    source_root?: string;
  },
) =>
  req<{ project: Project }>(`/api/projects/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const deleteProject = (slug: string) =>
  req<void>(`/api/projects/${encodeURIComponent(slug)}`, { method: "DELETE" });

// Public (no auth) — for /p/:slug pages.
export type PublicProject = {
  slug: string;
  name: string;
  platform: string;
  public: true;
  created_at: number;
};

export async function getSiteStats(): Promise<{
  users: number;
  active_projects: number;
  crashes_processed: number;
}> {
  const r = await fetch(`${API_BASE}/p/stats`);
  if (!r.ok) throw new Error("stats_failed");
  return r.json();
}

export async function getPublicProject(slug: string): Promise<{
  project: PublicProject;
} | null> {
  const r = await fetch(`${API_BASE}/p/${encodeURIComponent(slug)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`public_project ${r.status}`);
  return r.json();
}

export async function getPublicStats(slug: string, days = 14) {
  const r = await fetch(`${API_BASE}/p/${encodeURIComponent(slug)}/stats?days=${days}`);
  if (!r.ok) throw new Error(`public_stats ${r.status}`);
  return r.json() as Promise<{ stats: DayStat[]; total: number }>;
}

export async function getPublicGroups(slug: string) {
  const r = await fetch(`${API_BASE}/p/${encodeURIComponent(slug)}/groups`);
  if (!r.ok) throw new Error(`public_groups ${r.status}`);
  return r.json() as Promise<{ groups: CrashGroup[] }>;
}

export const listApiKeys = (slug: string) =>
  req<{ keys: ApiKey[] }>(`/api/projects/${encodeURIComponent(slug)}/keys`);

export const createApiKey = (slug: string, name: string) =>
  req<{ key: ApiKey & { secret: string } }>(
    `/api/projects/${encodeURIComponent(slug)}/keys`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );

export const deleteApiKey = (slug: string, id: number) =>
  req<void>(`/api/projects/${encodeURIComponent(slug)}/keys/${id}`, { method: "DELETE" });

export type DayStat = { day: number; date: string; count: number };

export const getStats = (slug: string, days = 14) =>
  req<{ stats: DayStat[]; total: number }>(
    `/api/projects/${encodeURIComponent(slug)}/stats?days=${days}`,
  );

export const getTopModules = (slug: string, days = 14) =>
  req<{ modules: { module: string; count: number }[] }>(
    `/api/projects/${encodeURIComponent(slug)}/top-modules?days=${days}`,
  );

export type CrashGroup = {
  id: number;
  signature: string;
  first_seen_at: number;
  last_seen_at: number;
  count: number;
  exception_code: string | null;
  top_module: string | null;
  top_function: string | null;
  status: string;
};

export const listGroups = (
  slug: string,
  status: "open" | "resolved" | "ignored" = "open",
  q?: string,
) => {
  const params = new URLSearchParams({ status });
  if (q) params.set("q", q);
  return req<{ groups: CrashGroup[]; next_before: number | null }>(
    `/api/projects/${encodeURIComponent(slug)}/groups?${params}`,
  );
};

export type Frame = {
  address: string;             // hex "0x14000abcd"
  module: string | null;
  offset: string | null;       // hex "0x1234"
  function?: string | null;    // present on canonical_stack when symbols uploaded
  file?: string | null;        // source file path
  line?: number | null;        // 1-indexed line number
  source?: SourceLine[];       // present when project has github_repo configured
};

export type SymbolFile = {
  id: number;
  module_name: string;
  signature: string;
  age: number;
  size: number;
  uploaded_at: number;
};

export const listSymbols = (slug: string) =>
  req<{ symbols: SymbolFile[] }>(`/api/projects/${encodeURIComponent(slug)}/symbols`);

export async function uploadSymbol(slug: string, file: File): Promise<SymbolFile> {
  const form = new FormData();
  form.append("pdb", file);
  const res = await fetch(
    `${API_BASE}/api/projects/${encodeURIComponent(slug)}/symbols`,
    { method: "POST", credentials: "include", body: form },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `upload ${res.status}`);
  }
  const body = (await res.json()) as { symbol: SymbolFile };
  return body.symbol;
}

export const deleteSymbol = (slug: string, id: number) =>
  req<void>(`/api/projects/${encodeURIComponent(slug)}/symbols/${id}`, { method: "DELETE" });

export type CrashSample = {
  id: string;
  occurred_at: number;
  uploaded_at: number;
  app_version: string | null;
  os_version: string | null;
  cpu_arch: string | null;
  dump_size: number;
  stack: Frame[] | null;
  exception_name: string | null;
  av_operation: "read" | "write" | "execute" | null;
  av_address: string | null;
};

export const getGroup = (slug: string, id: number) =>
  req<{ group: CrashGroup; samples: CrashSample[]; canonical_stack: Frame[] | null }>(
    `/api/projects/${encodeURIComponent(slug)}/groups/${id}`,
  );

export const setGroupStatus = (
  slug: string,
  id: number,
  status: "open" | "resolved" | "ignored",
) =>
  req<{ ok: true }>(`/api/projects/${encodeURIComponent(slug)}/groups/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });

export function crashDumpUrl(slug: string, crashId: string): string {
  return `${API_BASE}/api/projects/${encodeURIComponent(slug)}/crashes/${crashId}/dump`;
}

export type Webhook = {
  id: number;
  kind: "slack" | "discord";
  url: string;
  events: string;
  created_at: number;
};

export const listWebhooks = (slug: string) =>
  req<{ webhooks: Webhook[] }>(`/api/projects/${encodeURIComponent(slug)}/webhooks`);

export const createWebhook = (slug: string, kind: "slack" | "discord", url: string) =>
  req<{ id: number }>(`/api/projects/${encodeURIComponent(slug)}/webhooks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, url }),
  });

export const deleteWebhook = (slug: string, id: number) =>
  req<void>(`/api/projects/${encodeURIComponent(slug)}/webhooks/${id}`, { method: "DELETE" });

export type Release = {
  id: number;
  version: string;
  channel: string | null;
  first_seen_at: number;
  install_count: number;
  crash_count: number;
};

export const listReleases = (slug: string) =>
  req<{ releases: Release[] }>(`/api/projects/${encodeURIComponent(slug)}/releases`);

// --- orgs / teams ---

export type Org = {
  id: number;
  slug: string;
  name: string;
  created_at: number;
  role: "owner" | "member";
};

export type Member = {
  user_id: number;
  role: "owner" | "member";
  created_at: number;
  github_login: string;
  avatar_url: string | null;
};

export const listOrgs = () => req<{ orgs: Org[] }>("/api/orgs");

export const createOrg = (input: { slug: string; name: string }) =>
  req<{ org: Org }>("/api/orgs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const getOrg = (slug: string) =>
  req<{ org: Omit<Org, "role">; role: "owner" | "member" }>(
    `/api/orgs/${encodeURIComponent(slug)}`,
  );

export const deleteOrg = (slug: string) =>
  req<void>(`/api/orgs/${encodeURIComponent(slug)}`, { method: "DELETE" });

export const listMembers = (slug: string) =>
  req<{ members: Member[] }>(`/api/orgs/${encodeURIComponent(slug)}/members`);

export const addMember = (
  slug: string,
  input: { github_login: string; role?: "owner" | "member" },
) =>
  req<{ ok: true }>(`/api/orgs/${encodeURIComponent(slug)}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const removeMember = (slug: string, userId: number) =>
  req<void>(`/api/orgs/${encodeURIComponent(slug)}/members/${userId}`, { method: "DELETE" });
