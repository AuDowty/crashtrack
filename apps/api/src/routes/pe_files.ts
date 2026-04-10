import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth, requireProject } from "../lib/middleware";

const MAX_PE_BYTES = 50 * 1024 * 1024;

// "MZ" — PE files start with this magic.
const MZ_MAGIC = 0x5a4d;

export const peFiles = new Hono<AppEnv>();

peFiles.use("*", requireAuth);

peFiles.get("/:slug/pe-files", async (c) => {
  const project = await requireProject(c, c.req.param("slug"));
  if (project instanceof Response) return project;
  const { results } = await c.env.DB
    .prepare(
      `SELECT id, basename, size, uploaded_at
         FROM pe_files WHERE project_id = ?
         ORDER BY uploaded_at DESC`,
    )
    .bind(project.id)
    .all();
  return c.json({ pe_files: results });
});

peFiles.post("/:slug/pe-files", async (c) => {
  const project = await requireProject(c, c.req.param("slug"));
  if (project instanceof Response) return project;

  let form: FormData;
  try { form = await c.req.formData(); }
  catch { return c.json({ error: "expected_multipart" }, 400); }

  const field = form.get("pe");
  if (typeof field === "string" || field === null) {
    return c.json({ error: "missing_pe" }, 400);
  }
  const blob = field as unknown as Blob & { name?: string };
  if (blob.size === 0) return c.json({ error: "empty_pe" }, 400);
  if (blob.size > MAX_PE_BYTES) return c.json({ error: "pe_too_large" }, 413);

  const filename = (blob.name ?? "upload.exe").toString();
  const bytes = await blob.arrayBuffer();
  if (bytes.byteLength < 2 ||
      new DataView(bytes).getUint16(0, true) !== MZ_MAGIC) {
    return c.json({ error: "not_a_pe_file" }, 400);
  }

  const basename = filename.split(/[\\/]/).pop()!.toLowerCase();
  const r2_key = `${project.id}/pe/${basename}`;

  await c.env.PE_FILES.put(r2_key, bytes, {
    httpMetadata: { contentType: "application/octet-stream" },
  });

  const now = Date.now();
  const res = await c.env.DB
    .prepare(
      `INSERT INTO pe_files (project_id, basename, r2_key, size, uploaded_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id, basename) DO UPDATE SET
         r2_key      = excluded.r2_key,
         size        = excluded.size,
         uploaded_at = excluded.uploaded_at`,
    )
    .bind(project.id, basename, r2_key, bytes.byteLength, now)
    .run();

  return c.json({
    pe_file: {
      id:          Number(res.meta.last_row_id),
      basename,
      size:        bytes.byteLength,
      uploaded_at: now,
    },
  }, 201);
});

peFiles.delete("/:slug/pe-files/:id", async (c) => {
  const project = await requireProject(c, c.req.param("slug"));
  if (project instanceof Response) return project;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  const row = (await c.env.DB
    .prepare("SELECT r2_key FROM pe_files WHERE id = ? AND project_id = ?")
    .bind(id, project.id)
    .first()) as { r2_key: string } | null;
  if (!row) return c.json({ error: "not_found" }, 404);
  await c.env.PE_FILES.delete(row.r2_key);
  await c.env.DB.prepare("DELETE FROM pe_files WHERE id = ?").bind(id).run();
  return c.body(null, 204);
});
