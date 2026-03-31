import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth, requireProject } from "../lib/middleware";
import { randomHex, sha256Hex } from "../lib/crypto";

const KEY_PREFIX = "ct_pk_";

type KeyRow = {
  id: number;
  name: string;
  last_4: string;
  last_used_at: number | null;
  created_at: number;
};

export const keys = new Hono<AppEnv>();

keys.use("*", requireAuth);

keys.get("/:slug/keys", async (c) => {
  const project = await requireProject(c, c.req.param("slug"));
  if (project instanceof Response) return project;
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, last_4, last_used_at, created_at
       FROM api_keys WHERE project_id = ? ORDER BY created_at DESC`,
  )
    .bind(project.id)
    .all<KeyRow>();
  return c.json({ keys: results });
});

keys.post("/:slug/keys", async (c) => {
  const project = await requireProject(c, c.req.param("slug"));
  if (project instanceof Response) return project;
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 60) return c.json({ error: "invalid_name" }, 400);

  const secret = KEY_PREFIX + randomHex(16);
  const keyHash = await sha256Hex(secret);
  const last4 = secret.slice(-4);
  const now = Date.now();

  const res = await c.env.DB.prepare(
    `INSERT INTO api_keys (project_id, key_hash, name, last_4, last_used_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
  )
    .bind(project.id, keyHash, name, last4, now)
    .run();

  return c.json(
    {
      key: {
        id: Number(res.meta.last_row_id),
        name,
        last_4: last4,
        last_used_at: null,
        created_at: now,
        secret,
      },
    },
    201,
  );
});

keys.delete("/:slug/keys/:id", async (c) => {
  const project = await requireProject(c, c.req.param("slug"));
  if (project instanceof Response) return project;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "invalid_id" }, 400);
  await c.env.DB.prepare("DELETE FROM api_keys WHERE id = ? AND project_id = ?")
    .bind(id, project.id)
    .run();
  return c.body(null, 204);
});
