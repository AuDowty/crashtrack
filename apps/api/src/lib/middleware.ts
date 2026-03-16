import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";
import { getCurrentUser } from "./session";

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await getCurrentUser(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  c.set("user", user);
  await next();
};

export type ProjectRow = {
  id: number;
  user_id: number;
  org_id: number | null;
  slug: string;
  name: string;
  platform: string;
  public: number;
  created_at: number;
  github_repo: string | null;
  source_root: string | null;
  github_ref: string | null;
};

// 404 (not 403) on unauthorized so we don't leak which slugs exist.
export async function requireProject(
  c: Context<AppEnv>,
  slug: string,
): Promise<ProjectRow | Response> {
  const user = c.get("user");
  const row = await c.env.DB.prepare(
    `SELECT id, user_id, org_id, slug, name, platform, public, created_at,
            github_repo, source_root, github_ref
       FROM projects WHERE slug = ?`,
  )
    .bind(slug)
    .first<ProjectRow>();
  if (!row) return c.json({ error: "not_found" }, 404);

  // Direct owner OK.
  if (row.user_id === user.id) return row;

  // Otherwise must be a member of the project's org.
  if (row.org_id != null) {
    const member = await c.env.DB.prepare(
      "SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ?",
    )
      .bind(row.org_id, user.id)
      .first();
    if (member) return row;
  }
  return c.json({ error: "not_found" }, 404);
}

export function serializeProject(row: ProjectRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    platform: row.platform,
    public: row.public === 1,
    created_at: row.created_at,
    org_id: row.org_id,
    github_repo: row.github_repo,
    source_root: row.source_root,
    github_ref: row.github_ref,
  };
}
