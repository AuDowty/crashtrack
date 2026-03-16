import { Hono, type Context } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../lib/middleware";

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/;

type OrgRow = {
  id: number;
  slug: string;
  name: string;
  created_at: number;
};

type MemberRow = {
  user_id: number;
  role: string;
  created_at: number;
  github_login: string;
  avatar_url: string | null;
};

export const orgs = new Hono<AppEnv>();

orgs.use("*", requireAuth);

// List every org the current user belongs to.
orgs.get("/", async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.slug, o.name, o.created_at, m.role
       FROM orgs o
       JOIN org_members m ON m.org_id = o.id
       WHERE m.user_id = ?
       ORDER BY o.created_at DESC`,
  )
    .bind(user.id)
    .all<OrgRow & { role: string }>();
  return c.json({ orgs: results });
});

// Create a new org. Creator is automatically the sole owner.
orgs.post("/", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => ({}))) as { slug?: unknown; name?: unknown };
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!SLUG_RE.test(slug)) return c.json({ error: "invalid_slug" }, 400);
  if (!name || name.length > 80) return c.json({ error: "invalid_name" }, 400);

  const dup = await c.env.DB.prepare("SELECT 1 FROM orgs WHERE slug = ?").bind(slug).first();
  if (dup) return c.json({ error: "slug_taken" }, 409);

  const now = Date.now();
  const ins = await c.env.DB
    .prepare("INSERT INTO orgs (slug, name, created_at) VALUES (?, ?, ?)")
    .bind(slug, name, now)
    .run();
  const org_id = Number(ins.meta.last_row_id);
  await c.env.DB
    .prepare(
      "INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
    )
    .bind(org_id, user.id, now)
    .run();
  return c.json({ org: { id: org_id, slug, name, created_at: now, role: "owner" } }, 201);
});

async function requireOrg(
  c: Context<AppEnv>,
  slug: string,
): Promise<{ org: OrgRow; role: string } | Response> {
  const user = c.get("user");
  const row = (await c.env.DB
    .prepare(
      `SELECT o.id, o.slug, o.name, o.created_at, m.role
         FROM orgs o
         JOIN org_members m ON m.org_id = o.id
         WHERE o.slug = ? AND m.user_id = ?`,
    )
    .bind(slug, user.id)
    .first()) as (OrgRow & { role: string }) | null;
  if (!row) return c.json({ error: "not_found" }, 404);
  const { role, ...org } = row;
  return { org, role };
}

orgs.get("/:slug", async (c) => {
  const result = await requireOrg(c, c.req.param("slug"));
  if (result instanceof Response) return result;
  return c.json({ org: result.org, role: result.role });
});

orgs.delete("/:slug", async (c) => {
  const result = await requireOrg(c, c.req.param("slug"));
  if (result instanceof Response) return result;
  if (result.role !== "owner") return c.json({ error: "owner_only" }, 403);
  await c.env.DB.prepare("DELETE FROM orgs WHERE id = ?").bind(result.org.id).run();
  return c.body(null, 204);
});

orgs.get("/:slug/members", async (c) => {
  const result = await requireOrg(c, c.req.param("slug"));
  if (result instanceof Response) return result;
  const { results } = await c.env.DB
    .prepare(
      `SELECT m.user_id, m.role, m.created_at,
              u.github_login, u.avatar_url
         FROM org_members m
         JOIN users u ON u.id = m.user_id
         WHERE m.org_id = ?
         ORDER BY (m.role = 'owner') DESC, m.created_at ASC`,
    )
    .bind(result.org.id)
    .all<MemberRow>();
  return c.json({ members: results });
});

// Owners add members by github_login. The invited user must have signed in
// to crashtrack at least once (we look up by their existing users row).
orgs.post("/:slug/members", async (c) => {
  const result = await requireOrg(c, c.req.param("slug"));
  if (result instanceof Response) return result;
  if (result.role !== "owner") return c.json({ error: "owner_only" }, 403);

  const body = (await c.req.json().catch(() => ({}))) as {
    github_login?: unknown;
    role?: unknown;
  };
  const login = typeof body.github_login === "string" ? body.github_login.trim() : "";
  const role = body.role === "owner" ? "owner" : "member";
  if (!login) return c.json({ error: "invalid_login" }, 400);

  const target = (await c.env.DB
    .prepare("SELECT id FROM users WHERE github_login = ?")
    .bind(login)
    .first()) as { id: number } | null;
  if (!target) return c.json({ error: "user_not_signed_up" }, 404);

  await c.env.DB
    .prepare(
      `INSERT INTO org_members (org_id, user_id, role, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(org_id, user_id) DO UPDATE SET role = excluded.role`,
    )
    .bind(result.org.id, target.id, role, Date.now())
    .run();
  return c.json({ ok: true }, 201);
});

orgs.delete("/:slug/members/:user_id", async (c) => {
  const result = await requireOrg(c, c.req.param("slug"));
  if (result instanceof Response) return result;
  const targetUserId = Number(c.req.param("user_id"));
  if (!Number.isInteger(targetUserId)) return c.json({ error: "invalid_user_id" }, 400);

  const user = c.get("user");
  // Members can remove themselves. Owners can remove anyone, except the last owner.
  const isSelf = targetUserId === user.id;
  if (!isSelf && result.role !== "owner") return c.json({ error: "owner_only" }, 403);

  if (result.role === "owner") {
    // Don't allow removing the last owner.
    const target = (await c.env.DB
      .prepare("SELECT role FROM org_members WHERE org_id = ? AND user_id = ?")
      .bind(result.org.id, targetUserId)
      .first()) as { role: string } | null;
    if (target?.role === "owner") {
      const ownerCount = (await c.env.DB
        .prepare("SELECT COUNT(*) AS n FROM org_members WHERE org_id = ? AND role = 'owner'")
        .bind(result.org.id)
        .first()) as { n: number } | null;
      if ((ownerCount?.n ?? 0) <= 1) {
        return c.json({ error: "last_owner" }, 400);
      }
    }
  }

  await c.env.DB
    .prepare("DELETE FROM org_members WHERE org_id = ? AND user_id = ?")
    .bind(result.org.id, targetUserId)
    .run();
  return c.body(null, 204);
});
