import { Hono, type Context } from "hono";
import type { AppEnv } from "../types";
import { sha256Hex } from "../lib/crypto";
import { parseMinidump, extractUnwindData } from "../lib/minidump";
import { groupSignature } from "../lib/grouping";
import { deliverNewGroup } from "../lib/webhooks";

const MAX_DUMP_BYTES = 5 * 1024 * 1024;

type KeyLookup = { project_id: number; id: number } | null;

export const ingest = new Hono<AppEnv>();

async function authenticateKey(c: Context<AppEnv>): Promise<
  | { kind: "ok"; project_id: number; key_id: number }
  | { kind: "err"; status: 401 | 400; error: string }
> {
  const auth = c.req.header("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return { kind: "err", status: 401, error: "missing_bearer" };
  }
  const token = auth.slice(7).trim();
  if (!token.startsWith("ct_pk_")) {
    return { kind: "err", status: 401, error: "bad_key_format" };
  }
  const keyHash = await sha256Hex(token);
  const row = (await c.env.DB.prepare(
    "SELECT id, project_id FROM api_keys WHERE key_hash = ?",
  )
    .bind(keyHash)
    .first()) as KeyLookup;
  if (!row) return { kind: "err", status: 401, error: "invalid_key" };
  return { kind: "ok", project_id: row.project_id, key_id: row.id };
}

async function getOrCreateRelease(
  db: D1Database,
  project_id: number,
  version: string,
): Promise<number | null> {
  if (!version) return null;
  const existing = (await db
    .prepare("SELECT id FROM releases WHERE project_id = ? AND version = ?")
    .bind(project_id, version)
    .first()) as { id: number } | null;
  if (existing) return existing.id;
  const ins = await db
    .prepare(
      `INSERT INTO releases (project_id, version, first_seen_at, install_count)
       VALUES (?, ?, ?, 0)`,
    )
    .bind(project_id, version, Date.now())
    .run();
  return Number(ins.meta.last_row_id);
}

ingest.post("/crashes", async (c) => {
  const authResult = await authenticateKey(c);
  if (authResult.kind === "err") return c.json({ error: authResult.error }, authResult.status);
  const { project_id, key_id } = authResult;

  // Per-api-key rate limit: bucket on key_id (small integer that CF accepts).
  const { success: allowed } = await c.env.INGEST_LIMITER.limit({ key: String(key_id) });
  if (!allowed) return c.json({ error: "rate_limited" }, 429);

  // Per-project storage cap.
  const used = (await c.env.DB
    .prepare("SELECT COALESCE(SUM(dump_size), 0) AS bytes FROM crashes WHERE project_id = ?")
    .bind(project_id)
    .first<{ bytes: number }>()) ?? { bytes: 0 };
  const quota = Number(c.env.PROJECT_QUOTA_BYTES);
  if (Number.isFinite(quota) && used.bytes >= quota) {
    return c.json({ error: "project_quota_exceeded" }, 507);
  }

  // Per-project daily crash COUNT cap. Stops a single project from flooding
  // millions of small crashes (which the byte cap wouldn't catch in time).
  const dailyCap = Number(c.env.PROJECT_DAILY_CRASH_CAP);
  if (Number.isFinite(dailyCap) && dailyCap > 0) {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const today = (await c.env.DB
      .prepare("SELECT COUNT(*) AS n FROM crashes WHERE project_id = ? AND uploaded_at > ?")
      .bind(project_id, since)
      .first<{ n: number }>()) ?? { n: 0 };
    if (today.n >= dailyCap) {
      return c.json({ error: "project_daily_cap_exceeded" }, 429);
    }
  }

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "expected_multipart" }, 400);
  }

  const dumpField = form.get("dump");
  // In Workers FormData, file fields come back as File (subclass of Blob).
  // String fields come back as string. Anything else = invalid input.
  if (typeof dumpField === "string" || dumpField === null) {
    return c.json({ error: "missing_dump" }, 400);
  }
  const dumpBlob = dumpField as unknown as Blob;
  if (dumpBlob.size === 0) return c.json({ error: "empty_dump" }, 400);
  if (dumpBlob.size > MAX_DUMP_BYTES) return c.json({ error: "dump_too_large" }, 413);

  const app = String(form.get("app") ?? "").slice(0, 60);
  const version = String(form.get("version") ?? "").slice(0, 60);
  void app; // reserved — used for multi-app projects in W2

  const bytes = await dumpBlob.arrayBuffer();
  const parsed = parseMinidump(bytes);
  const group = await groupSignature(parsed);

  // Serialize the stack as JSON for storage. bigints stringify as hex.
  const stack_json = parsed.ok && parsed.frames.length > 0
    ? JSON.stringify(parsed.frames.map((f) => ({
        address: "0x" + f.address.toString(16),
        module:  f.module,
        offset:  f.offset != null ? "0x" + f.offset.toString(16) : null,
      })))
    : null;

  // Extract stack memory + register state for view-time SEH unwinding.
  const unwindDataRaw = parsed.ok ? extractUnwindData(bytes, parsed) : null;
  const unwind_data = unwindDataRaw
    ? JSON.stringify({
        rip:        "0x" + unwindDataRaw.rip.toString(16),
        rsp:        "0x" + unwindDataRaw.rsp.toString(16),
        rbp:        "0x" + unwindDataRaw.rbp.toString(16),
        stack_base: "0x" + unwindDataRaw.stack_base.toString(16),
        stack_b64:  unwindDataRaw.stack_b64,
      })
    : null;

  const now = Date.now();
  const occurred_at = parsed.ok && parsed.occurred_at ? parsed.occurred_at : now;
  const release_id = await getOrCreateRelease(c.env.DB, project_id, version);

  // Upsert crash_group: if exists bump count + last_seen, else insert.
  const existingGroup = (await c.env.DB
    .prepare("SELECT id FROM crash_groups WHERE project_id = ? AND signature = ?")
    .bind(project_id, group.signature)
    .first()) as { id: number } | null;

  let group_id: number;
  let is_new_group: boolean;
  if (existingGroup) {
    group_id = existingGroup.id;
    is_new_group = false;
    await c.env.DB
      .prepare("UPDATE crash_groups SET count = count + 1, last_seen_at = ? WHERE id = ?")
      .bind(now, group_id)
      .run();
  } else {
    const ins = await c.env.DB
      .prepare(
        `INSERT INTO crash_groups
           (project_id, signature, first_seen_at, last_seen_at, count,
            exception_code, top_module, top_function, status)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'open')`,
      )
      .bind(
        project_id,
        group.signature,
        now,
        now,
        group.exception_code,
        group.top_module,
        group.top_function,
      )
      .run();
    group_id = Number(ins.meta.last_row_id);
    is_new_group = true;
  }

  const crash_id = `${project_id}/${crypto.randomUUID()}.dmp`;

  await c.env.DUMPS.put(crash_id, bytes, {
    httpMetadata: { contentType: "application/octet-stream" },
  });

  const ex = parsed.ok ? parsed.exception : null;
  await c.env.DB
    .prepare(
      `INSERT INTO crashes
         (id, project_id, group_id, release_id, occurred_at, uploaded_at,
          app_version, os_version, cpu_arch, ram_mb, dump_size, parsed_ok, stack_json,
          exception_name, av_operation, av_address, unwind_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crash_id,
      project_id,
      group_id,
      release_id,
      occurred_at,
      now,
      version || null,
      parsed.ok ? parsed.system?.os_version ?? null : null,
      parsed.ok ? parsed.system?.cpu_arch ?? null : null,
      bytes.byteLength,
      parsed.ok ? 1 : 0,
      stack_json,
      ex?.code_name ?? null,
      ex?.av_operation ?? null,
      ex?.av_address != null ? "0x" + ex.av_address.toString(16) : null,
      unwind_data,
    )
    .run();

  // Daily-aggregate bump (chart query won't scan crashes).
  const day = Math.floor(now / 86_400_000);
  await c.env.DB
    .prepare(
      `INSERT INTO crash_daily (project_id, day, count) VALUES (?, ?, 1)
       ON CONFLICT(project_id, day) DO UPDATE SET count = count + 1`,
    )
    .bind(project_id, day)
    .run();

  // Track key usage (fire-and-forget — failure here doesn't break ingest).
  c.executionCtx.waitUntil(
    c.env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
      .bind(now, key_id)
      .run(),
  );

  // Webhook delivery on first sighting of this signature. Don't block the
  // 201 — even if slack is down the ingest still succeeds.
  if (is_new_group) {
    const project = (await c.env.DB
      .prepare("SELECT slug, name FROM projects WHERE id = ?")
      .bind(project_id)
      .first()) as { slug: string; name: string } | null;
    if (project) {
      c.executionCtx.waitUntil(
        deliverNewGroup(c.env, project, {
          id: group_id,
          count: 1,
          exception_code: group.exception_code,
          top_module: group.top_module,
          top_function: group.top_function,
        }),
      );
    }
  }

  return c.json({ id: crash_id, group_id, is_new_group }, 201);
});
