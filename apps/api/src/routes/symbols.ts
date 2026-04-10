import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth, requireProject } from "../lib/middleware";
import { pdbIdentity } from "../lib/symbolicate";

const MAX_PDB_BYTES = 50 * 1024 * 1024;

export const symbols = new Hono<AppEnv>();

symbols.use("*", requireAuth);

// Strip .exe / .dll / .pdb AND normalize hyphens to underscores so the
// match works across Cargo conventions (e.g. binary "crashtrack-test.exe"
// emits "crashtrack_test.pdb" — different separators, same logical module).
export function moduleNameStem(name: string): string {
  return name.replace(/\.(exe|dll|sys|pdb)$/i, "").replace(/-/g, "_").toLowerCase();
}

symbols.get("/:slug/symbols", async (c) => {
  const project = await requireProject(c, c.req.param("slug"));
  if (project instanceof Response) return project;
  const { results } = await c.env.DB
    .prepare(
      `SELECT id, module_name, signature, age, size, uploaded_at
         FROM symbol_files WHERE project_id = ?
         ORDER BY uploaded_at DESC`,
    )
    .bind(project.id)
    .all();
  return c.json({ symbols: results });
});

symbols.post("/:slug/symbols", async (c) => {
  const project = await requireProject(c, c.req.param("slug"));
  if (project instanceof Response) return project;

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "expected_multipart" }, 400);
  }

  const field = form.get("pdb");
  if (typeof field === "string" || field === null) {
    return c.json({ error: "missing_pdb" }, 400);
  }
  const blob = field as unknown as Blob & { name?: string };
  if (blob.size === 0) return c.json({ error: "empty_pdb" }, 400);
  if (blob.size > MAX_PDB_BYTES) return c.json({ error: "pdb_too_large" }, 413);

  const filename = (blob.name ?? "upload.pdb").toString();
  const bytes = await blob.arrayBuffer();

  let identity;
  try {
    identity = await pdbIdentity(bytes);
  } catch (err) {
    return c.json({ error: "invalid_pdb", detail: String(err) }, 400);
  }

  const moduleName = filename.replace(/\\|\//g, "_");
  const r2_key = `${project.id}/symbols/${identity.signature}-${identity.age}.pdb`;

  await c.env.SYMBOLS.put(r2_key, bytes, {
    httpMetadata: { contentType: "application/octet-stream" },
  });

  const now = Date.now();
  const res = await c.env.DB
    .prepare(
      `INSERT INTO symbol_files
         (project_id, module_name, signature, age, r2_key, size, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, signature, age) DO UPDATE SET
         module_name = excluded.module_name,
         r2_key      = excluded.r2_key,
         size        = excluded.size,
         uploaded_at = excluded.uploaded_at`,
    )
    .bind(project.id, moduleName, identity.signature, identity.age, r2_key, bytes.byteLength, now)
    .run();

  return c.json({
    symbol: {
      id:          Number(res.meta.last_row_id),
      module_name: moduleName,
      signature:   identity.signature,
      age:         identity.age,
      size:        bytes.byteLength,
      uploaded_at: now,
    },
  }, 201);
});

symbols.delete("/:slug/symbols/:id", async (c) => {
  const project = await requireProject(c, c.req.param("slug"));
  if (project instanceof Response) return project;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);

  const row = (await c.env.DB
    .prepare("SELECT r2_key FROM symbol_files WHERE id = ? AND project_id = ?")
    .bind(id, project.id)
    .first()) as { r2_key: string } | null;
  if (!row) return c.json({ error: "not_found" }, 404);

  await c.env.SYMBOLS.delete(row.r2_key);
  await c.env.DB.prepare("DELETE FROM symbol_files WHERE id = ?").bind(id).run();
  return c.body(null, 204);
});
