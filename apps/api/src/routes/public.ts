import { Hono } from "hono";
import type { AppEnv } from "../types";

type PublicProject = {
  id: number;
  slug: string;
  name: string;
  platform: string;
  public: number;
  created_at: number;
};

export const publicApi = new Hono<AppEnv>();

// Site-wide stats for the landing page. Cached at the CF edge for 5 min so
// hitting the homepage doesn't slam D1 with COUNT(*) on every visit.
publicApi.get("/stats", async (c) => {
  const cacheKey = new Request("https://cache.crashtrack.dev/site-stats");
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return new Response(hit.body, hit);

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const [u, p, x] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(DISTINCT project_id) AS n FROM crashes WHERE uploaded_at > ?",
    ).bind(thirtyDaysAgo).first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM crashes").first<{ n: number }>(),
  ]);

  const body = JSON.stringify({
    users: u?.n ?? 0,
    active_projects: p?.n ?? 0,
    crashes_processed: x?.n ?? 0,
  });
  const resp = new Response(body, {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
    },
  });
  c.executionCtx.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
});

async function fetchPublic(env: AppEnv["Bindings"], slug: string): Promise<PublicProject | null> {
  const row = (await env.DB
    .prepare(
      `SELECT id, slug, name, platform, public, created_at
         FROM projects
         WHERE slug = ? AND public = 1`,
    )
    .bind(slug)
    .first()) as PublicProject | null;
  return row;
}

publicApi.get("/:slug", async (c) => {
  const project = await fetchPublic(c.env, c.req.param("slug"));
  if (!project) return c.json({ error: "not_found" }, 404);
  return c.json({
    project: {
      slug: project.slug,
      name: project.name,
      platform: project.platform,
      public: true,
      created_at: project.created_at,
    },
  });
});

publicApi.get("/:slug/stats", async (c) => {
  const project = await fetchPublic(c.env, c.req.param("slug"));
  if (!project) return c.json({ error: "not_found" }, 404);

  const daysParam = Number(c.req.query("days") ?? "14");
  const days = Math.min(90, Math.max(1, Number.isFinite(daysParam) ? daysParam : 14));
  const today = Math.floor(Date.now() / 86_400_000);
  const fromDay = today - days + 1;

  const { results } = await c.env.DB.prepare(
    `SELECT day, count FROM crash_daily
       WHERE project_id = ? AND day >= ?
       ORDER BY day ASC`,
  )
    .bind(project.id, fromDay)
    .all<{ day: number; count: number }>();

  const map = new Map(results.map((r) => [r.day, r.count]));
  const filled = [];
  for (let d = fromDay; d <= today; d++) {
    filled.push({
      day: d,
      date: new Date(d * 86_400_000).toISOString().slice(0, 10),
      count: map.get(d) ?? 0,
    });
  }
  const total = filled.reduce((sum, p) => sum + p.count, 0);
  return c.json({ stats: filled, total });
});

publicApi.get("/:slug/groups", async (c) => {
  const project = await fetchPublic(c.env, c.req.param("slug"));
  if (!project) return c.json({ error: "not_found" }, 404);

  const { results } = await c.env.DB.prepare(
    `SELECT id, first_seen_at, last_seen_at, count,
            exception_code, top_module, top_function, status
       FROM crash_groups
       WHERE project_id = ? AND status = 'open'
       ORDER BY last_seen_at DESC
       LIMIT 50`,
  )
    .bind(project.id)
    .all();
  return c.json({ groups: results });
});
