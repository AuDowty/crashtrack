import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth, requireProject, serializeProject } from "../lib/middleware";

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

export const projects = new Hono<AppEnv>();

projects.use("*", requireAuth);

projects.get("/", async (c) => {
  const user = c.get("user");
  // Personal projects + projects in any org the user belongs to.
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.user_id, p.org_id, p.slug, p.name, p.platform, p.public, p.created_at,
            o.slug AS org_slug, o.name AS org_name
       FROM projects p
       LEFT JOIN orgs o ON o.id = p.org_id
       WHERE p.user_id = ?
          OR p.org_id IN (SELECT org_id FROM org_members WHERE user_id = ?)
       ORDER BY p.created_at DESC`,
  )
    .bind(user.id, user.id)
    .all<Parameters<typeof serializeProject>[0] & { org_slug: string | null; org_name: string | null }>();

  const projects_out = results.map((row) => ({
    ...serializeProject(row),
    owner: row.org_id
      ? { kind: "org" as const, slug: row.org_slug ?? "", name: row.org_name ?? "" }
      : { kind: "user" as const, slug: user.github_login, name: user.github_login },
  }));
  return c.json({ projects: projects_out });
});

projects.post("/", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => ({}))) as {
    slug?: unknown;
    name?: unknown;
    org_slug?: unknown;
  };
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const orgSlug = typeof body.org_slug === "string" && body.org_slug ? body.org_slug : null;

  if (!SLUG_RE.test(slug)) return c.json({ error: "invalid_slug" }, 400);
  if (!name || name.length > 80) return c.json({ error: "invalid_name" }, 400);

  // Resolve owner: user direct, or one of the user's orgs.
  let org_id: number | null = null;
  if (orgSlug) {
    const org = (await c.env.DB
      .prepare(
        `SELECT o.id FROM orgs o
            JOIN org_members m ON m.org_id = o.id
          WHERE o.slug = ? AND m.user_id = ?`,
      )
      .bind(orgSlug, user.id)
      .first()) as { id: number } | null;
    if (!org) return c.json({ error: "org_not_found" }, 404);
    org_id = org.id;
  }

  const existing = await c.env.DB
    .prepare("SELECT 1 FROM projects WHERE slug = ?")
    .bind(slug)
    .first();
  if (existing) return c.json({ error: "slug_taken" }, 409);

  const now = Date.now();
  const res = await c.env.DB
    .prepare(
      `INSERT INTO projects (user_id, org_id, slug, name, platform, public, created_at)
       VALUES (?, ?, ?, ?, 'windows', 0, ?)`,
    )
    .bind(user.id, org_id, slug, name, now)
    .run();

  const id = Number(res.meta.last_row_id);
  return c.json(
    {
      project: serializeProject({
        id,
        user_id: user.id,
        org_id,
        slug,
        name,
        platform: "windows",
        public: 0,
        github_repo: null,
        source_root: "src",
        github_ref: null,
        created_at: now,
      }),
    },
    201,
  );
});

projects.get("/:slug", async (c) => {
  const project = await requireProject(c, c.req.param("slug"));
  if (project instanceof Response) return project;
  return c.json({ project: serializeProject(project) });
});

projects.patch("/:slug", async (c) => {
  const project = await requireProject(c, c.req.param("slug"));
  if (project instanceof Response) return project;
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: unknown;
    public?: unknown;
    github_repo?: unknown;
    github_ref?: unknown;
    source_root?: unknown;
  };

  const updates: string[] = [];
  const params: (string | number | null)[] = [];
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name || name.length > 80) return c.json({ error: "invalid_name" }, 400);
    updates.push("name = ?");
    params.push(name);
  }
  if (typeof body.public === "boolean") {
    updates.push("public = ?");
    params.push(body.public ? 1 : 0);
  }
  if (body.github_repo !== undefined) {
    const v = typeof body.github_repo === "string" ? body.github_repo.trim() : "";
    if (v && !/^[\w.-]+\/[\w.-]+$/.test(v)) return c.json({ error: "invalid_github_repo" }, 400);
    updates.push("github_repo = ?");
    params.push(v || null);
  }
  if (body.github_ref !== undefined) {
    const v = typeof body.github_ref === "string" ? body.github_ref.trim() : "";
    if (v.length > 200) return c.json({ error: "invalid_github_ref" }, 400);
    updates.push("github_ref = ?");
    params.push(v || null);
  }
  if (body.source_root !== undefined) {
    const v = typeof body.source_root === "string" ? body.source_root.trim() : "";
    if (v.length > 100) return c.json({ error: "invalid_source_root" }, 400);
    updates.push("source_root = ?");
    params.push(v || null);
  }
  if (updates.length === 0) return c.json({ error: "nothing_to_update" }, 400);
  params.push(project.id);

  await c.env.DB.prepare(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...params)
    .run();

  const updated = (await c.env.DB
    .prepare(
      `SELECT id, user_id, org_id, slug, name, platform, public, created_at,
              github_repo, source_root, github_ref
         FROM projects WHERE id = ?`,
    )
    .bind(project.id)
    .first()) as Parameters<typeof serializeProject>[0];
  return c.json({ project: serializeProject(updated) });
});

projects.delete("/:slug", async (c) => {
  const project = await requireProject(c, c.req.param("slug"));
  if (project instanceof Response) return project;
  await c.env.DB.prepare("DELETE FROM projects WHERE id = ?").bind(project.id).run();
  return c.body(null, 204);
});
